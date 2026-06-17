package handler

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"time"

	"backend/internal/model"
	"backend/internal/scanner"
	"backend/internal/sshproxy"
	"backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"gorm.io/gorm"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true // 允许跨域进行 WebSocket 连接
	},
}

// JSONResponse 统一返回格式
type JSONResponse struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

func SendSuccess(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, JSONResponse{
		Code:    200,
		Message: "success",
		Data:    data,
	})
}

func SendError(c *gin.Context, code int, msg string) {
	c.JSON(http.StatusOK, JSONResponse{
		Code:    code,
		Message: msg,
	})
}

// logActivity 写入操作活动日志
func logActivity(db *gorm.DB, actType, message string, refID uint) {
	db.Create(&model.ActivityLog{
		Type:    actType,
		Message: message,
		RefID:   refID,
	})
}

// ==========================================
// 1. DashboardStats 控制器
// ==========================================

func GetDashboardStats(c *gin.Context) {
	db := store.GlobalDB

	var totalAssets, servers, switches, routers, other int64
	var onlineAssets, offlineAssets, runningTasks int64

	db.Model(&model.Asset{}).Count(&totalAssets)
	db.Model(&model.Asset{}).Where("type = ?", "server").Count(&servers)
	db.Model(&model.Asset{}).Where("type = ?", "switch").Count(&switches)
	db.Model(&model.Asset{}).Where("type = ?", "router").Count(&routers)
	db.Model(&model.Asset{}).Where("type = ?", "other").Count(&other)

	db.Model(&model.Asset{}).Where("status = ?", "online").Count(&onlineAssets)
	db.Model(&model.Asset{}).Where("status = ?", "offline").Count(&offlineAssets)
	db.Model(&model.ScanTask{}).Where("status = ?", "running").Count(&runningTasks)

	SendSuccess(c, gin.H{
		"total_assets":   totalAssets,
		"servers":        servers,
		"switches":       switches,
		"routers":        routers,
		"other":          other,
		"online_assets":  onlineAssets,
		"offline_assets": offlineAssets,
		"running_tasks":  runningTasks,
	})
}

// ==========================================
// 2. Credentials (凭据) 控制器
// ==========================================

func ListCredentials(c *gin.Context) {
	db := store.GlobalDB
	var creds []model.Credential
	if err := db.Order("id desc").Find(&creds).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	SendSuccess(c, creds)
}

func CreateCredential(c *gin.Context) {
	db := store.GlobalDB
	var cred model.Credential
	if err := c.ShouldBindJSON(&cred); err != nil {
		SendError(c, 400, err.Error())
		return
	}

	if cred.Name == "" || cred.Type == "" {
		SendError(c, 400, "名称和凭证类型不能为空")
		return
	}

	if err := db.Create(&cred).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	SendSuccess(c, cred)
}

func UpdateCredential(c *gin.Context) {
	db := store.GlobalDB
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)

	var cred model.Credential
	if err := db.First(&cred, id).Error; err != nil {
		SendError(c, 404, "凭据不存在")
		return
	}

	if err := c.ShouldBindJSON(&cred); err != nil {
		SendError(c, 400, err.Error())
		return
	}

	if err := db.Save(&cred).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	SendSuccess(c, cred)
}

func DeleteCredential(c *gin.Context) {
	db := store.GlobalDB
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)

	if err := db.Delete(&model.Credential{}, id).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	SendSuccess(c, nil)
}

// ==========================================
// 3. Assets (资产) 控制器
// ==========================================

func ListAssets(c *gin.Context) {
	db := store.GlobalDB
	var assets []model.Asset

	q := c.Query("q")
	assetType := c.Query("type")
	status := c.Query("status")

	query := db.Model(&model.Asset{})
	if q != "" {
		query = query.Where("name LIKE ? OR ip LIKE ?", "%"+q+"%", "%"+q+"%")
	}
	if assetType != "" {
		query = query.Where("type = ?", assetType)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}

	if err := query.Order("ip asc").Find(&assets).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	SendSuccess(c, assets)
}

