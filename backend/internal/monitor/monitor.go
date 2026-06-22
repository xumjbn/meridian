package monitor

import (
	"log"
	"net"
	"strconv"
	"sync"
	"time"

	"backend/internal/model"
	"backend/internal/notifier"
	"gorm.io/gorm"
)

// ==========================================
// 资产可用性监控 — 定时探测、记录历史、离线告警
// ==========================================

var (
	db      *gorm.DB
	lastRun time.Time
	stopCh  chan struct{}
)

const tickInterval = 30 * time.Second

var probePorts = []string{"22", "23", "80", "443", "8080", "3389"}

// Start 启动后台可用性监控循环（是否真正探测由 monitor_enabled 设置控制）
func Start(database *gorm.DB) {
	db = database
	stopCh = make(chan struct{})
	go loop()
	log.Printf("Monitor: availability monitor started (gated by monitor_enabled)")
}

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
		case <-ticker.C:
			cycle()
		}
	}
}

func settingValue(key, def string) string {
	var s model.SystemSetting
	if err := db.First(&s, "key = ?", key).Error; err == nil && s.Value != "" {
		return s.Value
	}
	return def
}

// cycle 按配置的间隔触发一轮探测
func cycle() {
	if settingValue("monitor_enabled", "false") != "true" {
		return
	}
	interval := 5
	if n, err := strconv.Atoi(settingValue("monitor_interval", "5")); err == nil && n > 0 {
		interval = n
	}
	if !lastRun.IsZero() && time.Since(lastRun) < time.Duration(interval)*time.Minute {
		return
	}
	lastRun = time.Now()
	runChecks()
}

type checkResult struct {
	asset  model.Asset
	status string
}

// runChecks 并发探测所有资产，串行写库（避免 SQLite 并发写锁冲突）
func runChecks() {
	var assets []model.Asset
	if err := db.Find(&assets).Error; err != nil || len(assets) == 0 {
		return
	}

	limit := 50
	if len(assets) < limit {
		limit = len(assets)
	}
	sem := make(chan struct{}, limit)
	var wg sync.WaitGroup
	results := make(chan checkResult, len(assets))

	for _, a := range assets {
		wg.Add(1)
		go func(a model.Asset) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			online := false
			for _, p := range probePorts {
				conn, err := net.DialTimeout("tcp", net.JoinHostPort(a.IP, p), 2*time.Second)
				if err == nil {
					conn.Close()
					online = true
					break
				}
			}
			status := "offline"
			if online {
				status = "online"
			}
			results <- checkResult{asset: a, status: status}
		}(a)
	}
	wg.Wait()
	close(results)

	now := time.Now()
	for r := range results {
		db.Create(&model.AssetCheck{AssetID: r.asset.ID, Status: r.status, CheckedAt: now})

		if r.asset.Status != r.status {
			db.Model(&model.Asset{}).Where("id = ?", r.asset.ID).
				Updates(map[string]interface{}{"status": r.status, "last_scanned_at": &now})
			// 仅在 online<->offline 之间切换时告警（unknown→online 等不算）
			if r.asset.Status == "online" && r.status == "offline" {
				go notifier.AssetStatusChanged(r.asset.Name, r.asset.IP, "offline")
			} else if r.asset.Status == "offline" && r.status == "online" {
				go notifier.AssetStatusChanged(r.asset.Name, r.asset.IP, "online")
			}
		} else {
			db.Model(&model.Asset{}).Where("id = ?", r.asset.ID).Update("last_scanned_at", &now)
		}
	}

	// 清理 30 天前历史，避免无限增长
	cutoff := now.Add(-30 * 24 * time.Hour)
	db.Where("checked_at < ?", cutoff).Delete(&model.AssetCheck{})
	log.Printf("Monitor: checked %d assets", len(assets))
}
