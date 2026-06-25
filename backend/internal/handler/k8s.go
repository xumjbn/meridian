package handler

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"backend/internal/model"
	"backend/internal/store"
	"github.com/gin-gonic/gin"
)

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
	for i := range clusters {
		enrichCluster(&clusters[i])
	}
	SendSuccess(c, clusters)
}

type clusterReq struct {
	Name         string `json:"name"`
	VIP          string `json:"vip"`
	ConsolePort  int    `json:"console_port"`
	ConsolePath  string `json:"console_path"`
	APIServer    string `json:"api_server"`
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
