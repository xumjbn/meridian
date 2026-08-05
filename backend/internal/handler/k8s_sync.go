package handler

import (
	"encoding/json"
	"fmt"
	"strings"

	"backend/internal/model"
	"backend/internal/store"

	"github.com/gin-gonic/gin"
)

// ─────────────────────────────────────────────────────────────
// 按 kube-apiserver 节点表同步归类
//
// 原有的「自动归类」要求每个节点都绑定了 SSH 凭据、且 /etc/hosts 里有
// cluster-vip 标记——多数环境两条都不满足，于是归类只能一台台手点。
//
// 集群一旦配了 API Token，节点清单本身就是权威数据源：直接拉 /api/v1/nodes，
// 用 InternalIP 去匹配资产表，一次把整个集群的节点归类到位，
// 既不需要 SSH，也不依赖任何主机上的标记文件。
// 顺带用节点 label 校正 control-plane / worker 角色，并把 kubelet 版本写回资产。
// ─────────────────────────────────────────────────────────────

type syncNodeResult struct {
	IP      string `json:"ip"`
	Name    string `json:"name"`
	Role    string `json:"role"`
	Matched bool   `json:"matched"` // 是否在资产表中找到对应主机
	Action  string `json:"action"`  // assigned / updated / created / skipped / failed
	Msg     string `json:"msg,omitempty"`
}

// syncNodesSummary 一次同步的汇总结果（同时用作接口返回体）
type syncNodesSummary struct {
	Total    int              `json:"total"`
	Assigned int              `json:"assigned"`
	Updated  int              `json:"updated"`
	Created  int              `json:"created"`
	Details  []syncNodeResult `json:"details"`
}

// SyncK8sNodesFromAPI 从 kube-apiserver 拉节点清单并归类到该集群
func SyncK8sNodesFromAPI(c *gin.Context) {
	cl, ok := loadClusterWithToken(c)
	if !ok {
		return
	}
	// 是否把 API 里有、资产表里没有的节点自动补录为新资产
	createMissing := strings.EqualFold(c.Query("create_missing"), "true") || c.Query("create_missing") == "1"
	sum, err := syncK8sNodesCore(c, cl, createMissing)
	if err != nil {
		SendError(c, 502, err.Error())
		return
	}
	SendSuccess(c, sum)
}

// syncK8sNodesCore 同步逻辑本体：拉节点表 → 匹配资产 → 归类/补录 → 写审计。
// 抽成独立函数是为了让「SSH 自动配置」拿到 Token 后能立刻复用同一套归类逻辑，
// 不必让前端再发一次请求（也就不会出现「Token 存了但节点没同步」的中间态）。
func syncK8sNodesCore(c *gin.Context, cl *model.K8sCluster, createMissing bool) (*syncNodesSummary, error) {
	body, code, err := kubeGet(cl, "/api/v1/nodes")
	if err != nil {
		return nil, fmt.Errorf("连接 kube-apiserver 失败: %v", err)
	}
	if code != 200 {
		return nil, fmt.Errorf("kube API 返回 %d: %s", code, truncateStr(string(body), 200))
	}
	var list kubeNodeList
	if err := json.Unmarshal(body, &list); err != nil {
		return nil, fmt.Errorf("解析节点列表失败: %v", err)
	}

	db := store.GlobalDB
	details := make([]syncNodeResult, 0, len(list.Items))
	assigned, updated, created := 0, 0, 0

	for _, n := range list.Items {
		ip := ""
		for _, a := range n.Status.Addresses {
			if a.Type == "InternalIP" {
				ip = a.Address
				break
			}
		}
		role := "worker"
		for k := range n.Metadata.Labels {
			if strings.Contains(k, "node-role.kubernetes.io/control-plane") || strings.Contains(k, "node-role.kubernetes.io/master") {
				role = "control-plane"
			}
		}
		res := syncNodeResult{IP: ip, Name: n.Metadata.Name, Role: role}
		if ip == "" {
			res.Action = "skipped"
			res.Msg = "节点没有 InternalIP"
			details = append(details, res)
			continue
		}

		var asset model.Asset
		q := db.Where("ip = ?", ip)
		if !isAdmin(c) {
			q = q.Where("owner_id = ?", currentUserID(c))
		}
		if q.First(&asset).Error != nil {
			// 资产表里没有这台机器
			if !createMissing {
				res.Action = "skipped"
				res.Msg = "资产表中无此 IP（可勾选「补录缺失节点」自动创建）"
				details = append(details, res)
				continue
			}
			asset = model.Asset{
				Name:      n.Metadata.Name,
				IP:        ip,
				Type:      "server",
				Status:    "online", // 能出现在节点列表里，至少 kubelet 是活的
				OwnerID:   cl.OwnerID,
				OSVersion: n.Status.NodeInfo.OSImage,
				Arch:      n.Status.NodeInfo.Architecture,
			}
			if err := db.Create(&asset).Error; err != nil {
				res.Action = "skipped"
				res.Msg = "创建资产失败: " + err.Error()
				details = append(details, res)
				continue
			}
			created++
			res.Action = "created"
		} else {
			res.Matched = true
			res.Action = "assigned"
		}

		// 归属集群 + 角色 + 版本信息回填
		wasAssigned := asset.K8sClusterID != nil && *asset.K8sClusterID == cl.ID
		asset.K8sClusterID = &cl.ID
		asset.K8sRole = role
		asset.Tags = mergeTagJSON(asset.Tags, "k8s")
		if asset.Arch == "" {
			asset.Arch = n.Status.NodeInfo.Architecture
		}
		if v := strings.TrimSpace(n.Status.NodeInfo.KubeletVersion); v != "" {
			asset.OSVersion = "Kubernetes " + v
		}
		// 写失败时不能再计入 assigned/updated，否则同步结果是假的
		if err := db.Save(&asset).Error; err != nil {
			res.Action = "failed"
			res.Msg = err.Error()
			details = append(details, res)
			continue
		}

		if res.Action == "assigned" {
			if wasAssigned {
				res.Action = "updated"
				updated++
			} else {
				assigned++
			}
		}
		details = append(details, res)
	}

	// 节点归属刚变过，集群相关的 kube 缓存作废，免得看板还在显示同步前的旧状态
	invalidateKubeCache(cl.ID)

	db.Create(&model.AuditLog{
		Actor: currentUsername(c), Action: "K8S_SYNC_NODES",
		Path: fmt.Sprintf("集群#%d 按 API 同步节点：归类 %d、更新 %d、补录 %d（共 %d）",
			cl.ID, assigned, updated, created, len(list.Items)),
		Status: 200, IP: c.ClientIP(),
	})

	return &syncNodesSummary{
		Total: len(list.Items), Assigned: assigned, Updated: updated,
		Created: created, Details: details,
	}, nil
}
