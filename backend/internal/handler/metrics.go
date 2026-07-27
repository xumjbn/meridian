package handler

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"backend/internal/model"
	"backend/internal/store"

	"github.com/gin-gonic/gin"
)

// ─────────────────────────────────────────────────────────────
// 主机资源用量采集（CPU / 内存 / 磁盘）
//
// 目标机可能是 Linux、macOS 或 Windows，三者取数方式完全不同：
//   - Linux ：/proc/stat 两次采样算 CPU、/proc/meminfo 取内存、df 取磁盘
//   - macOS ：top -l 取 CPU、vm_stat + hw.memsize 取内存、df 取磁盘
//   - Windows：SSH 落到 PowerShell，走 CIM 取三项
// 因此先跑 POSIX 脚本（内部按 uname 分支），失败再退到 PowerShell。
// 两条路径输出同一套 key=value，解析逻辑只有一份。
// ─────────────────────────────────────────────────────────────

// posixMetricsScript 在 Linux / macOS 上取用量，统一输出 KB 与百分比
const posixMetricsScript = `
OS=$(uname -s 2>/dev/null || echo unknown)
CPU=0; MU=0; MT=0; DU=0; DT=0
if [ "$OS" = "Linux" ]; then
  S1=$(awk '/^cpu /{idle=$5; tot=0; for(i=2;i<=NF;i++) tot+=$i; print idle, tot}' /proc/stat)
  sleep 0.3
  S2=$(awk '/^cpu /{idle=$5; tot=0; for(i=2;i<=NF;i++) tot+=$i; print idle, tot}' /proc/stat)
  CPU=$(echo "$S1 $S2" | awk '{di=$3-$1; dt=$4-$2; if (dt>0) printf "%.1f", (1-di/dt)*100; else printf "0"}')
  eval $(awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{printf "MT=%d; MU=%d", t, t-a}' /proc/meminfo)
elif [ "$OS" = "Darwin" ]; then
  CPU=$(top -l 1 -n 0 2>/dev/null | awk -F'[ %]+' '/CPU usage/{print $3+$5; exit}')
  PS=$(sysctl -n hw.pagesize 2>/dev/null || echo 4096)
  MT=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1024 ))
  FREEP=$(vm_stat 2>/dev/null | awk '/Pages free/{gsub("\.","",$3); f=$3} /Pages inactive/{gsub("\.","",$3); i=$3} END{print f+i+0}')
  MU=$(( MT - FREEP * PS / 1024 ))
else
  exit 3
fi
read DU DT <<EOF
$(df -kP / 2>/dev/null | awk 'NR==2{print $3, $2}')
EOF
[ -z "$CPU" ] && CPU=0
echo "OS=$OS"
echo "CPU=$CPU"
echo "MEM_USED_KB=$MU"
echo "MEM_TOTAL_KB=$MT"
echo "DISK_USED_KB=$DU"
echo "DISK_TOTAL_KB=$DT"
`

// windowsMetricsScript 走 PowerShell 取用量（Windows OpenSSH 默认 shell 可能是 cmd，故显式调用 powershell）
const windowsMetricsScript = `powershell -NoProfile -NonInteractive -Command "` +
	`$os=Get-CimInstance Win32_OperatingSystem; ` +
	`$cpu=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; ` +
	`$d=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='C:'\"; ` +
	`Write-Output ('OS=Windows'); ` +
	`Write-Output ('CPU=' + $cpu); ` +
	`Write-Output ('MEM_USED_KB=' + ($os.TotalVisibleMemorySize - $os.FreePhysicalMemory)); ` +
	`Write-Output ('MEM_TOTAL_KB=' + $os.TotalVisibleMemorySize); ` +
	`Write-Output ('DISK_USED_KB=' + [int](($d.Size - $d.FreeSpace)/1024)); ` +
	`Write-Output ('DISK_TOTAL_KB=' + [int]($d.Size/1024))"`

type hostMetrics struct {
	OS          string  `json:"os"`
	CPUPercent  float64 `json:"cpu_percent"`
	MemUsedKB   int64   `json:"mem_used_kb"`
	MemTotalKB  int64   `json:"mem_total_kb"`
	DiskUsedKB  int64   `json:"disk_used_kb"`
	DiskTotalKB int64   `json:"disk_total_kb"`
}

