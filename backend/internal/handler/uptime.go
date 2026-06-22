package handler

import (
	"strconv"
	"time"

	"backend/internal/model"
	"backend/internal/store"
	"github.com/gin-gonic/gin"
)

// GetAssetUptime 返回某资产近 N 小时的可用性历史与在线率
func GetAssetUptime(c *gin.Context) {
	db := store.GlobalDB
	id, _ := strconv.Atoi(c.Param("id"))
	hours, _ := strconv.Atoi(c.DefaultQuery("hours", "24"))
	if hours <= 0 || hours > 720 {
		hours = 24
	}
	since := time.Now().Add(-time.Duration(hours) * time.Hour)

	var checks []model.AssetCheck
	db.Where("asset_id = ? AND checked_at >= ?", id, since).Order("checked_at asc").Find(&checks)

	total := len(checks)
	online := 0
	for _, ch := range checks {
		if ch.Status == "online" {
			online++
		}
	}
	uptime := 0.0
	if total > 0 {
		uptime = float64(online) / float64(total) * 100
	}

	SendSuccess(c, gin.H{
		"hours":          hours,
		"total":          total,
		"online":         online,
		"uptime_percent": uptime,
		"checks":         checks,
	})
}
