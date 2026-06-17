package scanner

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"backend/internal/model"
	"gorm.io/gorm"
)

// ScanResult 包含探测出来的单个主机信息
type ScanResult struct {
	IP        string
	OpenPorts []int
	Type      string // server, switch, router, other
	Vendor    string // Cisco, Huawei, Ubuntu, Windows等
	Version   string // 操作系统或固件版本
	Status    string // online, offline
}

var (
	activeScans   = make(map[uint]context.CancelFunc)
	activeScansMu sync.Mutex
)

// CancelScanTask 取消正在运行的扫描任务
func CancelScanTask(taskID uint) bool {
	activeScansMu.Lock()
	cancel, exists := activeScans[taskID]
	activeScansMu.Unlock()

	if exists {
		cancel()
		return true
	}
	return false
}

// appendDetailLog 向数据库中追加详细文本日志行
func appendDetailLog(db *gorm.DB, scanLog *model.ScanLog, format string, args ...interface{}) {
	msg := fmt.Sprintf("[%s] ", time.Now().Format("15:04:05")) + fmt.Sprintf(format, args...) + "\n"
	db.Model(scanLog).Update("detail", gorm.Expr("detail || ?", msg))
}

// StartScanTask 执行后台扫描任务并更新数据库
func StartScanTask(db *gorm.DB, taskID uint) {
	var task model.ScanTask
	if err := db.First(&task, taskID).Error; err != nil {
		log.Printf("Scanner: task %d not found: %v", taskID, err)
		return
	}

	// 1. 创建扫描日志
	startTime := time.Now()
	scanLog := model.ScanLog{
		TaskID:    taskID,
		Status:    "running",
		StartedAt: startTime,
		Summary:   "扫描任务已启动",
		Detail:    "",
	}
	db.Create(&scanLog)

	// 更新任务状态为 running
	db.Model(&task).Updates(map[string]interface{}{
		"status":      "running",
		"last_run_at": &startTime,
	})

	// 创建可取消的扫描上下文
	ctx, cancel := context.WithCancel(context.Background())
	activeScansMu.Lock()
	activeScans[taskID] = cancel
	activeScansMu.Unlock()
	defer func() {
		activeScansMu.Lock()
		delete(activeScans, taskID)
		activeScansMu.Unlock()
	}()

	// 2. 解析网段 IP 列表
	ips, err := ParseIPRange(task.TargetRange)
	if err != nil {
		finishTask(db, &task, &scanLog, "failed", fmt.Sprintf("解析目标网段失败: %v", err))
		return
	}

	// 解析端口列表
	ports := parsePorts(task.Ports)
	if len(ports) == 0 {
		finishTask(db, &task, &scanLog, "failed", "无可扫描的有效端口")
		return
	}

	// 3. 动态配置扫描参数 (限流与超时控制)
	timeout := 1000 * time.Millisecond
	concurrency := 50
	rateLimit := 0 // 0 表示不限流

	if len(ips) > 256 {
		timeout = 400 * time.Millisecond
		concurrency = 150
	}
	if len(ips) > 1000 {
		rateLimit = 200 // 大网段下限制每秒最多发送 200 个 IP 扫描探测
	}

	log.Printf("Scanner: Starting scan for task %d, total IPs: %d, ports: %v, concurrency: %d, rateLimit: %d, timeout: %v", 
		task.ID, len(ips), ports, concurrency, rateLimit, timeout)

	appendDetailLog(db, &scanLog, "发现自动发现扫描任务: %s", task.Name)
	appendDetailLog(db, &scanLog, "目标探测范围: %s，探测端口: %v", task.TargetRange, ports)
	appendDetailLog(db, &scanLog, "扫描参数设置：并发度=%d，拨号超时=%v，限流速率=%d IP/秒", 
		concurrency, timeout, rateLimit)
	appendDetailLog(db, &scanLog, "开始执行扫描，共解析出 %d 个 IP...", len(ips))

	// 4. 并发扫描与增量写入
	ipChan := make(chan string, concurrency)
	resChan := make(chan ScanResult, concurrency)
	var wg sync.WaitGroup

	// 启动 Worker 池
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case ip, ok := <-ipChan:
					if !ok {
						return
					}
					res := scanHost(ip, ports, timeout)
					select {
					case <-ctx.Done():
						return
					case resChan <- res:
					}
				}
			}
		}()
	}

	// 异步向管道中塞入 IP 并提供限流控制
	go func() {
		defer close(ipChan)
		if rateLimit > 0 {
			interval := time.Second / time.Duration(rateLimit)
			for _, ip := range ips {
				select {
				case <-ctx.Done():
					return
				case ipChan <- ip:
				}
				time.Sleep(interval)
			}
		} else {
			for _, ip := range ips {
				select {
				case <-ctx.Done():
					return
				case ipChan <- ip:
				}
			}
		}
	}()

	// 异步等待 Worker 结束并关闭结果通道
	go func() {
		wg.Wait()
		close(resChan)
	}()

	// 主线程循环读取结果，增量入库并更新进度日志
	onlineIPs := make(map[string]bool)
	scannedCount := 0
	newCount := 0
	updateCount := 0
	lastLogTime := time.Now()
	isCancelled := false

	for {
		select {
		case <-ctx.Done():
			isCancelled = true
		case res, ok := <-resChan:
			if !ok {
				goto LoopEnd
			}
			scannedCount++
			if res.Status == "online" {
				onlineIPs[res.IP] = true
				
				portsStr := fmt.Sprintf("%v", res.OpenPorts)
				if len(res.OpenPorts) == 0 {
					portsStr = "无开放端口 (利用连接拒绝确认存活)"
				}
				appendDetailLog(db, &scanLog, "发现存活设备: %-15s | 类型: %-6s | 厂商: %-10s | 端口: %s",
					res.IP, res.Type, res.Vendor, portsStr)

				// 增量更新到数据库
				isNew, err := saveSingleAsset(db, res)
				if err == nil {
					if isNew {
						newCount++
					} else {
						updateCount++
					}
				}
			}

			// 每 2 秒或每 100 个 IP，或者扫描完成时，更新日志摘要进度
			if time.Since(lastLogTime) >= 2*time.Second || scannedCount%100 == 0 || scannedCount == len(ips) {
				progress := fmt.Sprintf("扫描中：已处理 %d/%d 个 IP (%.1f%%)，发现 %d 台存活主机...",
					scannedCount, len(ips), float64(scannedCount)/float64(len(ips))*100, len(onlineIPs))
				db.Model(&scanLog).Update("summary", progress)
				lastLogTime = time.Now()
			}
		}

		if isCancelled {
			break
		}
	}