// GetAsset 获取单个资产详情
func GetAsset(c *gin.Context) {
	db := store.GlobalDB
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)

	var asset model.Asset
	if err := db.First(&asset, id).Error; err != nil {
		SendError(c, 404, "资产不存在")
		return
	}
	SendSuccess(c, asset)
}

func CreateAsset(c *gin.Context) {
	db := store.GlobalDB
	var asset model.Asset
	if err := c.ShouldBindJSON(&asset); err != nil {
		SendError(c, 400, err.Error())
		return
	}

	if asset.Name == "" || asset.IP == "" {
		SendError(c, 400, "名称和IP地址不能为空")
		return
	}

	// 检查 IP 唯一性
	var count int64
	db.Model(&model.Asset{}).Where("ip = ?", asset.IP).Count(&count)
	if count > 0 {
		SendError(c, 400, "该 IP 地址已存在")
		return
	}

	asset.Status = "unknown"
	if err := db.Create(&asset).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}

	db.Create(&model.ActivityLog{
		Type:    "asset_created",
		Message: fmt.Sprintf("资产 %s (%s) 已创建", asset.Name, asset.IP),
		RefID:   asset.ID,
	})

	SendSuccess(c, asset)
}

func UpdateAsset(c *gin.Context) {
	db := store.GlobalDB
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)

	var asset model.Asset
	if err := db.First(&asset, id).Error; err != nil {
		SendError(c, 404, "资产不存在")
		return
	}

	// 绑定更新数据
	var req model.Asset
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, err.Error())
		return
	}

	asset.Name = req.Name
	asset.IP = req.IP
	asset.Type = req.Type
	asset.Description = req.Description
	asset.Tags = req.Tags
	asset.CredentialID = req.CredentialID
	if req.Status != "" {
		asset.Status = req.Status
	}

	if err := db.Save(&asset).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}

	db.Create(&model.ActivityLog{
		Type:    "asset_updated",
		Message: fmt.Sprintf("资产 %s (%s) 信息已更新", asset.Name, asset.IP),
		RefID:   asset.ID,
	})

	SendSuccess(c, asset)
}

func DeleteAsset(c *gin.Context) {
	db := store.GlobalDB
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)

	var asset model.Asset
	db.First(&asset, id)

	if err := db.Delete(&model.Asset{}, id).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}

	db.Create(&model.ActivityLog{
		Type:    "asset_deleted",
		Message: fmt.Sprintf("资产 %s (%s) 已删除", asset.Name, asset.IP),
		RefID:   uint(id),
	})

	SendSuccess(c, nil)
}

// ==========================================
// 4. ScanTasks (扫描任务) 控制器
// ==========================================

func ListScanTasks(c *gin.Context) {
	db := store.GlobalDB
	var tasks []model.ScanTask
	if err := db.Order("id desc").Find(&tasks).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	SendSuccess(c, tasks)
}

func CreateScanTask(c *gin.Context) {
	db := store.GlobalDB
	var task model.ScanTask
	if err := c.ShouldBindJSON(&task); err != nil {
		SendError(c, 400, err.Error())
		return
	}

	if task.Name == "" || task.TargetRange == "" {
		SendError(c, 400, "名称和扫描网段不能为空")
		return
	}

	task.Status = "idle"
	if err := db.Create(&task).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	SendSuccess(c, task)
}

func UpdateScanTask(c *gin.Context) {
	db := store.GlobalDB
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)

	var task model.ScanTask
	if err := db.First(&task, id).Error; err != nil {
		SendError(c, 404, "扫描任务不存在")
		return
	}

	if err := c.ShouldBindJSON(&task); err != nil {
		SendError(c, 400, err.Error())
		return
	}

	if err := db.Save(&task).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	SendSuccess(c, task)
}

func DeleteScanTask(c *gin.Context) {
	db := store.GlobalDB
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)

	if err := db.Delete(&model.ScanTask{}, id).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	SendSuccess(c, nil)
}

