package handler

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"backend/internal/model"
	"backend/internal/scanner"
	"backend/internal/sshproxy"
	"backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
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
	// “其他”涵盖除服务器/交换机/路由器外的全部类型（如指纹识别得到的 camera、unknown 等），
	// 保证 servers+switches+routers+other == total_assets，前端分布饼图不会漏计。
	db.Model(&model.Asset{}).Where("type NOT IN ?", []string{"server", "switch", "router"}).Count(&other)

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
	// 解除被删凭据在资产上的悬空引用，避免资产 credential_id 指向已不存在的记录
	db.Model(&model.Asset{}).Where("credential_id = ?", id).Update("credential_id", nil)
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

	// 校验 IP 格式（服务端兜底，避免非法 IP 入库后扫描/探测报错）
	if net.ParseIP(strings.TrimSpace(asset.IP)) == nil {
		SendError(c, 400, "IP 地址格式不合法")
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

	old := asset // 记录变更前的值

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

	// 记录字段级变更历史
	recordAssetChange(db, asset.ID, "名称", old.Name, asset.Name)
	recordAssetChange(db, asset.ID, "IP", old.IP, asset.IP)
	recordAssetChange(db, asset.ID, "类型", old.Type, asset.Type)
	recordAssetChange(db, asset.ID, "状态", old.Status, asset.Status)
	recordAssetChange(db, asset.ID, "描述", old.Description, asset.Description)
	recordAssetChange(db, asset.ID, "标签", old.Tags, asset.Tags)
	recordAssetChange(db, asset.ID, "凭据", credIDStr(old.CredentialID), credIDStr(asset.CredentialID))

	db.Create(&model.ActivityLog{
		Type:    "asset_updated",
		Message: fmt.Sprintf("资产 %s (%s) 信息已更新", asset.Name, asset.IP),
		RefID:   asset.ID,
	})

	SendSuccess(c, asset)
}

func recordAssetChange(db *gorm.DB, assetID uint, field, oldV, newV string) {
	if oldV == newV {
		return
	}
	db.Create(&model.AssetHistory{AssetID: assetID, Field: field, OldValue: oldV, NewValue: newV, CreatedAt: time.Now()})
}

func credIDStr(p *uint) string {
	if p == nil {
		return ""
	}
	return strconv.FormatUint(uint64(*p), 10)
}

// GetAssetHistory 资产变更历史
func GetAssetHistory(c *gin.Context) {
	db := store.GlobalDB
	id, _ := strconv.Atoi(c.Param("id"))
	var hist []model.AssetHistory
	if err := db.Where("asset_id = ?", id).Order("id desc").Limit(100).Find(&hist).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	SendSuccess(c, hist)
}

func DeleteAsset(c *gin.Context) {
	db := store.GlobalDB
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)

	var asset model.Asset
	if err := db.First(&asset, id).Error; err != nil {
		SendError(c, 404, "资产不存在")
		return
	}

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

	// 根据凭据类型选择 SSH 或 Telnet 代理
	if credPtr != nil && credPtr.Type == "telnet" {
		go sshproxy.ProxyTelnet(ws, &asset, credPtr)
	} else {
		go sshproxy.ProxyTerminal(ws, &asset, credPtr)
	}
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

// ==========================================
// 8. 系统配置 — GetSettings / UpdateSettings
// ==========================================

// GetSettings 返回所有系统配置（key -> value）
func GetSettings(c *gin.Context) {
	db := store.GlobalDB
	var settings []model.SystemSetting
	if err := db.Find(&settings).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	m := make(map[string]string)
	for _, s := range settings {
		m[s.Key] = s.Value
	}
	SendSuccess(c, m)
}

// UpdateSettings 批量更新系统配置（upsert）
func UpdateSettings(c *gin.Context) {
	db := store.GlobalDB
	var payload map[string]string
	if err := c.ShouldBindJSON(&payload); err != nil {
		SendError(c, 400, "参数格式错误")
		return
	}
	now := time.Now()
	for k, v := range payload {
		var existing model.SystemSetting
		if err := db.First(&existing, "key = ?", k).Error; err == nil {
			db.Model(&existing).Updates(map[string]interface{}{"value": v, "updated_at": now})
		} else {
			db.Create(&model.SystemSetting{Key: k, Value: v, UpdatedAt: now})
		}
	}
	SendSuccess(c, gin.H{"updated": len(payload)})
}

// ==========================================
// 9. TestCredential — 用指定凭据测试连接目标主机
// ==========================================

type testCredReq struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

