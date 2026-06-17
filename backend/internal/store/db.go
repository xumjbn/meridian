package store

import (
	"log"
	"os"
	"path/filepath"

	"backend/internal/model"
	"github.com/glebarez/sqlite" // 纯 Go SQLite 驱动（无需 cgo / gcc）
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.Model

// Wait, the type of DB should be *gorm.DB, not *gorm.Model! 
// Let's declare it as var DB *gorm.DB.

var GlobalDB *gorm.DB

func InitDB() *gorm.DB {
	dbFile := "assets.db"
	// 纯 Go 驱动（modernc）使用 _pragma 语法设置 busy_timeout
	dbPath := dbFile + "?_pragma=busy_timeout(5000)"

	// 确保目录存在
	dir := filepath.Dir(dbFile)
	if dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			log.Fatalf("failed to create db dir: %v", err)
		}
	}

	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		log.Fatalf("failed to connect database: %v", err)
	}

	// 自动迁移表结构
	err = db.AutoMigrate(
		&model.Asset{},
		&model.Credential{},
		&model.ScanTask{},
		&model.ScanLog{},
		&model.ActivityLog{},
		&model.SystemSetting{},
		&model.VulnFinding{},
		&model.AssetHistory{},
	)
	if err != nil {
		log.Fatalf("failed to migrate database: %v", err)
	}

	GlobalDB = db
	seedDefaultSettings(db)
	return db
}

// seedDefaultSettings 首次启动时写入默认系统配置
func seedDefaultSettings(db *gorm.DB) {
	defaults := map[string]string{
		"scan_concurrency": "100",   // 最大并发连接数
		"scan_timeout":     "2",     // 端口探测超时（秒）
		"ssh_timeout":      "10",    // SSH 连接超时（秒）
		"auth_username":    "admin", // 登录用户名（默认 admin）
		"auth_password":    "admin", // 登录密码（默认 admin）
	}
	for k, v := range defaults {
		var count int64
		db.Model(&model.SystemSetting{}).Where("key = ?", k).Count(&count)
		if count == 0 {
			db.Create(&model.SystemSetting{Key: k, Value: v})
		}
	}
}
