package scanner

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"backend/internal/model"
	"backend/internal/notifier"
	"gorm.io/gorm"
)

// loadScanParams 从「系统设置」读取扫描并发数与端口探测超时（带默认值兜底）
func loadScanParams(db *gorm.DB) (int, time.Duration) {
	concurrency := 100
	timeout := 2000 * time.Millisecond
	var settings []model.SystemSetting
	if err := db.Find(&settings).Error; err == nil {
		for _, s := range settings {
			switch s.Key {
			case "scan_concurrency":
				if n, e := strconv.Atoi(strings.TrimSpace(s.Value)); e == nil && n >= 1 && n <= 1000 {
					concurrency = n
				}
			case "scan_timeout":
				if f, e := strconv.ParseFloat(strings.TrimSpace(s.Value), 64); e == nil && f > 0 {
					timeout = time.Duration(f * float64(time.Second))
				}
			}
		}
	}
	return concurrency, timeout
}

// ScanResult 包含探测出来的单个主机信息
type ScanResult struct {
	IP        string
	OpenPorts []int
	Type      string // server, switch, router, other
	Vendor    string // Cisco, Huawei, Ubuntu, Windows等
	Version   string // 操作系统或固件版本
	Status    string // online, offline
	K8sRole   string // "" | control-plane | worker（探测得到）
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
	db.Model(scanLog).Update("detail", gorm.Expr("coalesce(detail, '') || ?", msg))
}

// loadClusterVIPs 读取所有已知 K8s 集群 VIP（虚拟 IP），扫描时从待扫描列表中排除。
func loadClusterVIPs(db *gorm.DB) map[string]bool {
	var clusters []model.K8sCluster
	db.Select("vip").Where("vip <> ''").Find(&clusters)
	set := make(map[string]bool, len(clusters))
	for _, c := range clusters {
		if v := strings.TrimSpace(c.VIP); v != "" {
			set[v] = true
		}
	}
	return set
}

// runDiscoveryScan 执行后台端口发现扫描任务并更新数据库（原 StartScanTask 主体，逻辑保持不变）
func runDiscoveryScan(db *gorm.DB, taskID uint) {
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

	// 2.1 排除已知 K8s 集群 VIP：虚拟 IP 会代答端口，扫描会生成「幽灵主机」资产，
	//     且 VIP 在节点间浮动并非真实独立主机，故直接从待扫描列表中剔除。
	if vipSet := loadClusterVIPs(db); len(vipSet) > 0 {
		kept := ips[:0:0]
		excluded := 0
		for _, ip := range ips {
			if vipSet[ip] {
				excluded++
				continue
			}
			kept = append(kept, ip)
		}
		if excluded > 0 {
			ips = kept
			appendDetailLog(db, &scanLog, "已排除 %d 个已知集群 VIP（虚拟 IP 不计为主机）", excluded)
		}
	}

	// 解析端口列表
	ports := parsePorts(task.Ports)
	if len(ports) == 0 {
		finishTask(db, &task, &scanLog, "failed", "无可扫描的有效端口")
		return
	}
	// 探测 K8s：并入 API Server(6443 / 非标 2070) 与 kubelet(10250)
	if task.DetectK8s {
		ports = appendUniquePorts(ports, 6443, 2070, 10250)
	}

	// 3. 扫描参数：优先采用「系统设置」中用户配置的并发数与超时；大网段额外限流
	concurrency, timeout := loadScanParams(db)
	rateLimit := 0 // 0 表示不限流
	if len(ips) > 1000 {
		rateLimit = 200 // 大网段下限制每秒最多发送 200 个 IP 扫描探测
	}

	log.Printf("Scanner: Starting scan for task %d, total IPs: %d, ports: %v, concurrency: %d, rateLimit: %d, timeout: %v", 
		task.ID, len(ips), ports, concurrency, rateLimit, timeout)

	appendDetailLog(db, &scanLog, "发现自动发现扫描任务: %s", task.Name)
	appendDetailLog(db, &scanLog, "目标探测范围: %s，探测端口: %v", task.TargetRange, ports)
	appendDetailLog(db, &scanLog, "扫描参数设置：并发度=%d，拨号超时=%v，限流速率=%d IP/秒", 
		concurrency, timeout, rateLimit)

	// 3.5 探测本地代理/VPN劫持与防火墙阻断端口
	appendDetailLog(db, &scanLog, "分析本地网络环境，检测是否存在端口拦截、代答与阻断...")
	hijackedPorts, testedOffline := detectHijackedPorts(task.TargetRange, ports, timeout)
	if len(hijackedPorts) > 0 {
		var hList []string
		for p := range hijackedPorts {
			hList = append(hList, strconv.Itoa(p))
		}
		appendDetailLog(db, &scanLog, "⚠️ 警告：检测到本地环境存在对端口 [%s] 的全局代理劫持或代拒阻断！扫描引擎将对这些端口启用应用层深度握手校验，以防止所有主机被误判为存活在线。", strings.Join(hList, ", "))
	} else {
		appendDetailLog(db, &scanLog, "本地网络环境检查完毕，未发现端口劫持或阻断。")
	}

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
					res := scanHost(ip, ports, timeout, hijackedPorts, testedOffline)
					if task.DetectK8s && res.Status == "online" {
						probeK8s(ip, &res, timeout)
					}
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
	
	// 更新日志 (仅更新指定列，避免 Save 覆盖 detail 详志)
	db.Model(scanLog).Updates(map[string]interface{}{
		"status":      status,
		"finished_at": endTime,
		"summary":     summary,
	})

	// 更新任务状态
	task.Status = status
	db.Save(task)
	log.Printf("Scanner: Task %d finished with status: %s. Summary: %s", task.ID, status, summary)

	// 异步推送告警通知（失败不影响扫描主流程）
	go notifier.ScanFinished(task.Name, status, summary)
}