LoopEnd:

	// 检查是否是被手动中止的
	if isCancelled || ctx.Err() != nil {
		appendDetailLog(db, &scanLog, "扫描任务已被用户手动停止！已处理 IP: %d/%d，存活数: %d，新增资产: %d，更新资产: %d",
			scannedCount, len(ips), len(onlineIPs), newCount, updateCount)
		
		summary := fmt.Sprintf("扫描已手动停止。进度: %d/%d，发现: %d，新增: %d，更新: %d",
			scannedCount, len(ips), len(onlineIPs), newCount, updateCount)
		finishTask(db, &task, &scanLog, "failed", summary)
		return
	}

	// 5. 对未在此次扫描中被发现的网段内已有资产执行下线操作
	appendDetailLog(db, &scanLog, "扫描网段就绪，正在进行离线资产校验清洗...")
	offlineCount := sweepOfflineAssets(db, ips, onlineIPs)
	appendDetailLog(db, &scanLog, "离线清理完成。本次下线资产数: %d", offlineCount)
	appendDetailLog(db, &scanLog, "扫描任务执行完毕！")

	// 6. 标记任务已完成
	summary := fmt.Sprintf("扫描完成。总IP数: %d，存活主机数: %d，新增资产: %d，更新资产: %d，下线资产: %d",
		len(ips), len(onlineIPs), newCount, updateCount, offlineCount)
	finishTask(db, &task, &scanLog, "completed", summary)
}

func finishTask(db *gorm.DB, task *model.ScanTask, scanLog *model.ScanLog, status string, summary string) {
	endTime := time.Now()
	
	// 更新日志
	scanLog.Status = status
	scanLog.FinishedAt = endTime
	scanLog.Summary = summary
	db.Save(scanLog)

	// 更新任务状态
	task.Status = status
	db.Save(task)
	log.Printf("Scanner: Task %d finished with status: %s. Summary: %s", task.ID, status, summary)
}

