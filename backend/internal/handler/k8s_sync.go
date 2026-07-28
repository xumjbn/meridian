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

// SyncK8sNodesFromAPI 从 kube-apiserver 拉节点清单并归类到该集群
func SyncK8sNodesFromAPI(c *gin.Context) {
	cl, ok := loadClusterWithToken(c)
	if !ok {
		return
	}

	body, code, err := kubeGet(cl, "/api/v1/nodes")
	if err != nil {
		SendError(c, 502, "连接 kube-apiserver 失败: "+err.Error())
		return
	}
	if code != 200 {
		SendError(c, 502, fmt.Sprintf("kube API 返回 %d: %s", code, truncateStr(string(body), 200)))
		return
	}
	var list kubeNodeList
	if err := json.Unmarshal(body, &list); err != nil {
		SendError(c, 502, "解析节点列表失败: "+err.Error())
		return
	}

	// 是否把 API 里有、资产表里没有的节点自动补录为新资产
	createMissing := strings.EqualFold(c.Query("create_missing"), "true") || c.Query("create_missing") == "1"

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

	db.Create(&model.AuditLog{
		Actor: currentUsername(c), Action: "K8S_SYNC_NODES",
		Path: fmt.Sprintf("集群#%d 按 API 同步节点：归类 %d、更新 %d、补录 %d（共 %d）",
			cl.ID, assigned, updated, created, len(list.Items)),
		Status: 200, IP: c.ClientIP(),
	})

	SendSuccess(c, gin.H{
		"total": len(list.Items), "assigned": assigned, "updated": updated,
		"created": created, "details": details,
	})
}
