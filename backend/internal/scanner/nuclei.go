package scanner

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"time"

	"backend/internal/model"
	"gorm.io/gorm"
)

// nucleiFinding 是 nuclei -jsonl 输出中单条结果的精简结构。
type nucleiFinding struct {
	TemplateID string `json:"template-id"`
	Host       string `json:"host"`
	MatchedAt  string `json:"matched-at"`
	Info       struct {
		Name     string `json:"name"`
		Severity string `json:"severity"`
	} `json:"info"`
}

// runNucleiScan 执行基于 nuclei 的漏洞扫描任务。
// 整体编排结构与 runDiscoveryScan 保持一致：加载任务、创建日志、注册可取消上下文、
// 解析目标、逐个目标调用 nuclei 并落库 VulnFinding，最后收尾。
func runNucleiScan(db *gorm.DB, taskID uint) {
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
		Summary:   "漏洞扫描已启动",
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

	// 2. 解析目标 IP 列表
	ips, err := ParseIPRange(task.TargetRange)
	if err != nil {
		finishTask(db, &task, &scanLog, "failed", fmt.Sprintf("解析目标网段失败: %v", err))
		return
	}

	appendDetailLog(db, &scanLog, "启动漏洞扫描任务: %s", task.Name)
	appendDetailLog(db, &scanLog, "目标范围: %s，共解析出 %d 个目标", task.TargetRange, len(ips))

	// 3. 定位 nuclei 可执行文件 (优雅降级：未安装时给出明确提示并失败收尾)
	bin, lookErr := exec.LookPath("nuclei")
	if lookErr != nil {
		appendDetailLog(db, &scanLog, "未检测到 nuclei 可执行文件；请先安装：go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest")
		finishTask(db, &task, &scanLog, "failed", "nuclei 未安装，无法执行漏洞扫描")
		return
	}
	appendDetailLog(db, &scanLog, "已定位 nuclei: %s", bin)

	// 4. 逐个目标执行 nuclei 扫描
	findingCount := 0
	for _, ip := range ips {
		// 检查是否被手动取消
		select {
		case <-ctx.Done():
			appendDetailLog(db, &scanLog, "漏洞扫描任务已被用户手动停止！已发现漏洞: %d", findingCount)
			finishTask(db, &task, &scanLog, "failed", "已手动停止")
			return
		default:
		}

		appendDetailLog(db, &scanLog, "正在扫描 %s", ip)

		cmd := exec.CommandContext(ctx, bin, "-target", ip, "-jsonl", "-silent", "-duc", "-timeout", "10")
		stdout, runErr := cmd.Output()
		// nuclei 在发现漏洞时可能以非零状态码退出，这不视为致命错误；仍解析 stdout。
		if runErr != nil {
			if ctx.Err() != nil {
				// 上下文被取消（手动停止）
				appendDetailLog(db, &scanLog, "漏洞扫描任务已被用户手动停止！已发现漏洞: %d", findingCount)
				finishTask(db, &task, &scanLog, "failed", "已手动停止")
				return
			}
			log.Printf("Scanner: nuclei on %s exited with: %v", ip, runErr)
		}

		// 5. 逐行解析 nuclei 的 JSONL 输出
		scanner := bufio.NewScanner(bytes.NewReader(stdout))
		scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024) // 1MB 缓冲，单行结果可能较长
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}

			var f nucleiFinding
			if err := json.Unmarshal([]byte(line), &f); err != nil {
				log.Printf("Scanner: failed to parse nuclei output line: %v", err)
				continue
			}

			// 关联 CMDB 资产（未匹配则 AssetID 为 0）
			var assetID uint
			var asset model.Asset
			if err := db.Where("ip = ?", ip).First(&asset).Error; err == nil {
				assetID = asset.ID
			}

			finding := model.VulnFinding{
				AssetID:    assetID,
				Target:     ip,
				TemplateID: f.TemplateID,
				Name:       f.Info.Name,
				Severity:   f.Info.Severity,
				MatchedAt:  f.MatchedAt,
				Engine:     "nuclei",
				CreatedAt:  time.Now(),
			}
			if err := db.Create(&finding).Error; err != nil {
				log.Printf("Scanner: failed to save vuln finding for %s: %v", ip, err)
				continue
			}

			findingCount++
			appendDetailLog(db, &scanLog, "[%s] %s @ %s",
				strings.ToUpper(f.Info.Severity), f.Info.Name, f.MatchedAt)
		}
		if scanErr := scanner.Err(); scanErr != nil {
			log.Printf("Scanner: error reading nuclei output for %s: %v", ip, scanErr)
		}
	}

	// 6. 标记任务完成
	appendDetailLog(db, &scanLog, "漏洞扫描任务执行完毕！")
	summary := fmt.Sprintf("漏洞扫描完成。目标数: %d，发现漏洞: %d", len(ips), findingCount)
	finishTask(db, &task, &scanLog, "completed", summary)
}