func parsePorts(portsStr string) []int {
	var ports []int
	parts := strings.Split(portsStr, ",")
	for _, p := range parts {
		p = strings.TrimSpace(p)
		var port int
		if _, err := fmt.Sscanf(p, "%d", &port); err == nil {
			if port > 0 && port <= 65535 {
				ports = append(ports, port)
			}
		}
	}
	// 默认端口
	if len(ports) == 0 {
		ports = []int{22, 23, 80, 443}
	}
	return ports
}

// scanHost 扫描单个主机的所有目标端口，探测存活并识别指纹
func scanHost(ip string, ports []int, timeout time.Duration) ScanResult {
	var openPorts []int
	result := ScanResult{
		IP:     ip,
		Status: "offline",
		Type:   "other",
	}

	// 并发扫描单个主机的多个端口
	type portRes struct {
		port   int
		open   bool
		online bool
	}
	portChan := make(chan portRes, len(ports))
	var pwg sync.WaitGroup

	for _, port := range ports {
		pwg.Add(1)
		go func(p int) {
			defer pwg.Done()
			open, online := checkPort(ip, p, timeout)
			portChan <- portRes{port: p, open: open, online: online}
		}(port)
	}

	pwg.Wait()
	close(portChan)

	isOnline := false
	for pr := range portChan {
		if pr.online {
			isOnline = true
		}
		if pr.open {
			openPorts = append(openPorts, pr.port)
		}
	}

	if isOnline {
		result.Status = "online"
		result.OpenPorts = openPorts
		if len(openPorts) > 0 {
			// 进行指纹和服务识别
			fingerprintHost(ip, openPorts, &result)
		}
	}

	return result
}

func checkPort(ip string, port int, timeout time.Duration) (bool, bool) {
	address := fmt.Sprintf("%s:%d", ip, port)
	conn, err := net.DialTimeout("tcp", address, timeout)
	if err != nil {
		errStr := strings.ToLower(err.Error())
		if strings.Contains(errStr, "connection refused") {
			return false, true // 端口关闭但主机存活
		}
		return false, false
	}
	conn.Close()
	return true, true // 端口开放且主机存活
}

// saveSingleAsset 保存单个主机的在线发现结果到数据库，返回是否为新资产
func saveSingleAsset(db *gorm.DB, r ScanResult) (bool, error) {
	var asset model.Asset
	exists := true
	if err := db.Where("ip = ?", r.IP).First(&asset).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			exists = false
		} else {
			log.Printf("Scanner db error for ip %s: %v", r.IP, err)
			return false, err
		}
	}

	now := time.Now()
	portsJSON, _ := json.Marshal(r.OpenPorts)

	if exists {
		// 更新已存在的资产
		asset.Status = "online"
		asset.Ports = string(portsJSON)
		asset.LastScannedAt = &now
		if r.Vendor != "" {
			asset.Vendor = r.Vendor
		}
		if r.Version != "" {
			asset.OSVersion = r.Version
		}
		if r.Type != "other" {
			asset.Type = r.Type
		}
		if err := db.Save(&asset).Error; err != nil {
			log.Printf("Scanner db save error for ip %s: %v", r.IP, err)
			return false, err
		}
		return false, nil
	} else {
		// 新增资产
		newAsset := model.Asset{
			Name:          fmt.Sprintf("Discovered-%s", r.IP),
			IP:            r.IP,
			Type:          r.Type,
			Status:        "online",
			Vendor:        r.Vendor,
			OSVersion:     r.Version,
			Ports:         string(portsJSON),
			LastScannedAt: &now,
		}
		if err := db.Create(&newAsset).Error; err != nil {
			log.Printf("Scanner db create error for ip %s: %v", r.IP, err)
			return false, err
		}
		return true, nil
	}
}

// sweepOfflineAssets 清理并标记扫描范围内的离线资产
func sweepOfflineAssets(db *gorm.DB, ips []string, onlineIPs map[string]bool) int {
	scannedMap := make(map[string]bool)
	for _, ip := range ips {
		scannedMap[ip] = true
	}

	var assets []model.Asset
	// 仅加载当前状态为 online 的资产进行对比
	if err := db.Where("status = ?", "online").Find(&assets).Error; err != nil {
		log.Printf("Scanner sweep error: %v", err)
		return 0
	}

	now := time.Now()
	offlineCount := 0
	for _, asset := range assets {
		// 如果资产 IP 属于本次扫描网段且此次扫描未发现其存活，则标记为下线
		if scannedMap[asset.IP] && !onlineIPs[asset.IP] {
			asset.Status = "offline"
			asset.LastScannedAt = &now
			if err := db.Save(&asset).Error; err != nil {
				log.Printf("Scanner sweep save error for ip %s: %v", asset.IP, err)
			} else {
				offlineCount++
			}
		}
	}
	return offlineCount
}