func TestCredential(c *gin.Context) {
	db := store.GlobalDB
	id, _ := strconv.Atoi(c.Param("id"))

	var cred model.Credential
	if err := db.First(&cred, id).Error; err != nil {
		SendError(c, 404, "凭据不存在")
		return
	}

	var req testCredReq
	_ = c.ShouldBindJSON(&req)
	if req.Host == "" {
		SendError(c, 400, "请提供测试目标主机 IP")
		return
	}
	if req.Port == 0 {
		if cred.Type == "telnet" {
			req.Port = 23
		} else {
			req.Port = 22
		}
	}

	addr := fmt.Sprintf("%s:%d", req.Host, req.Port)

	// Telnet：当前仅校验端口连通性（不做登录验证）
	if cred.Type == "telnet" {
		conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
		if err != nil {
			SendSuccess(c, gin.H{"ok": false, "message": fmt.Sprintf("Telnet 端口不可达: %v", err)})
			return
		}
		conn.Close()
		SendSuccess(c, gin.H{"ok": true, "message": "Telnet 端口连通（未做登录校验）"})
		return
	}

	sshConfig := &ssh.ClientConfig{
		User:            cred.Username,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         8 * time.Second,
	}
	if cred.Type == "ssh_key" && cred.PrivateKey != "" {
		signer, err := ssh.ParsePrivateKey([]byte(cred.PrivateKey))
		if err != nil {
			SendSuccess(c, gin.H{"ok": false, "message": fmt.Sprintf("私钥解析失败: %v", err)})
			return
		}
		sshConfig.Auth = []ssh.AuthMethod{ssh.PublicKeys(signer)}
	} else {
		sshConfig.Auth = []ssh.AuthMethod{ssh.Password(cred.Password)}
	}

	client, err := ssh.Dial("tcp", addr, sshConfig)
	if err != nil {
		SendSuccess(c, gin.H{"ok": false, "message": fmt.Sprintf("连接失败: %v", err)})
		return
	}
	client.Close()
	SendSuccess(c, gin.H{"ok": true, "message": "连接成功，凭据有效 ✓"})
}

// ==========================================
// 10. CollectAsset — 认证采集（SSH uname）系统/架构信息
// ==========================================