func parsePorts(portsStr string) []int {
	const maxPorts = 2000 // 端口数量上限，防止超大端口列表放大并发探测规模
	var ports []int
	parts := strings.Split(portsStr, ",")
	for _, p := range parts {
		p = strings.TrimSpace(p)
		var port int
		if _, err := fmt.Sscanf(p, "%d", &port); err == nil {
			if port > 0 && port <= 65535 {
				ports = append(ports, port)
				if len(ports) >= maxPorts {
					break
				}
			}
		}
	}
	// 默认端口
	if len(ports) == 0 {
		ports = []int{22, 23, 80, 443}
	}
	return ports
}

// mergeTag 把 tag 并入 JSON 字符串数组（去重），返回新的 JSON
func mergeTag(existing, tag string) string {
	var arr []string
	if strings.TrimSpace(existing) != "" {
		_ = json.Unmarshal([]byte(existing), &arr)
	}
	for _, t := range arr {
		if t == tag {
			b, _ := json.Marshal(arr)
			return string(b)
		}
	}
	arr = append(arr, tag)
	b, _ := json.Marshal(arr)
	return string(b)
}

// ensureTag 确保全局标签存在（便于前端按色展示）
func ensureTag(db *gorm.DB, name, color string) {
	var t model.Tag
	db.Where("name = ?", name).FirstOrCreate(&t, model.Tag{Name: name, Color: color})
}

// appendUniquePorts 把若干端口并入列表（去重）
func appendUniquePorts(ports []int, extra ...int) []int {
	seen := make(map[int]bool, len(ports))
	for _, p := range ports {
		seen[p] = true
	}
	for _, p := range extra {
		if !seen[p] {
			ports = append(ports, p)
			seen[p] = true
		}
	}
	return ports
}

// ── Kubernetes 节点探测 ─────────────────────────────────
// k8sAPIPorts 是 kube-apiserver 候选端口：标准 6443 + 非标 2070
var k8sAPIPorts = []int{6443, 2070}

// probeK8s 在已发现开放 apiserver/kubelet 端口的主机上判定是否 K8s 节点并定角色
func probeK8s(ip string, res *ScanResult, timeout time.Duration) {
	has := func(p int) bool {
		for _, op := range res.OpenPorts {
			if op == p {
				return true
			}
		}
		return false
	}
	for _, port := range k8sAPIPorts {
		if has(port) && isK8sAPIServer(ip, port, res, timeout) {
			res.K8sRole = "control-plane"
			return
		}
	}
	if has(10250) && isKubelet(ip, timeout) {
		res.K8sRole = "worker"
	}
}