// fingerprintHost 对开放端口进行服务探针指纹识别
func fingerprintHost(ip string, openPorts []int, res *ScanResult) {
	// 针对不同端口进行分析
	hasSSH := false
	hasTelnet := false
	hasHTTP := false
	hasHTTPS := false

	for _, p := range openPorts {
		if p == 22 {
			hasSSH = true
		} else if p == 23 {
			hasTelnet = true
		} else if p == 80 {
			hasHTTP = true
		} else if p == 443 {
			hasHTTPS = true
		}
	}

	// 1. 优先探测 SSH Banner
	if hasSSH {
		banner, err := readTCPBanner(ip, 22, 2*time.Second)
		if err == nil && banner != "" {
			res.Type = "server"
			res.Vendor = "Linux"
			res.Version = banner

			// 对常见厂商进行过滤
			bannerLower := strings.ToLower(banner)
			if strings.Contains(bannerLower, "ubuntu") {
				res.Vendor = "Ubuntu"
			} else if strings.Contains(bannerLower, "debian") {
				res.Vendor = "Debian"
			} else if strings.Contains(bannerLower, "centos") || strings.Contains(bannerLower, "redhat") {
				res.Vendor = "CentOS/RedHat"
			} else if strings.Contains(bannerLower, "vrp") || strings.Contains(bannerLower, "huawei") {
				res.Type = "switch"
				res.Vendor = "Huawei"
			} else if strings.Contains(bannerLower, "cisco") {
				res.Type = "switch"
				res.Vendor = "Cisco"
			}
			return
		}
	}

	// 2. 探测 Telnet
	if hasTelnet {
		banner, err := readTCPBanner(ip, 23, 2*time.Second)
		if err == nil && banner != "" {
			res.Type = "switch" // 开放 Telnet 的大概率是交换机/路由器设备
			res.Version = banner
			bannerLower := strings.ToLower(banner)
			if strings.Contains(bannerLower, "cisco") {
				res.Vendor = "Cisco"
			} else if strings.Contains(bannerLower, "huawei") || strings.Contains(bannerLower, "vrp") {
				res.Vendor = "Huawei"
			} else if strings.Contains(bannerLower, "h3c") {
				res.Vendor = "H3C"
			}
			return
		}
	}

	// 3. 探测 HTTP / HTTPS
	if hasHTTP || hasHTTPS {
		scheme := "http"
		port := 80
		if hasHTTPS {
			scheme = "https"
			port = 443
		}
		
		// 忽略证书错误
		client := &http.Client{
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
				TLSHandshakeTimeout: 2 * time.Second,
			},
			Timeout: 2 * time.Second,
		}

		resp, err := client.Get(fmt.Sprintf("%s://%s:%d", scheme, ip, port))
		if err == nil {
			defer resp.Body.Close()
			serverHeader := resp.Header.Get("Server")
			res.Version = serverHeader
			
			// 简单的 HTTP Title 或 Header 匹配
			res.Type = "other"
			serverLower := strings.ToLower(serverHeader)
			if strings.Contains(serverLower, "nginx") || strings.Contains(serverLower, "apache") || strings.Contains(serverLower, "iis") {
				res.Type = "server"
				res.Vendor = "Web Server"
			} else if strings.Contains(serverLower, "hikvision") || strings.Contains(serverLower, "dahua") {
				res.Type = "camera"
				res.Vendor = "Security Camera"
			}
			return
		}
	}
}

func readTCPBanner(ip string, port int, timeout time.Duration) (string, error) {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", ip, port), timeout)
	if err != nil {
		return "", err
	}
	defer conn.Close()

	conn.SetReadDeadline(time.Now().Add(timeout))
	reader := bufio.NewReader(conn)
	// 读取第一行作为 Banner
	line, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(line), nil
}
