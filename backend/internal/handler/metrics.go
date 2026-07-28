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

// posixMetricsScript 在 Linux / macOS 上取用量，统一输出 key=value。
//
// 覆盖面对标 FinalShell / xterminal 的侧栏监控：光有 CPU/内存/根分区三项，
// 面板上就只能画三根条——网络吞吐、磁盘 IO、负载、swap、各分区、TOP 进程
// 才是盯机器时真正在看的东西。
//
// 几个踩过的坑（都在 WSL2 Ubuntu 上用 dash 实测过）：
//   - /proc/net/dev 行首有可变空格、网卡名与数字之间是冒号，按空白切字段会错位
//     （错误写法量出来 rx 只有 182 字节）。必须先定位冒号再切。
//   - ps 的 pcpu 是进程生命周期均值，盯实时负载没意义，优先用 top -bn1 取瞬时值。
//   - 采集命令自身（top/ps）会排在 CPU 榜首，必须排除。
//   - df 要只认块设备挂载，否则 tmpfs/overlay/9p 会刷出一堆假分区。
// 网络与磁盘 IO 输出的是累计值，速率由 Go 侧按相邻两帧求差（见 metrics_ws.go）。
const posixMetricsScript = `
OS=$(uname -s 2>/dev/null || echo unknown)
CPU=0; MU=0; MT=0; MC=0; SU=0; ST=0; DU=0; DT=0
CORES=1; L1=0; L5=0; L15=0; UP=0; RX=0; TX=0; DR=0; DW=0; TCPC=0
HOST=$(hostname 2>/dev/null || echo -)
KERN=$(uname -r 2>/dev/null || echo -)
DISTRO=

if [ "$OS" = "Linux" ]; then
  S1=$(awk '/^cpu /{idle=$5+$6; tot=0; for(i=2;i<=NF;i++) tot+=$i; print idle, tot}' /proc/stat)
  sleep 0.3
  S2=$(awk '/^cpu /{idle=$5+$6; tot=0; for(i=2;i<=NF;i++) tot+=$i; print idle, tot}' /proc/stat)
  CPU=$(echo "$S1 $S2" | awk '{di=$3-$1; dt=$4-$2; if (dt>0) printf "%.1f", (1-di/dt)*100; else printf "0"}')
  CORES=$(awk '/^processor/{n++} END{print n+0}' /proc/cpuinfo)
  eval $(awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} /^Buffers:/{b=$2} /^Cached:/{c=$2} /^SwapTotal:/{st=$2} /^SwapFree:/{sf=$2} END{printf "MT=%d; MU=%d; MC=%d; ST=%d; SU=%d", t, t-a, b+c, st, st-sf}' /proc/meminfo)
  read L1 L5 L15 _rest < /proc/loadavg
  UP=$(awk '{printf "%d", $1}' /proc/uptime)
  DISTRO=$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")
  eval $(awk 'NR>2 { sub(/^[ \t]+/, ""); i=index($0, ":"); n=substr($0,1,i-1);
        if (n=="lo" || n ~ /^(docker|veth|br-|virbr|cni|flannel|kube|tun|tap)/) next;
        split(substr($0,i+1), f); r+=f[1]; t+=f[9] }
        END{printf "RX=%d; TX=%d", r+0, t+0}' /proc/net/dev)
  eval $(awk '{ n=$3; if (n ~ /^(loop|ram|dm-)/) next; if (n ~ /[0-9]$/ && n ~ /^(sd|vd|hd)/) next; r+=$6; w+=$10 }
        END{printf "DR=%d; DW=%d", (r+0)*512, (w+0)*512}' /proc/diskstats)
  TCPC=$(awk 'NR>1' /proc/net/tcp 2>/dev/null | wc -l)
elif [ "$OS" = "Darwin" ]; then
  CPU=$(top -l 1 -n 0 2>/dev/null | awk -F'[ %]+' '/CPU usage/{print $3+$5; exit}')
  CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo 1)
  PS=$(sysctl -n hw.pagesize 2>/dev/null || echo 4096)
  MT=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1024 ))
  FREEP=$(vm_stat 2>/dev/null | awk '/Pages free/{gsub("\.","",$3); f=$3} /Pages inactive/{gsub("\.","",$3); i=$3} END{print f+i+0}')
  MU=$(( MT - FREEP * PS / 1024 ))
  UP=$(sysctl -n kern.boottime 2>/dev/null | awk -F'[= ,]+' '{print systime()-$4}')
  DISTRO=$(sw_vers -productName 2>/dev/null)$(sw_vers -productVersion 2>/dev/null | sed 's/^/ /')
  set -- $(sysctl -n vm.loadavg 2>/dev/null | tr -d '{}')
  L1=$1; L5=$2; L15=$3
  eval $(netstat -ib 2>/dev/null | awk '$1!="lo0" && NF>=10 && !seen[$1]++ {r+=$7; t+=$10} END{printf "RX=%d; TX=%d", r+0, t+0}')
else
  exit 3
fi
[ -z "$CPU" ] && CPU=0

echo "OS=$OS"
echo "HOSTNAME=$HOST"
echo "KERNEL=$KERN"
echo "DISTRO=$DISTRO"
echo "UPTIME_SEC=$UP"
echo "CPU=$CPU"
echo "CPU_CORES=$CORES"
echo "LOAD1=$L1"
echo "LOAD5=$L5"
echo "LOAD15=$L15"
echo "MEM_USED_KB=$MU"
echo "MEM_TOTAL_KB=$MT"
echo "MEM_CACHE_KB=$MC"
echo "SWAP_USED_KB=$SU"
echo "SWAP_TOTAL_KB=$ST"
echo "NET_RX_BYTES=$RX"
echo "NET_TX_BYTES=$TX"
echo "DISKIO_READ_BYTES=$DR"
echo "DISKIO_WRITE_BYTES=$DW"
echo "TCP_COUNT=$TCPC"

df -kP / 2>/dev/null | awk 'NR==2{print "DISK_USED_KB=" $3 "\nDISK_TOTAL_KB=" $2}'

df -kP 2>/dev/null | awk 'NR>1 && $2>0 && $1 ~ /^\/dev\// && !seen[$6]++ {
  printf "MOUNT=%s|%s|%s\n", $6, $3, $2 }' | head -8

if command -v top >/dev/null 2>&1; then
  top -bn1 -w 512 2>/dev/null | awk '
    /^ *PID/ {h=1; for(i=1;i<=NF;i++){ if($i=="%CPU")c=i; if($i=="%MEM")m=i; if($i=="COMMAND")n=i } next }
    h && NF>=n && $n!="top" && $n!="ps" && c && m { printf "PROC=%s|%s|%s\n", $n, $c, $m; if(++k>=5) exit }'
else
  ps -eo comm,pcpu,pmem 2>/dev/null | sort -k2 -rn | awk '$1!="ps" && $1!="COMMAND" {printf "PROC=%s|%s|%s\n", $1, $2, $3; if(++k>=5) exit}'
fi
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

// mountUsage 单个挂载点的用量
type mountUsage struct {
	Path    string `json:"path"`
	UsedKB  int64  `json:"used_kb"`
	TotalKB int64  `json:"total_kb"`
}

// procInfo TOP 进程一行
type procInfo struct {
	Name string  `json:"name"`
	CPU  float64 `json:"cpu"`
	Mem  float64 `json:"mem"`
}

type hostMetrics struct {
	OS       string `json:"os"`
	Hostname string `json:"hostname"`
	Kernel   string `json:"kernel"`
	Distro   string `json:"distro"`
	UptimeS  int64  `json:"uptime_sec"`

	CPUPercent float64 `json:"cpu_percent"`
	CPUCores   int     `json:"cpu_cores"`
	Load1      float64 `json:"load1"`
	Load5      float64 `json:"load5"`
	Load15     float64 `json:"load15"`

	MemUsedKB   int64 `json:"mem_used_kb"`
	MemTotalKB  int64 `json:"mem_total_kb"`
	MemCacheKB  int64 `json:"mem_cache_kb"`
	SwapUsedKB  int64 `json:"swap_used_kb"`
	SwapTotalKB int64 `json:"swap_total_kb"`

	DiskUsedKB  int64 `json:"disk_used_kb"`
	DiskTotalKB int64 `json:"disk_total_kb"`

	// 累计计数器：速率由调用方按相邻两帧求差得出，这里不做换算
	NetRxBytes   int64 `json:"net_rx_bytes"`
	NetTxBytes   int64 `json:"net_tx_bytes"`
	DiskReadByte int64 `json:"disk_read_bytes"`
	DiskWriteByt int64 `json:"disk_write_bytes"`

	TCPCount int          `json:"tcp_count"`
	Mounts   []mountUsage `json:"mounts"`
	Procs    []procInfo   `json:"procs"`
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
		num := func() int64 { n, _ := strconv.ParseInt(val, 10, 64); return n }
		flt := func() float64 { f, _ := strconv.ParseFloat(val, 64); return f }
		switch key {
		case "OS":
			m.OS = val
		case "HOSTNAME":
			m.Hostname = val
		case "KERNEL":
			m.Kernel = val
		case "DISTRO":
			m.Distro = val
		case "UPTIME_SEC":
			m.UptimeS = num()
		case "CPU":
			if f, err := strconv.ParseFloat(val, 64); err == nil {
				m.CPUPercent = f
				got = true
			}
		case "CPU_CORES":
			m.CPUCores = int(num())
		case "LOAD1":
			m.Load1 = flt()
		case "LOAD5":
			m.Load5 = flt()
		case "LOAD15":
			m.Load15 = flt()
		case "MEM_USED_KB":
			m.MemUsedKB = num()
		case "MEM_TOTAL_KB":
			m.MemTotalKB = num()
		case "MEM_CACHE_KB":
			m.MemCacheKB = num()
		case "SWAP_USED_KB":
			m.SwapUsedKB = num()
		case "SWAP_TOTAL_KB":
			m.SwapTotalKB = num()
		case "NET_RX_BYTES":
			m.NetRxBytes = num()
		case "NET_TX_BYTES":
			m.NetTxBytes = num()
		case "DISKIO_READ_BYTES":
			m.DiskReadByte = num()
		case "DISKIO_WRITE_BYTES":
			m.DiskWriteByt = num()
		case "TCP_COUNT":
			m.TCPCount = int(num())
		case "DISK_USED_KB":
			m.DiskUsedKB = num()
		case "DISK_TOTAL_KB":
			m.DiskTotalKB = num()
		case "MOUNT":
			// path|used_kb|total_kb
			f := strings.Split(val, "|")
			if len(f) == 3 {
				u, _ := strconv.ParseInt(f[1], 10, 64)
				t, _ := strconv.ParseInt(f[2], 10, 64)
				if t > 0 {
					m.Mounts = append(m.Mounts, mountUsage{Path: f[0], UsedKB: u, TotalKB: t})
				}
			}
		case "PROC":
			// name|cpu|mem
			f := strings.Split(val, "|")
			if len(f) == 3 && f[0] != "" {
				cpu, _ := strconv.ParseFloat(f[1], 64)
				mem, _ := strconv.ParseFloat(f[2], 64)
				m.Procs = append(m.Procs, procInfo{Name: f[0], CPU: cpu, Mem: mem})
			}
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