func CollectAsset(c *gin.Context) {
	db := store.GlobalDB
	id, _ := strconv.Atoi(c.Param("id"))

	var asset model.Asset
	if err := db.First(&asset, id).Error; err != nil {
		SendError(c, 404, "资产不存在")
		return
	}
	if asset.CredentialID == nil {
		SendError(c, 400, "请先为该资产绑定 SSH 凭据后再采集")
		return
	}
	var cred model.Credential
	if err := db.First(&cred, *asset.CredentialID).Error; err != nil {
		SendError(c, 400, "关联的凭据不存在")
		return
	}
	if cred.Type == "telnet" {
		SendError(c, 400, "Telnet 凭据暂不支持信息采集")
		return
	}

	sshConfig := &ssh.ClientConfig{
		User:            cred.Username,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         8 * time.Second,
	}
	if cred.Type == "ssh_key" && cred.PrivateKey != "" {
		signer, err := ssh.ParsePrivateKey([]byte(cred.PrivateKey))
		if err != nil {
			SendSuccess(c, gin.H{"ok": false, "message": fmt.Sprintf("私钥解析失败: %v", err)})
			return
		}
		sshConfig.Auth = []ssh.AuthMethod{ssh.PublicKeys(signer)}
	} else {
		sshConfig.Auth = []ssh.AuthMethod{ssh.Password(cred.Password)}
	}

	client, err := ssh.Dial("tcp", fmt.Sprintf("%s:22", asset.IP), sshConfig)
	if err != nil {
		SendSuccess(c, gin.H{"ok": false, "message": fmt.Sprintf("SSH 连接失败: %v", err)})
		return
	}
	defer client.Close()
	session, err := client.NewSession()
	if err != nil {
		SendSuccess(c, gin.H{"ok": false, "message": fmt.Sprintf("创建会话失败: %v", err)})
		return
	}
	defer session.Close()

	// 第1行 uname -m -> 架构；第2行 uname -sr -> 内核；第3行 -> 虚拟化探测
	// 虚拟化探测优先 systemd-detect-virt；缺失时回退 CPUID hypervisor 位 + DMI product_name；物理机输出 none
	virtProbe := "( systemd-detect-virt 2>/dev/null || ( grep -qa hypervisor /proc/cpuinfo 2>/dev/null && cat /sys/class/dmi/id/product_name 2>/dev/null ) || echo none ) | head -n1"
	out, err := session.CombinedOutput("uname -m; uname -sr; " + virtProbe)
	if err != nil {
		SendSuccess(c, gin.H{"ok": false, "message": fmt.Sprintf("命令执行失败: %v", err)})
		return
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	arch, kernel, virtRaw := "", "", ""
	if len(lines) > 0 {
		arch = strings.TrimSpace(lines[0])
	}
	if len(lines) > 1 {
		kernel = strings.TrimSpace(lines[1])
	}
	if len(lines) > 2 {
		virtRaw = strings.TrimSpace(lines[len(lines)-1]) // 取最后一行，规避前面命令多输出的兜底行
	}
	virt := normalizeVirt(virtRaw)

	updates := map[string]interface{}{}
	if arch != "" {
		updates["arch"] = arch
	}
	if kernel != "" {
		updates["os_version"] = kernel
	}
	if virt != "" {
		updates["virtualization"] = virt
	}
	if len(updates) > 0 {
		db.Model(&asset).Updates(updates)
	}
	logActivity(db, "asset_updated", fmt.Sprintf("资产 %s 采集成功 (%s / %s)", asset.Name, arch, virtLabel(virt)), asset.ID)
	SendSuccess(c, gin.H{"ok": true, "arch": arch, "os": kernel, "virtualization": virt,
		"message": fmt.Sprintf("采集成功: %s / %s / %s", arch, kernel, virtLabel(virt))})
}

// normalizeVirt 把 systemd-detect-virt / DMI product_name 的原始输出归一化为内部标识
func normalizeVirt(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	if s == "" {
		return ""
	}
	switch {
	case s == "none":
		return "physical"
	case strings.Contains(s, "vmware"):
		return "vmware"
	case strings.Contains(s, "microsoft") || strings.Contains(s, "hyper-v") || strings.Contains(s, "hyperv"):
		return "hyper-v"
	case strings.Contains(s, "virtualbox") || s == "oracle":
		return "virtualbox"
	case strings.Contains(s, "kvm"):
		return "kvm"
	case strings.Contains(s, "xen"):
		return "xen"
	case strings.Contains(s, "qemu") || strings.Contains(s, "bochs") || strings.Contains(s, "i440fx") || strings.Contains(s, "q35"):
		return "qemu"
	case strings.Contains(s, "amazon") || strings.Contains(s, "ec2"):
		return "aws"
	case strings.Contains(s, "google"):
		return "gcp"
	case strings.Contains(s, "alibaba") || strings.Contains(s, "aliyun"):
		return "aliyun"
	case strings.Contains(s, "openstack"):
		return "openstack"
	case strings.Contains(s, "parallels"):
		return "parallels"
	case s == "docker" || s == "lxc" || s == "lxc-libvirt" || s == "podman" || s == "openvz" ||
		s == "systemd-nspawn" || s == "wsl" || s == "rkt":
		return "container:" + s
	default:
		// 其它 systemd 已知标识（bhyve/zvm/powervm 等）直接保留原 token
		return s
	}
}

// virtLabel 给日志/消息用的中文短标签
func virtLabel(v string) string {
	switch {
	case v == "":
		return "虚拟化未知"
	case v == "physical":
		return "实体机"
	case strings.HasPrefix(v, "container:"):
		return "容器(" + strings.TrimPrefix(v, "container:") + ")"
	default:
		return v
	}
}

// ==========================================
// 11. GetVulnFindings — 漏洞发现列表（可选 ?asset_id= 过滤）
// ==========================================

func GetVulnFindings(c *gin.Context) {
	db := store.GlobalDB
	q := db.Order("id desc")
	if aid := c.Query("asset_id"); aid != "" {
		q = q.Where("asset_id = ?", aid)
	}
	var findings []model.VulnFinding
	if err := q.Limit(500).Find(&findings).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	SendSuccess(c, findings)
}

// ==========================================
// 12. StreamScanLog — SSE 实时推送扫描日志与状态
// ==========================================

func StreamScanLog(c *gin.Context) {
	db := store.GlobalDB
	id, _ := strconv.Atoi(c.Param("id"))

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		SendError(c, 500, "streaming unsupported")
		return
	}

	lastLen := 0
	lastStatus := ""
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	done := c.Request.Context().Done()

	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			var sl model.ScanLog
			if err := db.Where("task_id = ?", id).Order("id desc").First(&sl).Error; err != nil {
				continue
			}
			if len(sl.Detail) > lastLen {
				delta := sl.Detail[lastLen:]
				lastLen = len(sl.Detail)
				for _, line := range strings.Split(strings.TrimRight(delta, "\n"), "\n") {
					if line == "" {
						continue
					}
					fmt.Fprintf(c.Writer, "data: %s\n\n", line)
				}
				flusher.Flush()
			}
			if sl.Status != lastStatus {
				lastStatus = sl.Status
				fmt.Fprintf(c.Writer, "event: status\ndata: %s\n\n", sl.Status)
				flusher.Flush()
			}
			if sl.Status != "running" && sl.Status != "" {
				fmt.Fprintf(c.Writer, "event: done\ndata: %s\n\n", sl.Summary)
				flusher.Flush()
				return
			}
		}
	}
}

// ==========================================
// 13. Login — 登录校验（默认 admin/admin，可在 system_settings 改）
// ==========================================

type loginReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func Login(c *gin.Context) {
	db := store.GlobalDB
	var req loginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, "参数错误")
		return
	}
	user := getSettingValue(db, "auth_username", "admin")
	pass := getSettingValue(db, "auth_password", "admin")
	if req.Username == user && req.Password == pass {
		SendSuccess(c, gin.H{"ok": true, "token": "meridian-session", "username": user})
		return
	}
	SendError(c, 401, "用户名或密码错误")
}

func getSettingValue(db *gorm.DB, key, def string) string {
	var s model.SystemSetting
	if err := db.First(&s, "key = ?", key).Error; err == nil && s.Value != "" {
		return s.Value
	}
	return def
}
