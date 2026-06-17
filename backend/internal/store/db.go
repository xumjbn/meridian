package store

import (
	"log"
	"os"
	"path/filepath"

	"backend/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.Model

// Wait, the type of DB should be *gorm.DB, not *gorm.Model! 
// Let's declare it as var DB *gorm.DB.

var GlobalDB *gorm.DB

func InitDB() *gorm.DB {
	dbFile := "assets.db"
	dbPath := dbFile + "?_busy_timeout=5000"
	
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
	)
	if err != nil {
		log.Fatalf("failed to migrate database: %v", err)
	}

	GlobalDB = db
	return db
}
