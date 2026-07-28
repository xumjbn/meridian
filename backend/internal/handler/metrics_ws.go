package handler

import (
	"fmt"
	"log"
	"strconv"
	"time"

	"backend/internal/model"
	"backend/internal/store"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

// ─────────────────────────────────────────────────────────────
// 实时资源监控（FinalShell 式）
//
// 一次性「采集」按钮解决不了「盯着看」的需求：每次点都要重新建 SSH 连接，
// 一次往返上千毫秒，也没法连续观察曲线。这里改成：
//   建立一条常驻 SSH 连接 → 每隔 N 秒在其上开一个 exec 会话取一次数
//   → 通过 WebSocket 推给前端。
// 复用同一条 TCP/SSH 连接是关键：SSH 握手（KEX + 认证）才是耗时大头，
// exec 会话本身很轻。
// ─────────────────────────────────────────────────────────────

const (
	metricsInterval   = 2 * time.Second
	metricsMaxIdle    = 30 * time.Minute // 兜底：超时自动断，防止前端异常退出后连接泄漏
	metricsWriteWait  = 8 * time.Second
)

// StreamAssetMetrics 建立 WebSocket，持续推送目标主机的 CPU / 内存 / 磁盘用量
func StreamAssetMetrics(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var asset model.Asset
	if store.GlobalDB.First(&asset, id).Error != nil {
		SendError(c, 404, "资产不存在")
		return
	}
	if !canAccess(c, asset.OwnerID) {
		SendError(c, 403, "无权查看该资产")
		return
	}

	ws, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("StreamAssetMetrics: WebSocket 升级失败: %v", err)
		return
	}
	defer ws.Close()

	// 先推一帧可读原因，再正经发关闭帧——直接 Close 会让浏览器只看到
	// code 1006（异常断开），前端无从判断到底是没连上还是被拒绝。
	sendErr := func(msg string) {
		_ = ws.SetWriteDeadline(time.Now().Add(metricsWriteWait))
		_ = ws.WriteJSON(gin.H{"ok": false, "message": msg})
		_ = ws.WriteControl(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, msg),
			time.Now().Add(metricsWriteWait),
		)
	}

	if asset.CredentialID == nil {
		sendErr("该资产未绑定 SSH 凭据，无法监控")
		return
	}
	var cred model.Credential
	if store.GlobalDB.First(&cred, *asset.CredentialID).Error != nil {
		sendErr("凭据不存在")
		return
	}
	if cred.Type == "telnet" {
		sendErr("Telnet 凭据不支持资源监控")
		return
	}

	client, err := dialSSHForAsset(&asset, &cred)
	if err != nil {
		sendErr(fmt.Sprintf("SSH 连接失败: %v", err))
		return
	}
	defer client.Close()

	// 读协程：前端关闭页面/标签时读出错，据此结束推送
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				return
			}
		}
	}()

	// 首次探测确定平台：POSIX 脚本跑不通就退到 PowerShell，之后固定用命中的那条，
	// 免得每一轮都白跑一次失败的命令。
	// 速率基准跟着这条连接走：首帧只用来打基准，网络/磁盘速率从第二帧才有值
	st := &rateState{}

	script := posixMetricsScript
	if m, ok := runMetricsOnce(client, script); ok {
		pushMetrics(ws, m, st)
	} else {
		script = windowsMetricsScript
		if m, ok := runMetricsOnce(client, script); ok {
			pushMetrics(ws, m, st)
		} else {
			sendErr("无法采集该主机的资源用量（目标系统可能不受支持）")
			return
		}
	}

	ticker := time.NewTicker(metricsInterval)
	defer ticker.Stop()
	deadline := time.After(metricsMaxIdle)

	for {
		select {
		case <-done:
			return
		case <-deadline:
			return
		case <-ticker.C:
			m, ok := runMetricsOnce(client, script)
			if !ok {
				// 单次失败不断开：网络抖动或瞬时负载导致的失败下一轮多半能恢复
				continue
			}
			if !pushMetrics(ws, m, st) {
				return
			}
		}
	}
}

// runMetricsOnce 在已建立的 SSH 连接上开一个 exec 会话取一次数
func runMetricsOnce(client *ssh.Client, script string) (hostMetrics, bool) {
	sess, err := client.NewSession()
	if err != nil {
		return hostMetrics{}, false
	}
	defer sess.Close()
	out, err := sess.CombinedOutput(script)
	if err != nil && len(out) == 0 {
		return hostMetrics{}, false
	}
	return parseMetrics(string(out))
}

// rateState 记录上一帧的累计计数器，用来把「累计字节」换算成「每秒速率」。
// 网络吞吐和磁盘 IO 在系统里都只有自开机以来的累计值，单看一帧没有意义。
type rateState struct {
	at                        time.Time
	rx, tx, diskRead, diskWrt int64
	valid                     bool
}

// rates 用当前帧与上一帧求差得出速率（字节/秒），并把当前帧存为下一次的基准。
// 首帧没有基准，速率一律给 0，不要凭一帧去猜。
func (s *rateState) rates(m hostMetrics) (rx, tx, dr, dw float64) {
	now := time.Now()
	if s.valid {
		if dt := now.Sub(s.at).Seconds(); dt > 0.05 {
			// 计数器回绕或主机重启会导致负值，这种帧直接算 0，别喷出个天文数字
			d := func(cur, prev int64) float64 {
				if cur < prev {
					return 0
				}
				return float64(cur-prev) / dt
			}
			rx = d(m.NetRxBytes, s.rx)
			tx = d(m.NetTxBytes, s.tx)
			dr = d(m.DiskReadByte, s.diskRead)
			dw = d(m.DiskWriteByt, s.diskWrt)
		}
	}
	s.at, s.rx, s.tx, s.diskRead, s.diskWrt, s.valid =
		now, m.NetRxBytes, m.NetTxBytes, m.DiskReadByte, m.DiskWriteByt, true
	return
}

// pushMetrics 推一帧数据；返回 false 表示连接已不可写
func pushMetrics(ws wsWriter, m hostMetrics, st *rateState) bool {
	rx, tx, dr, dw := st.rates(m)
	_ = ws.SetWriteDeadline(time.Now().Add(metricsWriteWait))
	err := ws.WriteJSON(gin.H{
		"ok":       true,
		"os":       m.OS,
		"hostname": m.Hostname,
		"kernel":   m.Kernel,
		"distro":   m.Distro,
		"uptime_sec": m.UptimeS,

		"cpu_percent": m.CPUPercent,
		"cpu_cores":   m.CPUCores,
		"load1":       m.Load1,
		"load5":       m.Load5,
		"load15":      m.Load15,

		"mem_used_kb":   m.MemUsedKB,
		"mem_total_kb":  m.MemTotalKB,
		"mem_cache_kb":  m.MemCacheKB,
		"swap_used_kb":  m.SwapUsedKB,
		"swap_total_kb": m.SwapTotalKB,

		"disk_used_kb":  m.DiskUsedKB,
		"disk_total_kb": m.DiskTotalKB,
		"mounts":        m.Mounts,

		// 速率单位统一为 字节/秒，前端只管挑单位显示
		"net_rx_bps":     rx,
		"net_tx_bps":     tx,
		"disk_read_bps":  dr,
		"disk_write_bps": dw,

		"tcp_count": m.TCPCount,
		"procs":     m.Procs,
		"ts":        time.Now().UnixMilli(),
	})
	return err == nil
}

// wsWriter 抽出所需的最小接口，便于单测替换
type wsWriter interface {
	SetWriteDeadline(t time.Time) error
	WriteJSON(v interface{}) error
}
