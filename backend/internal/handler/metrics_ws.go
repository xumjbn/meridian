package handler

import (
	"fmt"
	"log"
	"strconv"
	"time"

	"backend/internal/model"
	"backend/internal/store"

	"github.com/gin-gonic/gin"
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

	sendErr := func(msg string) {
		_ = ws.SetWriteDeadline(time.Now().Add(metricsWriteWait))
		_ = ws.WriteJSON(gin.H{"ok": false, "message": msg})
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
	script := posixMetricsScript
	if m, ok := runMetricsOnce(client, script); ok {
		pushMetrics(ws, m)
	} else {
		script = windowsMetricsScript
		if m, ok := runMetricsOnce(client, script); ok {
			pushMetrics(ws, m)
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
			if !pushMetrics(ws, m) {
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

// pushMetrics 推一帧数据；返回 false 表示连接已不可写
func pushMetrics(ws wsWriter, m hostMetrics) bool {
	_ = ws.SetWriteDeadline(time.Now().Add(metricsWriteWait))
	err := ws.WriteJSON(gin.H{
		"ok":            true,
		"os":            m.OS,
		"cpu_percent":   m.CPUPercent,
		"mem_used_kb":   m.MemUsedKB,
		"mem_total_kb":  m.MemTotalKB,
		"disk_used_kb":  m.DiskUsedKB,
		"disk_total_kb": m.DiskTotalKB,
		"ts":            time.Now().UnixMilli(),
	})
	return err == nil
}

// wsWriter 抽出所需的最小接口，便于单测替换
type wsWriter interface {
	SetWriteDeadline(t time.Time) error
	WriteJSON(v interface{}) error
}
