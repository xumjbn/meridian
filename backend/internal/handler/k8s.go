package handler

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"backend/internal/model"
	"backend/internal/store"
	"github.com/gin-gonic/gin"
)

// probeClusterOnline 探测 VIP:console_port 连通性（TCP，1.5s 超时）
func probeClusterOnline(cl *model.K8sCluster) {
	if strings.TrimSpace(cl.VIP) == "" {
		return
	}
	addr := net.JoinHostPort(cl.VIP, strconv.Itoa(cl.ConsolePort))
	conn, err := net.DialTimeout("tcp", addr, 1500*time.Millisecond)
	if err == nil {
		conn.Close()
		cl.Online = true
	}
}

// ==========================================
// Kubernetes 集群管理
// 集群是用户手动建立的归类单元（VIP + 控制台端口 + 绑定凭据）；
// 节点复用 Asset（Asset.K8sClusterID 归属）。多租户按 owner_id 隔离 + 全程审计。
// ==========================================

// enrichCluster 填充非持久化展示字段（节点数 / master 数 / 凭据名）
func enrichCluster(cl *model.K8sCluster) {
	db := store.GlobalDB
	var total, masters int64
	db.Model(&model.Asset{}).Where("k8s_cluster_id = ?", cl.ID).Count(&total)
	db.Model(&model.Asset{}).Where("k8s_cluster_id = ? AND k8s_role = ?", cl.ID, "control-plane").Count(&masters)
	cl.NodeCount = int(total)
	cl.MasterCount = int(masters)
	cl.HasToken = strings.TrimSpace(cl.APIToken) != ""
	if cl.CredentialID != nil {
		var cred model.Credential
		if db.First(&cred, *cl.CredentialID).Error == nil {
			cl.CredName = cred.Name
		}
	}
}

// loadCluster 加载集群并校验归属；失败时已写响应，返回 ok=false
func loadCluster(c *gin.Context) (*model.K8sCluster, bool) {
	id, _ := strconv.Atoi(c.Param("id"))
	var cl model.K8sCluster
	if err := store.GlobalDB.First(&cl, id).Error; err != nil {
		SendError(c, 404, "集群不存在")
		return nil, false
	}
	if !canAccess(c, cl.OwnerID) {
		SendError(c, 403, "无权访问该集群")
		return nil, false
	}
	return &cl, true
}

// ListK8sClusters 集群列表（owner 隔离）
func ListK8sClusters(c *gin.Context) {
	db := store.GlobalDB
	var clusters []model.K8sCluster
	q := db.Order("id desc")
	if !isAdmin(c) {
		q = q.Where("owner_id = ?", currentUserID(c))
	}
	q.Find(&clusters)
	var wg sync.WaitGroup
	for i := range clusters {
		enrichCluster(&clusters[i])
		wg.Add(1)
		go func(cl *model.K8sCluster) { defer wg.Done(); probeClusterOnline(cl) }(&clusters[i])
	}
	wg.Wait()
	SendSuccess(c, clusters)
}

type clusterReq struct {
	Name         string `json:"name"`
	VIP          string `json:"vip"`
	ConsolePort  int    `json:"console_port"`
	ConsolePath  string `json:"console_path"`
	APIServer    string `json:"api_server"`
	APIToken     string `json:"api_token"` // 留空=保持不变（更新时）
	CredentialID *uint  `json:"credential_id"`
	Description  string `json:"description"`
}

func normalizeCluster(req *clusterReq, cl *model.K8sCluster) {
	cl.Name = strings.TrimSpace(req.Name)
	cl.VIP = strings.TrimSpace(req.VIP)
	cl.ConsolePort = req.ConsolePort
	if cl.ConsolePort <= 0 || cl.ConsolePort > 65535 {
		cl.ConsolePort = 443
	}
	cl.ConsolePath = strings.TrimSpace(req.ConsolePath)
	if cl.ConsolePath == "" {
		cl.ConsolePath = "/"
	}
	cl.APIServer = strings.TrimSpace(req.APIServer)
	cl.CredentialID = req.CredentialID
	cl.Description = req.Description
}

// CreateK8sCluster 新建集群
func CreateK8sCluster(c *gin.Context) {
	var req clusterReq
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, "参数格式错误")
		return
	}
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.VIP) == "" {
		SendError(c, 400, "集群名称与 VIP 必填")
		return
	}
	cl := model.K8sCluster{OwnerID: currentUserID(c)}
	normalizeCluster(&req, &cl)
	cl.APIToken = strings.TrimSpace(req.APIToken)
	if err := store.GlobalDB.Create(&cl).Error; err != nil {
		SendError(c, 500, "创建集群失败")
		return
	}
	enrichCluster(&cl)
	SendSuccess(c, cl)
}