// parseMetrics 解析 key=value 输出；两个平台的脚本共用同一份解析
func parseMetrics(out string) (hostMetrics, bool) {
	m := hostMetrics{}
	got := false
	for _, ln := range strings.Split(out, "\n") {
		parts := strings.SplitN(strings.TrimSpace(ln), "=", 2)
		if len(parts) != 2 {
			continue
		}
		key, val := parts[0], strings.TrimSpace(parts[1])
		switch key {
		case "OS":
			m.OS = val
		case "CPU":
			if f, err := strconv.ParseFloat(val, 64); err == nil {
				m.CPUPercent = f
				got = true
			}
		case "MEM_USED_KB":
			m.MemUsedKB, _ = strconv.ParseInt(val, 10, 64)
		case "MEM_TOTAL_KB":
			m.MemTotalKB, _ = strconv.ParseInt(val, 10, 64)
		case "DISK_USED_KB":
			m.DiskUsedKB, _ = strconv.ParseInt(val, 10, 64)
		case "DISK_TOTAL_KB":
			m.DiskTotalKB, _ = strconv.ParseInt(val, 10, 64)
		}
	}
	// 内存总量为 0 视为采集失败（脚本没跑通/权限不足）
	return m, got && m.MemTotalKB > 0
}

// collectHostMetrics 对单台资产采集用量：先 POSIX，再 PowerShell 兜底
func collectHostMetrics(asset *model.Asset) (hostMetrics, error) {
	if asset.CredentialID == nil {
		return hostMetrics{}, fmt.Errorf("未绑定凭据")
	}
	var cred model.Credential
	if store.GlobalDB.First(&cred, *asset.CredentialID).Error != nil {
		return hostMetrics{}, fmt.Errorf("凭据不存在")
	}
	if cred.Type == "telnet" {
		return hostMetrics{}, fmt.Errorf("Telnet 不支持资源采集")
	}
	client, err := dialSSHForAsset(asset, &cred)
	if err != nil {
		return hostMetrics{}, fmt.Errorf("SSH 连接失败: %v", err)
	}
	defer client.Close()

	run := func(script string) (string, error) {
		sess, err := client.NewSession()
		if err != nil {
			return "", err
		}
		defer sess.Close()
		out, err := sess.CombinedOutput(script)
		return string(out), err
	}

	// 1) POSIX（Linux / macOS）
	if out, err := run(posixMetricsScript); err == nil {
		if m, ok := parseMetrics(out); ok {
			return m, nil
		}
	}
	// 2) Windows PowerShell 兜底
	out, err := run(windowsMetricsScript)
	if err != nil {
		return hostMetrics{}, fmt.Errorf("采集命令执行失败: %v", err)
	}
	m, ok := parseMetrics(out)
	if !ok {
		return hostMetrics{}, fmt.Errorf("无法解析采集结果（目标系统可能不受支持）")
	}
	return m, nil
}

// saveMetrics 把采集结果写回资产
func saveMetrics(asset *model.Asset, m hostMetrics) {
	now := time.Now()
	store.GlobalDB.Model(asset).Updates(map[string]interface{}{
		"cpu_percent":   m.CPUPercent,
		"mem_used_kb":   m.MemUsedKB,
		"mem_total_kb":  m.MemTotalKB,
		"disk_used_kb":  m.DiskUsedKB,
		"disk_total_kb": m.DiskTotalKB,
		"metrics_os":    m.OS,
		"metrics_at":    &now,
	})
}

// CollectAssetMetrics 采集单台资产的 CPU / 内存 / 磁盘用量
func CollectAssetMetrics(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var asset model.Asset
	if store.GlobalDB.First(&asset, id).Error != nil {
		SendError(c, 404, "资产不存在")
		return
	}
	if !canAccess(c, asset.OwnerID) {
		SendError(c, 403, "无权操作该资产")
		return
	}
	m, err := collectHostMetrics(&asset)
	if err != nil {
		SendSuccess(c, gin.H{"ok": false, "message": err.Error()})
		return
	}
	saveMetrics(&asset, m)
	SendSuccess(c, gin.H{"ok": true, "metrics": m})
}

// BatchCollectAssetMetrics 批量采集（勾选多台时用）；逐台串行，失败不中断
func BatchCollectAssetMetrics(c *gin.Context) {
	var req struct {
		IDs []uint `json:"ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, "参数格式错误")
		return
	}
	ok, failed := 0, make([]gin.H, 0)
	for _, id := range req.IDs {
		var asset model.Asset
		if store.GlobalDB.First(&asset, id).Error != nil {
			continue
		}
		if !canAccess(c, asset.OwnerID) {
			continue
		}
		m, err := collectHostMetrics(&asset)
		if err != nil {
			failed = append(failed, gin.H{"ip": asset.IP, "msg": err.Error()})
			continue
		}
		saveMetrics(&asset, m)
		ok++
	}
	SendSuccess(c, gin.H{"ok": ok, "failed": failed})
}
