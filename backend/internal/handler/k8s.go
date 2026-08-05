package handler

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
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
	// 客户端证书也算「能调 kube API」，否则用 kubeconfig 证书接入的集群会被当成未配置
	cl.HasToken = kubeConfigured(cl)
	if cl.CredentialID != nil {
		var cred model.Credential
		if db.First(&cred, *cl.CredentialID).Error == nil {
			cl.CredName = cred.Name
		}
	}
}

// enrichClusters 批量填充展示字段。
// 原先是逐个集群调 enrichCluster：每个 2 次 COUNT + 1 次凭据查询，20 个集群就要 60 条 SQL，
// 集群一多列表页就明显变慢。这里改成一次 GROUP BY 取全部计数 + 一次 IN 取凭据名。
func enrichClusters(clusters []model.K8sCluster) {
	if len(clusters) == 0 {
		return
	}
	db := store.GlobalDB
	ids := make([]uint, 0, len(clusters))
	credIDs := make([]uint, 0, len(clusters))
	for i := range clusters {
		ids = append(ids, clusters[i].ID)
		clusters[i].HasToken = kubeConfigured(&clusters[i])
		if clusters[i].CredentialID != nil {
			credIDs = append(credIDs, *clusters[i].CredentialID)
		}
	}

	type countRow struct {
		K8sClusterID uint
		Total        int
		Masters      int
	}
	var rows []countRow
	db.Model(&model.Asset{}).
		Select("k8s_cluster_id, COUNT(*) AS total, SUM(CASE WHEN k8s_role = 'control-plane' THEN 1 ELSE 0 END) AS masters").
		Where("k8s_cluster_id IN ?", ids).
		Group("k8s_cluster_id").
		Scan(&rows)
	counts := make(map[uint]countRow, len(rows))
	for _, r := range rows {
		counts[r.K8sClusterID] = r
	}

	credNames := map[uint]string{}
	if len(credIDs) > 0 {
		var creds []model.Credential
		db.Where("id IN ?", credIDs).Find(&creds)
		for _, cr := range creds {
			credNames[cr.ID] = cr.Name
		}
	}

	for i := range clusters {
		if r, ok := counts[clusters[i].ID]; ok {
			clusters[i].NodeCount = r.Total
			clusters[i].MasterCount = r.Masters
		}
		if clusters[i].CredentialID != nil {
			clusters[i].CredName = credNames[*clusters[i].CredentialID]
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
	enrichClusters(clusters)
	var wg sync.WaitGroup
	for i := range clusters {
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
	// 跨租户防护：不可绑定他人凭据（控制台会回传该凭据明文密码）
	if !assertCredentialOwned(c, req.CredentialID) {
		SendError(c, 403, "无权使用该凭据")
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
	// 跨租户防护：不可把集群改绑到他人凭据
	if !assertCredentialOwned(c, req.CredentialID) {
		SendError(c, 403, "无权使用该凭据")
		return
	}
	normalizeCluster(&req, cl)
	if t := strings.TrimSpace(req.APIToken); t != "" {
		cl.APIToken = t // 留空则保持原 token 不变
	}
	// 写失败必须报出来：sqlite 在并发写下会返回 SQLITE_BUSY，
	// 吞掉的话接口照样 200，用户以为改成功了其实没落库。
	if err := store.GlobalDB.Save(cl).Error; err != nil {
		SendError(c, 500, "保存集群失败: "+err.Error())
		return
	}
	// APIServer / Token 可能刚被改过，旧缓存必须作废，否则还在拿改动前的结果
	invalidateKubeCache(cl.ID)
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
	// 写结果必须检查：SQLite 写争用（SQLITE_BUSY）或其它错误下若静默返回 200，
	// 前端会以为删掉了，实际集群与节点引用仍在库里，刷新后又冒出来。
	if err := db.Model(&model.Asset{}).Where("k8s_cluster_id = ?", cl.ID).Update("k8s_cluster_id", nil).Error; err != nil {
		SendError(c, 500, "解除节点集群引用失败: "+err.Error())
		return
	}
	if err := db.Delete(cl).Error; err != nil {
		SendError(c, 500, "删除集群失败: "+err.Error())
		return
	}
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
	var failed []string
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
		// 之前这里不看返回值，写失败也照样 assigned++，前端显示归类成功但库里没变
		if err := db.Save(&asset).Error; err != nil {
			failed = append(failed, fmt.Sprintf("%s: %v", asset.IP, err))
			continue
		}
		assigned++
	}
	db.Create(&model.AuditLog{
		Actor: currentUsername(c), Action: "K8S_ASSIGN",
		Path:   fmt.Sprintf("集群#%d 归类 %d 个节点", cl.ID, assigned),
		Status: 200, IP: c.ClientIP(),
	})
	SendSuccess(c, gin.H{"assigned": assigned, "failed": failed})
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

// ── kube API 短 TTL 缓存 ──────────────────────────────────────────
// 打开集群抽屉会并发触发 overview / live-nodes / live-pods 三个接口，
// 而 overview 内部还要自己再拉一遍节点和 Pod：一次点击最多打出 4 次 apiserver 调用、
// 其中两份是完整 Pod 列表（2000 Pod 的集群就是十几 MB JSON 拉两遍）。
// 这里加一层 10s 缓存，让三个接口共用同一份拉取结果；节点/Pod 的「规范路径」
// 统一由 kubeNodesPath / kubePodsPath 给出，保证它们命中同一个 key。
const kubeCacheTTL = 10 * time.Second

// kubePodsPageCap 单次向 apiserver 取 Pod 的上限。
// 超过这个数就只能看到前 N 个——但必须让用户知道（truncated 标志），不能悄悄砍。
const kubePodsPageCap = 2000

type kubeCacheEntry struct {
	body []byte
	code int
	at   time.Time
}

var (
	kubeCacheMu sync.RWMutex
	kubeCache   = map[string]kubeCacheEntry{}
)

// kubeNodesPath 节点列表的规范路径（overview / live-nodes 共用同一 key）
func kubeNodesPath() string { return "/api/v1/nodes" }

// kubePodsPath Pod 列表的规范路径。分页在服务端内存里切，
// 不按页码拼不同的 URL——否则每翻一页就是一次新的全量拉取，缓存也全部落空。
func kubePodsPath(namespace string) string {
	if ns := strings.TrimSpace(namespace); ns != "" {
		return "/api/v1/namespaces/" + ns + "/pods?limit=" + strconv.Itoa(kubePodsPageCap)
	}
	return "/api/v1/pods?limit=" + strconv.Itoa(kubePodsPageCap)
}

// invalidateKubeCache 清掉某集群的全部缓存。
// 改了 Token / APIServer 或刚同步完节点后必须调，否则还在读改动前的旧结果。
func invalidateKubeCache(clusterID uint) {
	prefix := strconv.FormatUint(uint64(clusterID), 10) + "|"
	kubeCacheMu.Lock()
	defer kubeCacheMu.Unlock()
	for k := range kubeCache {
		if strings.HasPrefix(k, prefix) {
			delete(kubeCache, k)
		}
	}
}

// kubeGetCached 带 TTL 缓存的 GET。
// 只缓存成功响应：失败结果要是也缓住，用户改完配置立刻重试仍会看到旧报错。
func kubeGetCached(cl *model.K8sCluster, path string) ([]byte, int, error) {
	key := strconv.FormatUint(uint64(cl.ID), 10) + "|" + path

	kubeCacheMu.RLock()
	e, hit := kubeCache[key]
	kubeCacheMu.RUnlock()
	if hit && time.Since(e.at) < kubeCacheTTL {
		return e.body, e.code, nil
	}

	body, code, err := kubeGet(cl, path)
	if err != nil || code != 200 {
		return body, code, err
	}

	kubeCacheMu.Lock()
	// 顺手清过期项：集群数与路径种类都有限，但长期运行仍不该让它无界增长
	if len(kubeCache) > 256 {
		for k, v := range kubeCache {
			if time.Since(v.at) >= kubeCacheTTL {
				delete(kubeCache, k)
			}
		}
	}
	kubeCache[key] = kubeCacheEntry{body: body, code: code, at: time.Now()}
	kubeCacheMu.Unlock()
	return body, code, nil
}

// kubeTLSConfig 按集群配置组装 TLS。
//   - clientcert 模式：装载客户端证书对（kubeconfig 里最常见的认证方式）
//   - 配了 CA：装载并真校验 apiserver 证书；没配则沿用项目既有取舍跳过校验
func kubeTLSConfig(cl *model.K8sCluster) (*tls.Config, error) {
	cfg := &tls.Config{InsecureSkipVerify: true}
	if cl.AuthMode == "clientcert" && cl.ClientCert != "" && cl.ClientKey != "" {
		pair, err := tls.X509KeyPair([]byte(cl.ClientCert), []byte(cl.ClientKey))
		if err != nil {
			return nil, fmt.Errorf("客户端证书/私钥无法解析: %v", err)
		}
		cfg.Certificates = []tls.Certificate{pair}
	}
	if strings.TrimSpace(cl.CACert) != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(cl.CACert)) {
			return nil, fmt.Errorf("CA 证书无法解析")
		}
		cfg.RootCAs = pool
		cfg.InsecureSkipVerify = false
	}
	return cfg, nil
}

// kubeAuthHeader 需要带 Bearer 时返回 token，clientcert 模式返回空
func kubeAuthHeader(cl *model.K8sCluster) string {
	if cl.AuthMode == "clientcert" {
		return ""
	}
	return strings.TrimSpace(cl.APIToken)
}

// kubeGet 对 kube-apiserver 发起 GET（Bearer Token 或客户端证书认证）
func kubeGet(cl *model.K8sCluster, path string) ([]byte, int, error) {
	url := "https://" + kubeAPIServer(cl) + path
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, 0, err
	}
	if tok := kubeAuthHeader(cl); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	tlsCfg, err := kubeTLSConfig(cl)
	if err != nil {
		return nil, 0, err
	}
	client := &http.Client{
		Timeout:   8 * time.Second,
		Transport: &http.Transport{TLSClientConfig: tlsCfg},
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
	// continue 非空说明 apiserver 还有下一页——即本次只看到了前 kubePodsPageCap 个。
	// 这是判断「列表被截断」的唯一可靠依据，必须回传给前端。
	Metadata struct {
		Continue string `json:"continue"`
	} `json:"metadata"`
	Items []struct {
		Metadata struct {
			Name              string `json:"name"`
			Namespace         string `json:"namespace"`
			CreationTimestamp string `json:"creationTimestamp"`
		} `json:"metadata"`
		Spec struct {
			NodeName string `json:"nodeName"`
			// 容器名：多容器 Pod 开终端时必须指定 container，否则 apiserver 报错
			Containers []struct {
				Name string `json:"name"`
			} `json:"containers"`
		} `json:"spec"`
		Status struct {
			Phase             string `json:"phase"`
			ContainerStatuses []struct {
				RestartCount int `json:"restartCount"`
			} `json:"containerStatuses"`
		} `json:"status"`
	} `json:"items"`
}

// kubeConfigured 集群是否具备调 kube API 的凭证：Bearer Token 或客户端证书对
func kubeConfigured(cl *model.K8sCluster) bool {
	if strings.TrimSpace(cl.APIToken) != "" {
		return true
	}
	return strings.TrimSpace(cl.ClientCert) != "" && strings.TrimSpace(cl.ClientKey) != ""
}

// loadClusterWithToken 加载集群并要求已配置 kube API 凭证；失败时已写响应
func loadClusterWithToken(c *gin.Context) (*model.K8sCluster, bool) {
	cl, ok := loadCluster(c)
	if !ok {
		return nil, false
	}
	if !kubeConfigured(cl) {
		SendError(c, 400, "该集群未配置 kube API 凭证，无法拉取实时数据（可导入 kubeconfig，或填 ServiceAccount Bearer Token）")
		return nil, false
	}
	return cl, true
}

// fetchKubeNodes 拉节点列表（走缓存）。解析失败按错误返回，不再吞掉——
// 吞掉的话前端看到的是「空列表」，会被当成「集群没有节点」，而不是「拉取出问题了」。
func fetchKubeNodes(cl *model.K8sCluster) (*kubeNodeList, error) {
	body, code, err := kubeGetCached(cl, kubeNodesPath())
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
	return &list, nil
}

// fetchKubePods 拉 Pod 列表（走缓存，路径规范化以便与 overview 共用同一份结果）
func fetchKubePods(cl *model.K8sCluster, namespace string) (*kubePodList, error) {
	body, code, err := kubeGetCached(cl, kubePodsPath(namespace))
	if err != nil {
		return nil, fmt.Errorf("连接 kube-apiserver 失败: %v", err)
	}
	if code != 200 {
		return nil, fmt.Errorf("kube API 返回 %d: %s", code, truncateStr(string(body), 200))
	}
	var list kubePodList
	if err := json.Unmarshal(body, &list); err != nil {
		return nil, fmt.Errorf("解析 Pod 列表失败: %v", err)
	}
	return &list, nil
}

// GetK8sLiveNodes 实时节点列表
func GetK8sLiveNodes(c *gin.Context) {
	cl, ok := loadClusterWithToken(c)
	if !ok {
		return
	}
	list, err := fetchKubeNodes(cl)
	if err != nil {
		SendError(c, 502, err.Error())
		return
	}
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

// GetK8sLivePods 实时 Pod 列表（可选 ?namespace=、?page=、?page_size=）
//
// 分页在服务端内存里切：向 apiserver 只发一次规范请求（同一 key 与 overview 共用缓存），
// 翻页不再重新拉取。truncated 为真表示集群 Pod 数超过 kubePodsPageCap，
// 本次只看到前 N 个——这个必须显式告诉前端，原先是直接砍到 500 且界面上完全看不出来。
func GetK8sLivePods(c *gin.Context) {
	cl, ok := loadClusterWithToken(c)
	if !ok {
		return
	}
	ns := strings.TrimSpace(c.Query("namespace"))
	list, err := fetchKubePods(cl, ns)
	if err != nil {
		SendError(c, 502, err.Error())
		return
	}

	all := make([]gin.H, 0, len(list.Items))
	for _, p := range list.Items {
		restarts := 0
		for _, cs := range p.Status.ContainerStatuses {
			restarts += cs.RestartCount
		}
		containers := make([]string, 0, len(p.Spec.Containers))
		for _, ct := range p.Spec.Containers {
			containers = append(containers, ct.Name)
		}
		all = append(all, gin.H{
			"name": p.Metadata.Name, "namespace": p.Metadata.Namespace, "phase": p.Status.Phase,
			"node": p.Spec.NodeName, "restarts": restarts, "created_at": p.Metadata.CreationTimestamp,
			"containers": containers,
		})
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 500 {
		size = 50
	}
	start := (page - 1) * size
	if start > len(all) {
		start = len(all)
	}
	end := start + size
	if end > len(all) {
		end = len(all)
	}

	SendSuccess(c, gin.H{
		"items":     all[start:end],
		"total":     len(all),
		"page":      page,
		"page_size": size,
		"truncated": list.Metadata.Continue != "",
		"cap":       kubePodsPageCap,
	})
}

// GetK8sOverview 集群概览（节点就绪/总数、Pod 运行/总数、版本）
func GetK8sOverview(c *gin.Context) {
	cl, ok := loadCluster(c)
	if !ok {
		return
	}
	if !kubeConfigured(cl) {
		SendSuccess(c, gin.H{"has_token": false})
		return
	}
	// 节点与 Pod 并发拉取（原先串行，延迟直接叠加），
	// 且都走 kubeGetCached 的规范路径——与 live/nodes、live/pods 命中同一份缓存，
	// 一次打开抽屉只向 apiserver 各取一次，不再出现「两份完整 Pod 列表」。
	var (
		nl     *kubeNodeList
		pl     *kubePodList
		nErr   error
		pErr   error
		fetchW sync.WaitGroup
	)
	fetchW.Add(2)
	go func() { defer fetchW.Done(); nl, nErr = fetchKubeNodes(cl) }()
	go func() { defer fetchW.Done(); pl, pErr = fetchKubePods(cl, "") }()
	fetchW.Wait()
	if nErr != nil {
		SendError(c, 502, nErr.Error())
		return
	}
	if pErr != nil {
		SendError(c, 502, pErr.Error())
		return
	}
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
		// Pod 数触到上限时如实标注，避免把「前 2000 个」当成「全部」
		"pods_truncated": pl.Metadata.Continue != "",
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

// autoClassifyConcurrency 并发读 /etc/hosts 的 worker 数。
// SSH 握手动辄一两秒，原先串行处理几十个节点必然把 HTTP 请求拖到超时。
const autoClassifyConcurrency = 8

// autoClassifyNodeTimeout 单节点上限。没有这个的话，一台连不上的机器
// （SSH 端口被防火墙 DROP，TCP 一直挂着）就能拖垮整轮归类。
const autoClassifyNodeTimeout = 15 * time.Second

// vipProbeResult 单节点的探测结果
type vipProbeResult struct {
	node *model.Asset
	vip  string
	host string
	err  error
}

// probeClusterVIPs 并发读取各节点的 cluster-vip 标记。
// 只做「读」，不碰数据库——归类写入统一放回主协程串行做，
// 这样既不会并发建出重复集群，也不用给 SQLite 加写锁。
func probeClusterVIPs(nodes []model.Asset, onProgress func(done int, r vipProbeResult)) []vipProbeResult {
	results := make([]vipProbeResult, len(nodes))
	sem := make(chan struct{}, autoClassifyConcurrency)
	var wg sync.WaitGroup

	for i := range nodes {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			node := &nodes[idx]
			type vipOut struct {
				vip, host string
				err       error
			}
			ch := make(chan vipOut, 1)
			go func() {
				vip, host, err := fetchClusterVIP(node)
				ch <- vipOut{vip, host, err}
			}()

			select {
			case out := <-ch:
				results[idx] = vipProbeResult{node: node, vip: out.vip, host: out.host, err: out.err}
			case <-time.After(autoClassifyNodeTimeout):
				// 超时的 goroutine 会随 SSH 自身超时自然收尾（ch 有缓冲，不会泄漏）
				results[idx] = vipProbeResult{node: node, err: fmt.Errorf("探测超时（%s）", autoClassifyNodeTimeout)}
			}
			if onProgress != nil {
				onProgress(idx, results[idx])
			}
		}(i)
	}
	wg.Wait()
	return results
}

// autoClassifySummary 一轮自动归类的结果
type autoClassifySummary struct {
	Processed int     `json:"processed"`
	Assigned  int     `json:"assigned"`
	Created   int     `json:"clusters_created"`
	Details   []gin.H `json:"details"`
}

// autoClassifyCore 归类逻辑本体：并发探测 → 串行落库。
// onProgress 供 SSE 变体推进度用，同步接口传 nil。
func autoClassifyCore(c *gin.Context, onProgress func(done, total int, ip string)) *autoClassifySummary {
	db := store.GlobalDB
	var nodes []model.Asset
	q := db.Where("k8s_role <> '' AND credential_id IS NOT NULL")
	if !isAdmin(c) {
		q = q.Where("owner_id = ?", currentUserID(c))
	}
	q.Find(&nodes)

	total := len(nodes)
	var doneN int64
	probes := probeClusterVIPs(nodes, func(_ int, r vipProbeResult) {
		n := int(atomic.AddInt64(&doneN, 1))
		if onProgress != nil && r.node != nil {
			onProgress(n, total, r.node.IP)
		}
	})

	assigned, created := 0, 0
	seen := map[string]*model.K8sCluster{} // "owner/vip" -> cluster
	details := make([]gin.H, 0, total)

	for _, r := range probes {
		if r.node == nil {
			continue
		}
		if r.err != nil {
			details = append(details, gin.H{"ip": r.node.IP, "ok": false, "msg": r.err.Error()})
			continue
		}
		key := fmt.Sprintf("%d/%s", r.node.OwnerID, r.vip)
		cl := seen[key]
		if cl == nil {
			var existing model.K8sCluster
			if db.Where("owner_id = ? AND vip = ?", r.node.OwnerID, r.vip).First(&existing).Error == nil {
				cl = &existing
			} else {
				name := r.host
				if name == "" {
					name = "cluster-" + r.vip
				}
				nc := model.K8sCluster{OwnerID: r.node.OwnerID, Name: name, VIP: r.vip, ConsolePort: 443}
				// 控制台入口不再写死 /uc：探测真实路径与版本，探测不到才回落 /uc
				if best, _, found := probeConsole(&nc); found {
					applyConsoleProbe(&nc, best)
				} else {
					nc.ConsolePath = "/uc"
				}
				if err := db.Create(&nc).Error; err != nil {
					details = append(details, gin.H{"ip": r.node.IP, "ok": false, "msg": "建集群失败: " + err.Error()})
					continue
				}
				cl = &nc
				created++
			}
			seen[key] = cl
		}
		r.node.K8sClusterID = &cl.ID
		r.node.Tags = mergeTagJSON(r.node.Tags, "k8s")
		// 写失败不能计入 assigned，否则汇总数字是假的
		if err := db.Save(r.node).Error; err != nil {
			details = append(details, gin.H{"ip": r.node.IP, "ok": false, "msg": "保存失败: " + err.Error()})
			continue
		}
		assigned++
		details = append(details, gin.H{"ip": r.node.IP, "ok": true, "vip": r.vip, "cluster": cl.Name})
	}

	db.Create(&model.AuditLog{
		Actor: currentUsername(c), Action: "K8S_AUTOCLASSIFY",
		Path:   fmt.Sprintf("自动归类：处理 %d，归类 %d，新建集群 %d", total, assigned, created),
		Status: 200, IP: c.ClientIP(),
	})
	return &autoClassifySummary{Processed: total, Assigned: assigned, Created: created, Details: details}
}

// AutoClassifyK8s 对有凭据的 K8s 节点并发读 /etc/hosts 取 VIP，按 VIP 归类到集群（无则建）
func AutoClassifyK8s(c *gin.Context) {
	SendSuccess(c, autoClassifyCore(c, nil))
}

// StreamAutoClassifyK8s 自动归类（SSE 版）：边探测边推进度。
// 节点多时同步接口即便并发化也可能顶到网关超时，这里让前端能看到实时进展。
func StreamAutoClassifyK8s(c *gin.Context) {
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		SendError(c, 500, "streaming unsupported")
		return
	}

	// 进度事件来自多个 worker，必须串行写，否则 SSE 帧会交错损坏
	var writeMu sync.Mutex
	emit := func(event string, payload any) {
		b, _ := json.Marshal(payload)
		writeMu.Lock()
		defer writeMu.Unlock()
		fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, b)
		flusher.Flush()
	}

	sum := autoClassifyCore(c, func(done, total int, ip string) {
		emit("progress", gin.H{"done": done, "total": total, "ip": ip})
	})
	emit("done", sum)
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
