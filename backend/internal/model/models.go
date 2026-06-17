package model

import (
	"time"
)

// Asset 代表资产 (服务器/交换机/路由器等)
type Asset struct {
	ID            uint       `gorm:"primaryKey" json:"id"`
	Name          string     `gorm:"size:100;not null" json:"name"`
	IP            string     `gorm:"size:50;not null;uniqueIndex" json:"ip"`
	Type          string     `gorm:"size:20;default:'other'" json:"type"` // server, switch, router, other
	Status        string     `gorm:"size:20;default:'unknown'" json:"status"` // online, offline, unknown
	Vendor        string     `gorm:"size:100" json:"vendor"` // Cisco, Huawei, Dell, Ubuntu等
	OSVersion     string     `gorm:"size:100" json:"os_version"`
	Ports         string     `gorm:"type:text" json:"ports"` // JSON 字符串数组，如 "[22, 80]"
	Tags          string     `gorm:"type:text" json:"tags"`  // JSON 字符串数组，如 ["生产","DMZ"]
	Description   string     `gorm:"type:text" json:"description"`
	CredentialID  *uint      `json:"credential_id"` // 关联凭证ID
	LastScannedAt *time.Time `json:"last_scanned_at"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// Credential 代表登录凭证
type Credential struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	Name       string    `gorm:"size:100;not null" json:"name"`
	Type       string    `gorm:"size:20;not null" json:"type"` // ssh_password, ssh_key, telnet
	Username   string    `gorm:"size:100" json:"username"`
	Password   string    `gorm:"type:text" json:"password"` // 明文密码 (按用户要求)
	PrivateKey string    `gorm:"type:text" json:"private_key"` // SSH 私钥
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// ScanTask 代表自动发现扫描任务
type ScanTask struct {
	ID          uint       `gorm:"primaryKey" json:"id"`
	Name        string     `gorm:"size:100;not null" json:"name"`
	TargetRange string     `gorm:"size:100;not null" json:"target_range"` // 192.168.1.0/24 或 192.168.1.1-192.168.1.100
	Ports       string     `gorm:"size:200;default:'22,23,80,443'" json:"ports"` // 逗号分隔的端口
	Schedule    string     `gorm:"size:50" json:"schedule"`                      // 可选 cron 表达式，如 "0 2 * * *"
	Status      string     `gorm:"size:20;default:'idle'" json:"status"` // idle, running, completed, failed
	LastRunAt   *time.Time `json:"last_run_at"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// ScanLog 代表扫描任务的运行日志
type ScanLog struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	TaskID     uint      `gorm:"not null;index" json:"task_id"`
	Status     string    `gorm:"size:20" json:"status"` // success, failed, running
	StartedAt  time.Time `json:"started_at"`
	FinishedAt time.Time `json:"finished_at"`
	Summary    string    `gorm:"type:text" json:"summary"` // 结果摘要
	Detail     string    `gorm:"type:text" json:"detail"`  // 详细控制台日志
}

// ActivityLog 记录系统操作活动
type ActivityLog struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Type      string    `gorm:"size:50;not null" json:"type"` // asset_created, asset_updated, asset_deleted, scan_started, scan_completed, scan_failed
	Message   string    `gorm:"type:text" json:"message"`
	RefID     uint      `json:"ref_id"` // 关联的资产或任务 ID
	CreatedAt time.Time `json:"created_at"`
}
