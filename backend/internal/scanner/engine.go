package scanner

import (
	"fmt"
	"log"
	"time"

	"backend/internal/model"
	"gorm.io/gorm"
)

// ScanEngine 描述一个可插拔的扫描引擎实现。
// 每个引擎负责加载任务、写入扫描日志并落库自身的结果。
// 该接口主要用于文档化扫描层的可扩展契约，便于后续接入更多引擎。
type ScanEngine interface {
	// Run 执行指定任务的扫描流程。
	Run(db *gorm.DB, taskID uint)
}

// StartScanTask 是扫描任务的统一入口分发器。
// 它根据任务的 Kind 字段选择对应的扫描引擎：
//   - "vuln"      -> nuclei 漏洞扫描 (runNucleiScan)
//   - 其它/默认    -> 端口发现扫描 (runDiscoveryScan)
func StartScanTask(db *gorm.DB, taskID uint) {
	// 兜底：扫描在独立 goroutine 中执行，若内部 panic 未被捕获将直接终止整个进程。
	// 这里恢复 panic，并尽力把任务与最近一条运行中的日志标记为失败，避免卡在 running。
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Scanner: PANIC recovered for task %d: %v", taskID, r)
			db.Model(&model.ScanTask{}).Where("id = ?", taskID).Update("status", "failed")
			var sl model.ScanLog
			if err := db.Where("task_id = ? AND status = ?", taskID, "running").Order("id desc").First(&sl).Error; err == nil {
				db.Model(&sl).Updates(map[string]interface{}{
					"status":      "failed",
					"finished_at": time.Now(),
					"summary":     fmt.Sprintf("扫描发生内部错误并已中止: %v", r),
				})
			}
		}
	}()

	var task model.ScanTask
	if err := db.First(&task, taskID).Error; err != nil {
		log.Printf("Scanner: task %d not found: %v", taskID, err)
		return
	}

	if task.Kind == "vuln" {
		runNucleiScan(db, taskID)
		return
	}
	runDiscoveryScan(db, taskID)
}