func k8sHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:   timeout + 2*time.Second,
		Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
	}
}

// isK8sAPIServer 判定指定端口是否 kube-apiserver：优先 TLS 证书 SAN（最可靠），其次 /version
func isK8sAPIServer(ip string, port int, res *ScanResult, timeout time.Duration) bool {
	addr := net.JoinHostPort(ip, strconv.Itoa(port))
	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: timeout}, "tcp", addr, &tls.Config{InsecureSkipVerify: true})
	if err == nil {
		for _, cert := range conn.ConnectionState().PeerCertificates {
			for _, dns := range cert.DNSNames {
				d := strings.ToLower(dns)
				if d == "kubernetes" || strings.HasPrefix(d, "kubernetes.default") {
					conn.Close()
					tryReadK8sVersion(ip, port, res, timeout)
					return true
				}
			}
			cn := strings.ToLower(cert.Subject.CommonName)
			if cn == "kube-apiserver" || strings.Contains(cn, "kubernetes") {
				conn.Close()
				tryReadK8sVersion(ip, port, res, timeout)
				return true
			}
		}
		conn.Close()
	}
	// 证书未命中：用 /version 兜底
	return tryReadK8sVersion(ip, port, res, timeout)
}

// tryReadK8sVersion 访问 /version；匿名放行时取 gitVersion，匿名拒绝时凭 K8s Status JSON 判定
func tryReadK8sVersion(ip string, port int, res *ScanResult, timeout time.Duration) bool {
	resp, err := k8sHTTPClient(timeout).Get(fmt.Sprintf("https://%s:%d/version", ip, port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
	s := string(body)
	if strings.Contains(s, "gitVersion") {
		var v struct {
			GitVersion string `json:"gitVersion"`
		}
		if json.Unmarshal(body, &v) == nil && v.GitVersion != "" && res.Version == "" {
			res.Version = "Kubernetes " + v.GitVersion
		}
		return true
	}
	// 匿名被拒：kube-apiserver 返回的 Status JSON 形状（kind:Status + apiVersion）
	if strings.Contains(s, "\"kind\"") && strings.Contains(s, "Status") && strings.Contains(s, "apiVersion") {
		return true
	}
	return false
}

// isKubelet 弱判定 10250 为 kubelet：TLS 握手成功 + /healthz 有 HTTP 响应（200/401/403 均可）
func isKubelet(ip string, timeout time.Duration) bool {
	addr := net.JoinHostPort(ip, "10250")
	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: timeout}, "tcp", addr, &tls.Config{InsecureSkipVerify: true})
	if err != nil {
		return false
	}
	conn.Close()
	resp, err := k8sHTTPClient(timeout).Get(fmt.Sprintf("https://%s:10250/healthz", ip))
	if err != nil {
		return true // TLS 成功但 HTTP 失败，仍按弱判定为 kubelet
	}
	resp.Body.Close()
	return true
}