// UpdateK8sCluster 编辑集群
func UpdateK8sCluster(c *gin.Context) {
	cl, ok := loadCluster(c)
	if !ok {
		return
	}
	var req clusterReq
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, "参数格式错误")
		return
	}
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.VIP) == "" {
		SendError(c, 400, "集群名称与 VIP 必填")
		return
	}
	normalizeCluster(&req, cl)
	if t := strings.TrimSpace(req.APIToken); t != "" {
		cl.APIToken = t // 留空则保持原 token 不变
	}
	store.GlobalDB.Save(cl)
	enrichCluster(cl)
	SendSuccess(c, cl)
}

// DeleteK8sCluster 删除集群（节点解引用，资产本身保留）
func DeleteK8sCluster(c *gin.Context) {
	cl, ok := loadCluster(c)
	if !ok {
		return
	}
	db := store.GlobalDB
	db.Model(&model.Asset{}).Where("k8s_cluster_id = ?", cl.ID).Update("k8s_cluster_id", nil)
	db.Delete(cl)
	SendSuccess(c, gin.H{"ok": true})
}

// GetK8sCluster 集群详情 + 节点列表
func GetK8sCluster(c *gin.Context) {
	cl, ok := loadCluster(c)
	if !ok {
		return
	}
	enrichCluster(cl)
	probeClusterOnline(cl)
	var nodes []model.Asset
	store.GlobalDB.Where("k8s_cluster_id = ?", cl.ID).Order("k8s_role desc, ip asc").Find(&nodes)
	SendSuccess(c, gin.H{"cluster": cl, "nodes": nodes})
}

// ListUnassignedK8sNodes 已探测为 K8s 但未归类的节点（owner 隔离）
func ListUnassignedK8sNodes(c *gin.Context) {
	db := store.GlobalDB
	var nodes []model.Asset
	q := db.Where("k8s_role <> '' AND k8s_cluster_id IS NULL")
	if !isAdmin(c) {
		q = q.Where("owner_id = ?", currentUserID(c))
	}
	q.Order("k8s_role desc, ip asc").Find(&nodes)
	SendSuccess(c, nodes)
}

