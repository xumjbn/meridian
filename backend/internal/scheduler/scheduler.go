package scheduler

import (
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"backend/internal/model"
	"backend/internal/scanner"
	"gorm.io/gorm"
)

// 轻量自包含定时调度器（无外部 cron 依赖）。
// 每 30 秒轮询一次所有带计划的扫描任务，到点则触发。
//
// 支持的 schedule 语法：
//   ""                — 不定时（仅手动）
//   "@every 15m"      — 固定间隔（Go time.ParseDuration，最小 1 分钟）
//   "daily:HH:MM"     — 每天指定时刻

var (
	db      *gorm.DB
	mu      sync.Mutex
	lastRun = map[uint]time.Time{} // taskID -> 上次调度触发时间（内存态）
	stopCh  chan struct{}
)

const tickInterval = 30 * time.Second

// Start 启动后台调度循环
func Start(database *gorm.DB) {
	db = database
	stopCh = make(chan struct{})
	go loop()
	log.Printf("Scheduler: started (polling every %v)", tickInterval)
}

// Stop 停止调度（一般随进程退出，无需显式调用）
func Stop() {
	if stopCh != nil {
		close(stopCh)
	}
}

func loop() {
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()
	for {
		select {
		case <-stopCh:
			return
		case now := <-ticker.C:
			tick(now)
		}
	}
}

func tick(now time.Time) {
	var tasks []model.ScanTask
	if err := db.Where("schedule <> '' AND schedule IS NOT NULL").Find(&tasks).Error; err != nil {
		log.Printf("Scheduler: query error: %v", err)
		return
	}
	for _, t := range tasks {
		if t.Status == "running" {
			continue
		}
		if shouldRun(t, now) {
			mu.Lock()
			lastRun[t.ID] = now
			mu.Unlock()
			log.Printf("Scheduler: triggering task %d (%s) by schedule %q", t.ID, t.Name, t.Schedule)
			go scanner.StartScanTask(db, t.ID)
		}
	}
}

func shouldRun(t model.ScanTask, now time.Time) bool {
	sched := strings.TrimSpace(t.Schedule)

	mu.Lock()
	last, seen := lastRun[t.ID]
	if !seen {
		// 首次见到该任务：以当前为基准登记，本轮不立即触发（避免重启即扫描风暴）
		lastRun[t.ID] = now
		mu.Unlock()
		return false
	}
	mu.Unlock()

	switch {
	case strings.HasPrefix(sched, "@every "):
		d, err := time.ParseDuration(strings.TrimSpace(strings.TrimPrefix(sched, "@every ")))
		if err != nil || d < time.Minute {
			return false
		}
		return now.Sub(last) >= d

	case strings.HasPrefix(sched, "daily:"):
		parts := strings.Split(strings.TrimPrefix(sched, "daily:"), ":")
		if len(parts) != 2 {
			return false
		}
		hh, errH := strconv.Atoi(strings.TrimSpace(parts[0]))
		mm, errM := strconv.Atoi(strings.TrimSpace(parts[1]))
		if errH != nil || errM != nil {
			return false
		}
		if now.Hour() == hh && now.Minute() == mm {
			// 同一分钟内（轮询会命中多次）只触发一次
			return now.Sub(last) >= 90*time.Second
		}
		return false
	}
	return false
}