// detectHijackedPorts 探测目标网段中是否存在被本地代理/VPN劫持或异常阻断的端口
func detectHijackedPorts(targetRange string, ports []int, timeout time.Duration) (map[int]bool, map[string]map[int]bool) {
	hijacked := make(map[int]bool)
	testedOffline := make(map[string]map[int]bool)
	
	ips, err := ParseIPRange(targetRange)
	if err != nil || len(ips) < 10 {
		return hijacked, testedOffline
	}

	// 随机挑选 3 个在网段内不同位置的测试 IP
	var testIPs []string
	if len(ips) >= 100 {
		testIPs = []string{
			ips[len(ips)*5/10], // 50% 处
			ips[len(ips)*8/10], // 80% 处
			ips[len(ips)*9/10], // 90% 处
		}
	} else {
		// IP 较少时，直接取后几个
		testIPs = []string{
			ips[len(ips)-1],
		}
		if len(ips) > 2 {
			testIPs = append(testIPs, ips[len(ips)-2])
		}
		if len(ips) > 3 {
			testIPs = append(testIPs, ips[len(ips)-3])
		}
	}

	// 初始化 testedOffline 映射
	for _, ip := range testIPs {
		testedOffline[ip] = make(map[int]bool)
	}

	// 统计每个端口在 testIPs 上的非超时响应情况（包括 Dial 成功和 Connection Refused）
	portOnlineCount := make(map[int]int)
	for _, ip := range testIPs {
		for _, port := range ports {
			_, online := checkPortWithoutBanner(ip, port, timeout)
			if online {
				portOnlineCount[port]++
			} else {
				// 记录该 IP 该端口已经探测过且是不在线状态
				testedOffline[ip][port] = true
			}
		}
	}

	// 如果某个端口在绝大多数 (>=2 或全部) 测试 IP 上都返回了在线响应，判定该端口被全局劫持或异常阻断
	threshold := 2
	if len(testIPs) < 2 {
		threshold = len(testIPs)
	}
	for port, count := range portOnlineCount {
		if count >= threshold {
			hijacked[port] = true
		}
	}

	// 如果某个端口被判定为全局劫持，我们必须在实际扫描中对其进行深度校验，而不能直接跳过。
	// 所以，只有当 hijacked[port] 为 false 时，我们才在 testedOffline 中保留测试 IP 该端口的跳过标记。
	for _, ip := range testIPs {
		for port := range testedOffline[ip] {
			if hijacked[port] {
				delete(testedOffline[ip], port)
			}
		}
	}

	return hijacked, testedOffline
}

// deepVerifyPort 进行深度协议握手验证，识别是否为虚假的劫持端口
func deepVerifyPort(ip string, port int, timeout time.Duration) bool {
	address := fmt.Sprintf("%s:%d", ip, port)

	// 根据端口特征进行短路探测优化，避免对不存在的 IP 串行执行多种协议超时，导致扫描速度暴跌
	
	// 1. SSH / Telnet 端口：它们是主动推 Banner 的协议
	if port == 22 || port == 23 {
		conn, err := net.DialTimeout("tcp", address, timeout)
		if err != nil {
			return false
		}
		defer conn.Close()
		
		_ = conn.SetReadDeadline(time.Now().Add(1000 * time.Millisecond))
		buf := make([]byte, 256)
		n, err := conn.Read(buf)
		if err == nil && n > 0 {
			respStr := string(buf[:n])
			if port == 22 && strings.HasPrefix(respStr, "SSH-") {
				return true
			}
			if port == 23 && buf[0] == 0xff {
				return true
			}
		}
		return false
	}

	// 2. HTTPS 端口：只进行 TLS 握手
	if port == 443 {
		conn, err := net.DialTimeout("tcp", address, timeout)
		if err != nil {
			return false
		}
		defer conn.Close()

		tlsConn := tls.Client(conn, &tls.Config{
			InsecureSkipVerify: true,
		})
		_ = tlsConn.SetDeadline(time.Now().Add(1500 * time.Millisecond))
		err = tlsConn.Handshake()
		if err == nil {
			return true
		}
		return false
	}

	// 3. HTTP 端口 (80, 8080) 或其他自定义未知端口：发送 HTTP 请求校验
	// （大部分劫持服务都是代答 HTTP，这里作为通用校验兜底）
	conn, err := net.DialTimeout("tcp", address, timeout)
	if err != nil {
		return false
	}
	defer conn.Close()

	_ = conn.SetWriteDeadline(time.Now().Add(800 * time.Millisecond))
	_, err = conn.Write([]byte("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"))
	if err != nil {
		return false
	}

	_ = conn.SetReadDeadline(time.Now().Add(1000 * time.Millisecond))
	buf := make([]byte, 512)
	n, err := conn.Read(buf)
	if err == nil && n > 0 {
		respStr := strings.ToLower(string(buf[:n]))
		if strings.Contains(respStr, "http/1.") || strings.Contains(respStr, "http/2.") {
			if strings.Contains(respStr, "502") || strings.Contains(respStr, "504") || strings.Contains(respStr, "503") {
				return false
			}
			return true
		}
		// 其他非空数据，如果不是代理错误，也判定为有真实服务
		return true
	}

	return false
}

