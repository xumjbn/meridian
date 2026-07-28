package store

import (
	"log"

	"backend/internal/crypto"
	"os"
	"path/filepath"

	"backend/internal/model"
	"github.com/glebarez/sqlite" // 纯 Go SQLite 驱动（无需 cgo / gcc）
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var GlobalDB *gorm.DB

// dbPath 返回数据库文件路径（不含 pragma 参数），供密钥文件定位等复用
func dbPath() string {
	f := os.Getenv("LYNX_DB")
	if f == "" {
		f = os.Getenv("MERIDIAN_DB")
	}
	if f == "" {
		f = "assets.db"
	}
	return f
}

func InitDB() *gorm.DB {
	// 数据库文件路径可由 LYNX_DB 覆盖（容器部署时指向挂载卷，如 /data/assets.db）
	// 兼容旧名 MERIDIAN_DB：已在编排/服务里配置过旧变量的部署无需改动即可继续运行。
	dbFile := os.Getenv("LYNX_DB")
	if dbFile == "" {
		dbFile = os.Getenv("MERIDIAN_DB")
	}
	if dbFile == "" {
		dbFile = "assets.db"
	}
	// 纯 Go 驱动（modernc）使用 _pragma 语法设置 busy_timeout
	dbPath := dbFile + "?_pragma=busy_timeout(5000)"

	// 确保目录存在
	dir := filepath.Dir(dbFile)
	if dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			log.Fatalf("failed to create db dir: %v", err)
		}
	}

	// 加密密钥文件与库文件同目录存放
	crypto.SetKeyDir(dir)

	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		log.Fatalf("failed to connect database: %v", err)
	}

	// 自动迁移表结构
	err = db.AutoMigrate(
		&model.User{},
		&model.AuditLog{},
		&model.AssetCheck{},
		&model.Asset{},
		&model.Credential{},
		&model.ScanTask{},
		&model.ScanLog{},
		&model.ActivityLog{},
		&model.SystemSetting{},
		&model.VulnFinding{},
		&model.AssetHistory{},
		&model.Tag{},
		&model.AgentSession{},
		&model.K8sCluster{},
	)
	if err != nil {
		log.Fatalf("failed to migrate database: %v", err)
	}

	GlobalDB = db
	encryptLegacyCredentials(db)
	seedDefaultSettings(db)
	seedDefaultUser(db)
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
		"notify_type":       "none",  // 告警渠道: none | wecom | dingtalk | webhook
		"notify_url":        "",      // Webhook 地址
		"notify_on_scan":    "true",  // 扫描任务完成/失败时通知
		"notify_on_offline": "true",  // 资产离线/恢复时通知
		"monitor_enabled":   "false", // 是否开启资产可用性定时监控
		"monitor_interval":  "5",     // 监控探测间隔（分钟）
		"ai_enabled":        "false", // AI 命令助手开关
		"ai_base_url":       "",      // OpenAI 兼容接口地址，如 https://api.deepseek.com/v1
		"ai_api_key":        "",      // 模型 API Key
		"ai_model":          "",      // 模型名，如 deepseek-chat / moonshot-v1-8k
	}
	for k, v := range defaults {
		var count int64
		db.Model(&model.SystemSetting{}).Where("key = ?", k).Count(&count)
		if count == 0 {
			db.Create(&model.SystemSetting{Key: k, Value: v})
		}
	}
}

// ResetAdminPassword 把首个管理员账号的密码重置为 pw，并要求下次登录改密。
// 默认 admin/admin 首次登录强制改密，改完忘了此前没有任何找回路径。
func ResetAdminPassword(db *gorm.DB, pw string) error {
	var admin model.User
	if err := db.Where("role = ?", "admin").Order("id asc").First(&admin).Error; err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return db.Model(&admin).Updates(map[string]any{
		"password":             string(hash),
		"must_change_password": true,
		"status":               "active",
	}).Error
}

// seedDefaultUser 首次启动且 users 表为空时，依据旧版单账号配置
// （auth_username / auth_password，默认 admin/admin）创建首位管理员，
// 保证升级到多用户体系后历史账号仍可登录。
func seedDefaultUser(db *gorm.DB) {
	var count int64
	db.Model(&model.User{}).Count(&count)
	if count > 0 {
		return
	}
	username := settingValue(db, "auth_username", "admin")
	password := settingValue(db, "auth_password", "admin")
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("seedDefaultUser: 密码哈希失败: %v", err)
		return
	}
	admin := model.User{
		Username:           username,
		Password:           string(hash),
		Role:               "admin",
		Status:             "active",
		MustChangePassword: true, // 默认 admin/admin，首次登录强制改密
	}
	if err := db.Create(&admin).Error; err != nil {
		log.Printf("seedDefaultUser: 创建默认管理员失败: %v", err)
		return
	}
	log.Printf("已创建默认管理员账号: %s（请尽快登录后修改密码）", username)
}

// settingValue 读取系统配置项，缺省时返回 def
func settingValue(db *gorm.DB, key, def string) string {
	var s model.SystemSetting
	if err := db.First(&s, "key = ?", key).Error; err == nil && s.Value != "" {
		return s.Value
	}
	return def
}


// encryptLegacyCredentials 把历史遗留的明文凭据就地加密。
// AfterFind 会把无前缀的旧值原样返回，再次 Save 时 BeforeSave 就会加密，
// 因此这里只需读出后重新保存一遍即可完成迁移。
func encryptLegacyCredentials(db *gorm.DB) {
	var rows []model.Credential
	if err := db.Find(&rows).Error; err != nil {
		return
	}
	migrated := 0
	for i := range rows {
		c := &rows[i]
		// 判断落库原值是否已是密文：单独查一次原始列，避免被 AfterFind 解密干扰
		var raw struct {
			Password   string
			PrivateKey string
		}
		if db.Table("credentials").Select("password", "private_key").Where("id = ?", c.ID).Scan(&raw).Error != nil {
			continue
		}
		needs := (raw.Password != "" && !crypto.IsEncrypted(raw.Password)) ||
			(raw.PrivateKey != "" && !crypto.IsEncrypted(raw.PrivateKey))
		if !needs {
			continue
		}
		if err := db.Save(c).Error; err == nil {
			migrated++
		}
	}
	if migrated > 0 {
		log.Printf("已将 %d 条历史明文凭据加密入库", migrated)
	}
}