// RunScanTask 异步启动扫描任务
func RunScanTask(c *gin.Context) {
	db := store.GlobalDB
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)

	var task model.ScanTask
	if err := db.First(&task, id).Error; err != nil {
		SendError(c, 404, "扫描任务不存在")
		return
	}

	if task.Status == "running" {
		SendError(c, 400, "该任务正在运行中，无法重复启动")
		return
	}

	// 异步运行扫描引擎
	go scanner.StartScanTask(db, task.ID)

	db.Create(&model.ActivityLog{
		Type:    "scan_started",
		Message: fmt.Sprintf("扫描任务「%s」已启动，目标网段: %s", task.Name, task.TargetRange),
		RefID:   task.ID,
	})

	SendSuccess(c, "扫描任务已在后台启动")
}

// StopScanTask 停止正在执行的扫描任务
func StopScanTask(c *gin.Context) {
	db := store.GlobalDB
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)

	// 1. 优先尝试从内存中中止活跃的 goroutine
	success := scanner.CancelScanTask(uint(id))
	if success {
		SendSuccess(c, "任务停止指令已成功发送，后台正在停止...")
		return
	}

	// 2. 如果内存中没有（例如服务器重启后数据库中残留的 running 状态），强制修改数据库重置它
	var task model.ScanTask
	if err := db.First(&task, id).Error; err == nil {
		if task.Status == "running" {
			db.Model(&task).Update("status", "failed")

			var scanLog model.ScanLog
			if err := db.Where("task_id = ? AND status = ?", id, "running").Order("id desc").First(&scanLog).Error; err == nil {
				db.Model(&scanLog).Updates(map[string]interface{}{
					"status":      "failed",
					"finished_at": time.Now(),
					"summary":     "检测到残留任务，已被手动强制重置为停止",
				})
			}
			SendSuccess(c, "检测到卡死任务，已强制重置状态为失败")
			return
		}
	}

	SendError(c, 400, "该扫描任务当前并未运行")
}

// GetScanLogs 获取任务的运行日志列表
func GetScanLogs(c *gin.Context) {
	db := store.GlobalDB
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)

	var logs []model.ScanLog
	if err := db.Where("task_id = ?", id).Order("id desc").Find(&logs).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	SendSuccess(c, logs)
}

// ==========================================
// 5. WebSocket WebSSH 终端
// ==========================================

func ConnectTerminal(c *gin.Context) {
	db := store.GlobalDB
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)

	// 查找资产
	var asset model.Asset
	if err := db.First(&asset, id).Error; err != nil {
		c.String(http.StatusNotFound, "资产不存在")
		return
	}

	// 查找关联凭证 (如果有)
	var cred model.Credential
	var credPtr *model.Credential
	if asset.CredentialID != nil {
		if err := db.First(&cred, *asset.CredentialID).Error; err == nil {
			credPtr = &cred
		}
	}

	// 升级 HTTP 为 WebSocket
	ws, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("ConnectTerminal: WebSocket Upgrade failed: %v", err)
		return
	}

	// 交给 sshproxy 处理
	go sshproxy.ProxyTerminal(ws, &asset, credPtr)
}

// ==========================================
// 6. PingAsset — 单资产在线探测
// ==========================================

func PingAsset(c *gin.Context) {
	db := store.GlobalDB
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)

	var asset model.Asset
	if err := db.First(&asset, id).Error; err != nil {
		SendError(c, 404, "资产不存在")
		return
	}

	// 依次尝试探测常见端口
	probePorts := []string{"22", "23", "80", "443", "8080", "3389"}
	online := false
	for _, port := range probePorts {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%s", asset.IP, port), 2*time.Second)
		if err == nil {
			conn.Close()
			online = true
			break
		}
	}

	newStatus := "offline"
	if online {
		newStatus = "online"
	}

	now := time.Now()
	db.Model(&asset).Updates(map[string]interface{}{
		"status":          newStatus,
		"last_scanned_at": &now,
	})

	SendSuccess(c, gin.H{"status": newStatus, "ip": asset.IP})
}

// ==========================================
// 7. GetRecentActivity — 最近操作活动日志
// ==========================================

func GetRecentActivity(c *gin.Context) {
	db := store.GlobalDB
	var logs []model.ActivityLog
	if err := db.Order("id desc").Limit(20).Find(&logs).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	SendSuccess(c, logs)
}