// checkPortWithoutBanner 原始的最快 TCP 连接校验函数，不含劫持和 Banner 逻辑
func checkPortWithoutBanner(ip string, port int, timeout time.Duration) (bool, bool) {
	address := fmt.Sprintf("%s:%d", ip, port)
	conn, err := net.DialTimeout("tcp", address, timeout)
	if err != nil {
		errStr := strings.ToLower(err.Error())
		if strings.Contains(errStr, "connection refused") {
			return false, true
		}
		return false, false
	}
	conn.Close()
	return true, true
}

// scanHost 扫描单个主机的所有目标端口，探测存活并识别指纹
func scanHost(ip string, ports []int, timeout time.Duration, hijackedPorts map[int]bool, testedOffline map[string]map[int]bool) ScanResult {
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

	// 有界端口探测工作池：避免「单主机端口数 × 主机并发数」放大成海量协程/套接字，
	// 在大端口列表 + 高并发设置下导致后端 FD 耗尽 / OOM。
	portJobs := make(chan int, len(ports))
	portWorkers := 50
	if len(ports) < portWorkers {
		portWorkers = len(ports)
	}
	for w := 0; w < portWorkers; w++ {
		pwg.Add(1)
		go func() {
			defer pwg.Done()
			for p := range portJobs {
				// 获取该 IP 该端口是否在初始化阶段已被证明为不在线
				isTestedOffline := false
				if offlinePorts, exists := testedOffline[ip]; exists {
					isTestedOffline = offlinePorts[p]
				}

				open, online := checkPort(ip, p, timeout, hijackedPorts[p], isTestedOffline)
				portChan <- portRes{port: p, open: open, online: online}
			}
		}()
	}
	for _, port := range ports {
		portJobs <- port
	}
	close(portJobs)

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

func checkPort(ip string, port int, timeout time.Duration, isHijacked bool, isTestedOffline bool) (bool, bool) {
	// 如果在初始化环境探测时，该 IP 已经被检验为在该端口上完全不通且没被劫持，为了避免 ARP 缓存冲突误判，快速跳过
	if isTestedOffline {
		return false, false
	}

	address := fmt.Sprintf("%s:%d", ip, port)
	conn, err := net.DialTimeout("tcp", address, timeout)
	if err != nil {
		errStr := strings.ToLower(err.Error())
		if strings.Contains(errStr, "connection refused") {
			// 如果该端口本身被判定为全局劫持/异常，那么本地网络直接返回的 connection refused 不能作为主机存活的依据
			if isHijacked {
				return false, false
			}
			return false, true // 端口关闭但主机存活
		}
		return false, false
	}
	conn.Close()

	// 如果该端口检测到本地劫持/异常，执行深度协议握手校验
	if isHijacked {
		if deepVerifyPort(ip, port, timeout) {
			return true, true
		}
		return false, false
	}

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
		if r.K8sRole != "" {
			asset.K8sRole = r.K8sRole
			asset.Tags = mergeTag(asset.Tags, "k8s")
			ensureTag(db, "k8s", "#326ce5")
		}
		if err := db.Save(&asset).Error; err != nil {
			log.Printf("Scanner db save error for ip %s: %v", r.IP, err)
			return false, err
		}
		return false, nil
	} else {
		// 新增资产：名称按识别到的类型作前缀（路由器 router- / 交换机 switch- / 其余默认 server-）
		namePrefix := "server"
		switch r.Type {
		case "router":
			namePrefix = "router"
		case "switch":
			namePrefix = "switch"
		}
		newAsset := model.Asset{
			Name:          fmt.Sprintf("%s-%s", namePrefix, r.IP),
			IP:            r.IP,
			Type:          r.Type,
			Status:        "online",
			Vendor:        r.Vendor,
			OSVersion:     r.Version,
			Ports:         string(portsJSON),
			LastScannedAt: &now,
		}
		if r.K8sRole != "" {
			newAsset.K8sRole = r.K8sRole
			newAsset.Tags = mergeTag("", "k8s")
			ensureTag(db, "k8s", "#326ce5")
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