// AssignK8sNodes 把若干资产归类到集群（可选设角色）
func AssignK8sNodes(c *gin.Context) {
	cl, ok := loadCluster(c)
	if !ok {
		return
	}
	var req struct {
		AssetIDs []uint `json:"asset_ids"`
		Role     string `json:"role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, "参数格式错误")
		return
	}
	db := store.GlobalDB
	assigned := 0
	for _, aid := range req.AssetIDs {
		var asset model.Asset
		if db.First(&asset, aid).Error != nil {
			continue
		}
		if !canAccess(c, asset.OwnerID) {
			continue
		}
		asset.K8sClusterID = &cl.ID
		if req.Role == "control-plane" || req.Role == "worker" {
			asset.K8sRole = req.Role
		} else if asset.K8sRole == "" {
			asset.K8sRole = "worker"
		}
		asset.Tags = mergeTagJSON(asset.Tags, "k8s")
		db.Save(&asset)
		assigned++
	}
	db.Create(&model.AuditLog{
		Actor: currentUsername(c), Action: "K8S_ASSIGN",
		Path:   fmt.Sprintf("集群#%d 归类 %d 个节点", cl.ID, assigned),
		Status: 200, IP: c.ClientIP(),
	})
	SendSuccess(c, gin.H{"assigned": assigned})
}

// UnassignK8sNode 把节点移出集群
func UnassignK8sNode(c *gin.Context) {
	cl, ok := loadCluster(c)
	if !ok {
		return
	}
	aid, _ := strconv.Atoi(c.Param("assetId"))
	var asset model.Asset
	if store.GlobalDB.First(&asset, aid).Error != nil {
		SendError(c, 404, "节点不存在")
		return
	}
	if !canAccess(c, asset.OwnerID) {
		SendError(c, 403, "无权操作该节点")
		return
	}
	store.GlobalDB.Model(&asset).Where("k8s_cluster_id = ?", cl.ID).Update("k8s_cluster_id", nil)
	SendSuccess(c, gin.H{"ok": true})
}

// GetK8sConsole 返回一键控制台所需信息（URL + 账号 + 密码），并审计
func GetK8sConsole(c *gin.Context) {
	cl, ok := loadCluster(c)
	if !ok {
		return
	}
	path := cl.ConsolePath
	if path == "" {
		path = "/"
	}
	url := fmt.Sprintf("https://%s:%d%s", cl.VIP, cl.ConsolePort, path)

	var username, password string
	if cl.CredentialID != nil {
		var cred model.Credential
		if store.GlobalDB.First(&cred, *cl.CredentialID).Error == nil {
			username = cred.Username
			password = cred.Password
		}
	}
	store.GlobalDB.Create(&model.AuditLog{
		Actor: currentUsername(c), Action: "K8S_CONSOLE",
		Path:   fmt.Sprintf("集群#%d 打开控制台 %s", cl.ID, url),
		Status: 200, IP: c.ClientIP(),
	})
	SendSuccess(c, gin.H{"url": url, "username": username, "password": password})
}

// ── Phase 3：调用 kube-apiserver 拉取实时节点 / Pod（只读看板）────────
// 认证用集群绑定的 ServiceAccount Bearer Token，调用全部在服务端完成，Token 不出后端。

func kubeAPIServer(cl *model.K8sCluster) string {
	s := strings.TrimSpace(cl.APIServer)
	if s == "" {
		s = cl.VIP + ":6443"
	}
	s = strings.TrimPrefix(s, "https://")
	s = strings.TrimPrefix(s, "http://")
	return strings.TrimRight(s, "/")
}

// kubeGet 对 kube-apiserver 发起带 Bearer Token 的 GET（跳过 TLS 校验）
func kubeGet(cl *model.K8sCluster, path string) ([]byte, int, error) {
	url := "https://" + kubeAPIServer(cl) + path
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, 0, err
	}
	if cl.APIToken != "" {
		req.Header.Set("Authorization", "Bearer "+cl.APIToken)
	}
	client := &http.Client{
		Timeout:   8 * time.Second,
		Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	return body, resp.StatusCode, nil
}

type kubeNodeList struct {
	Items []struct {
		Metadata struct {
			Name              string            `json:"name"`
			Labels            map[string]string `json:"labels"`
			CreationTimestamp string            `json:"creationTimestamp"`
		} `json:"metadata"`
		Status struct {
			NodeInfo struct {
				KubeletVersion string `json:"kubeletVersion"`
				OSImage        string `json:"osImage"`
				Architecture   string `json:"architecture"`
			} `json:"nodeInfo"`
			Addresses []struct {
				Type    string `json:"type"`
				Address string `json:"address"`
			} `json:"addresses"`
			Conditions []struct {
				Type   string `json:"type"`
				Status string `json:"status"`
			} `json:"conditions"`
		} `json:"status"`
	} `json:"items"`
}

type kubePodList struct {
	Items []struct {
		Metadata struct {
			Name              string `json:"name"`
			Namespace         string `json:"namespace"`
			CreationTimestamp string `json:"creationTimestamp"`
		} `json:"metadata"`
		Spec struct {
			NodeName string `json:"nodeName"`
		} `json:"spec"`
		Status struct {
			Phase             string `json:"phase"`
			ContainerStatuses []struct {
				RestartCount int `json:"restartCount"`
			} `json:"containerStatuses"`
		} `json:"status"`
	} `json:"items"`
}

// loadClusterWithToken 加载集群并要求已配置 Token；失败时已写响应
func loadClusterWithToken(c *gin.Context) (*model.K8sCluster, bool) {
	cl, ok := loadCluster(c)
	if !ok {
		return nil, false
	}
	if strings.TrimSpace(cl.APIToken) == "" {
		SendError(c, 400, "该集群未配置 API Token，无法拉取实时数据（请在集群编辑里填 ServiceAccount Bearer Token）")
		return nil, false
	}
	return cl, true
}

// GetK8sLiveNodes 实时节点列表
func GetK8sLiveNodes(c *gin.Context) {
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
	_ = json.Unmarshal(body, &list)
	out := make([]gin.H, 0, len(list.Items))
	for _, n := range list.Items {
		ready := "NotReady"
		for _, cond := range n.Status.Conditions {
			if cond.Type == "Ready" && cond.Status == "True" {
				ready = "Ready"
			}
		}
		ip := ""
		for _, a := range n.Status.Addresses {
			if a.Type == "InternalIP" {
				ip = a.Address
			}
		}
		role := "worker"
		for k := range n.Metadata.Labels {
			if strings.Contains(k, "node-role.kubernetes.io/control-plane") || strings.Contains(k, "node-role.kubernetes.io/master") {
				role = "control-plane"
			}
		}
		out = append(out, gin.H{
			"name": n.Metadata.Name, "ready": ready, "role": role, "ip": ip,
			"version": n.Status.NodeInfo.KubeletVersion, "os": n.Status.NodeInfo.OSImage,
			"arch": n.Status.NodeInfo.Architecture, "created_at": n.Metadata.CreationTimestamp,
		})
	}
	SendSuccess(c, out)
}

// GetK8sLivePods 实时 Pod 列表（可选 ?namespace=）
func GetK8sLivePods(c *gin.Context) {
	cl, ok := loadClusterWithToken(c)
	if !ok {
		return
	}
	path := "/api/v1/pods?limit=500"
	if ns := strings.TrimSpace(c.Query("namespace")); ns != "" {
		path = "/api/v1/namespaces/" + ns + "/pods?limit=500"
	}
	body, code, err := kubeGet(cl, path)
	if err != nil {
		SendError(c, 502, "连接 kube-apiserver 失败: "+err.Error())
		return
	}
	if code != 200 {
		SendError(c, 502, fmt.Sprintf("kube API 返回 %d: %s", code, truncateStr(string(body), 200)))
		return
	}
	var list kubePodList
	_ = json.Unmarshal(body, &list)
	out := make([]gin.H, 0, len(list.Items))
	for _, p := range list.Items {
		restarts := 0
		for _, cs := range p.Status.ContainerStatuses {
			restarts += cs.RestartCount
		}
		out = append(out, gin.H{
			"name": p.Metadata.Name, "namespace": p.Metadata.Namespace, "phase": p.Status.Phase,
			"node": p.Spec.NodeName, "restarts": restarts, "created_at": p.Metadata.CreationTimestamp,
		})
	}
	SendSuccess(c, out)
}

// GetK8sOverview 集群概览（节点就绪/总数、Pod 运行/总数、版本）
func GetK8sOverview(c *gin.Context) {
	cl, ok := loadCluster(c)
	if !ok {
		return
	}
	if strings.TrimSpace(cl.APIToken) == "" {
		SendSuccess(c, gin.H{"has_token": false})
		return
	}
	nodeBody, nc, _ := kubeGet(cl, "/api/v1/nodes")
	podBody, pc, _ := kubeGet(cl, "/api/v1/pods?limit=2000")
	if nc != 200 || pc != 200 {
		SendError(c, 502, "kube API 调用失败，请检查 API Server 地址与 Token 权限")
		return
	}
	var nl kubeNodeList
	var pl kubePodList
	_ = json.Unmarshal(nodeBody, &nl)
	_ = json.Unmarshal(podBody, &pl)
	nodesReady, version := 0, ""
	for _, n := range nl.Items {
		for _, cond := range n.Status.Conditions {
			if cond.Type == "Ready" && cond.Status == "True" {
				nodesReady++
			}
		}
		if version == "" {
			version = n.Status.NodeInfo.KubeletVersion
		}
	}
	podsRunning := 0
	for _, p := range pl.Items {
		if p.Status.Phase == "Running" {
			podsRunning++
		}
	}
	store.GlobalDB.Create(&model.AuditLog{
		Actor: currentUsername(c), Action: "K8S_API",
		Path:   fmt.Sprintf("集群#%d 拉取实时看板", cl.ID),
		Status: 200, IP: c.ClientIP(),
	})
	SendSuccess(c, gin.H{
		"has_token": true, "version": version,
		"nodes_total": len(nl.Items), "nodes_ready": nodesReady,
		"pods_total": len(pl.Items), "pods_running": podsRunning,
	})
}

// ── 自动归类：从节点 /etc/hosts 的 cluster-vip 标记推断集群 VIP，按 VIP 分组建/并集群 ──
// 标记格式（示例）：
//   ### 97.cluster-vip ###
//   172.16.4.24 004024.hc   ← 该 IP 即前端 VIP，控制台路径默认 /uc

// parseClusterVIP 从 /etc/hosts 文本里解析 cluster-vip 标记下方的 VIP 与主机名
func parseClusterVIP(hosts string) (vip string, hostname string, ok bool) {
	lines := strings.Split(hosts, "\n")
	for i, ln := range lines {
		if !strings.Contains(strings.ToLower(ln), "cluster-vip") {
			continue
		}
		// 取标记下方第一条「非空、非注释」的数据行
		for j := i + 1; j < len(lines); j++ {
			t := strings.TrimSpace(lines[j])
			if t == "" || strings.HasPrefix(t, "#") {
				continue
			}
			fields := strings.Fields(t)
			if len(fields) >= 1 && net.ParseIP(fields[0]) != nil {
				h := ""
				if len(fields) >= 2 {
					h = fields[1]
				}
				return fields[0], h, true
			}
			break // 标记后首条数据行不是 IP，放弃
		}
	}
	return "", "", false
}

// fetchClusterVIP SSH 到节点 cat /etc/hosts 并解析 VIP
func fetchClusterVIP(node *model.Asset) (string, string, error) {
	if node.CredentialID == nil {
		return "", "", fmt.Errorf("未绑定凭据")
	}
	var cred model.Credential
	if store.GlobalDB.First(&cred, *node.CredentialID).Error != nil {
		return "", "", fmt.Errorf("凭据不存在")
	}
	if cred.Type == "telnet" {
		return "", "", fmt.Errorf("telnet 不支持")
	}
	client, err := dialSSHForAsset(node, &cred)
	if err != nil {
		return "", "", fmt.Errorf("SSH 连接失败: %v", err)
	}
	defer client.Close()
	sess, err := client.NewSession()
	if err != nil {
		return "", "", err
	}
	defer sess.Close()
	out, err := sess.CombinedOutput("cat /etc/hosts")
	if err != nil {
		return "", "", fmt.Errorf("读取 /etc/hosts 失败: %v", err)
	}
	vip, host, ok := parseClusterVIP(string(out))
	if !ok {
		return "", "", fmt.Errorf("未找到 cluster-vip 标记")
	}
	return vip, host, nil
}

// AutoClassifyK8s 对有凭据的 K8s 节点逐个读 /etc/hosts 取 VIP，按 VIP 归类到集群（无则建）
func AutoClassifyK8s(c *gin.Context) {
	db := store.GlobalDB
	var nodes []model.Asset
	q := db.Where("k8s_role <> '' AND credential_id IS NOT NULL")
	if !isAdmin(c) {
		q = q.Where("owner_id = ?", currentUserID(c))
	}
	q.Find(&nodes)

	assigned, created := 0, 0
	cache := map[string]*model.K8sCluster{} // vip(owner) -> cluster
	details := make([]gin.H, 0, len(nodes))

	for i := range nodes {
		node := &nodes[i]
		vip, host, err := fetchClusterVIP(node)
		if err != nil {
			details = append(details, gin.H{"ip": node.IP, "ok": false, "msg": err.Error()})
			continue
		}
		key := fmt.Sprintf("%d/%s", node.OwnerID, vip)
		cl := cache[key]
		if cl == nil {
			var existing model.K8sCluster
			if db.Where("owner_id = ? AND vip = ?", node.OwnerID, vip).First(&existing).Error == nil {
				cl = &existing
			} else {
				name := host
				if name == "" {
					name = "cluster-" + vip
				}
				nc := model.K8sCluster{OwnerID: node.OwnerID, Name: name, VIP: vip, ConsolePort: 443, ConsolePath: "/uc"}
				db.Create(&nc)
				cl = &nc
				created++
			}
			cache[key] = cl
		}
		node.K8sClusterID = &cl.ID
		node.Tags = mergeTagJSON(node.Tags, "k8s")
		db.Save(node)
		assigned++
		details = append(details, gin.H{"ip": node.IP, "ok": true, "vip": vip, "cluster": cl.Name})
	}

	db.Create(&model.AuditLog{
		Actor: currentUsername(c), Action: "K8S_AUTOCLASSIFY",
		Path:   fmt.Sprintf("自动归类：处理 %d，归类 %d，新建集群 %d", len(nodes), assigned, created),
		Status: 200, IP: c.ClientIP(),
	})
	SendSuccess(c, gin.H{"processed": len(nodes), "assigned": assigned, "clusters_created": created, "details": details})
}

// mergeTagJSON 把 tag 并入 JSON 字符串数组（去重）
func mergeTagJSON(existing, tag string) string {
	arr := []string{}
	if strings.TrimSpace(existing) != "" {
		_ = json.Unmarshal([]byte(existing), &arr)
	}
	for _, t := range arr {
		if t == tag {
			return existing
		}
	}
	arr = append(arr, tag)
	b, _ := json.Marshal(arr)
	return string(b)
}
