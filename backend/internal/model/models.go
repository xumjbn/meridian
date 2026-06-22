package model

import (
	"time"
)

// User 代表平台登录账户（用于后台管理系统的认证与授权）
type User struct {
	ID                 uint       `gorm:"primaryKey" json:"id"`
	Username           string     `gorm:"size:50;not null;uniqueIndex" json:"username"`
	Password           string     `gorm:"size:255;not null" json:"-"`             // bcrypt 哈希，绝不随接口返回
	Role               string     `gorm:"size:20;default:'user'" json:"role"`     // admin | user
	Status             string     `gorm:"size:20;default:'active'" json:"status"` // active | disabled
	MustChangePassword bool       `gorm:"default:false" json:"must_change_password"` // 首次登录须改密（默认账号）
	LastLoginAt        *time.Time `json:"last_login_at"`                          // 上次成功登录时间
	LastLoginIP        string     `gorm:"size:50" json:"last_login_ip"`           // 上次登录来源 IP
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

// AssetCheck 记录一次资产可用性探测结果（用于在线率统计与离线告警）
type AssetCheck struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AssetID   uint      `gorm:"index" json:"asset_id"`
	Status    string    `gorm:"size:20" json:"status"` // online | offline
	CheckedAt time.Time `gorm:"index" json:"checked_at"`
}

// AuditLog 记录每一次状态变更请求（谁、何时、做了什么、从哪、结果如何）
type AuditLog struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Actor     string    `gorm:"size:50;index" json:"actor"`   // 操作用户名（未登录为空）
	Action    string    `gorm:"size:10" json:"action"`        // HTTP 方法: POST / PUT / DELETE
	Path      string    `gorm:"size:200" json:"path"`         // 请求路径
	Status    int       `json:"status"`                       // 业务返回 code（200 成功，4xx 失败）
	IP        string    `gorm:"size:50" json:"ip"`            // 客户端 IP
	CreatedAt time.Time `gorm:"index" json:"created_at"`
}

// Asset 代表资产 (服务器/交换机/路由器等)
type Asset struct {
	ID            uint       `gorm:"primaryKey" json:"id"`
	OwnerID       uint       `gorm:"index" json:"owner_id"` // 归属用户ID（数据隔离：user 仅可见自己的）
	Name          string     `gorm:"size:100;not null" json:"name"`
	IP            string     `gorm:"size:50;not null;uniqueIndex" json:"ip"`
	Type          string     `gorm:"size:20;default:'other'" json:"type"` // server, switch, router, other
	Status        string     `gorm:"size:20;default:'unknown'" json:"status"` // online, offline, unknown
	Vendor        string     `gorm:"size:100" json:"vendor"` // Cisco, Huawei, Dell, Ubuntu等
	OSVersion     string     `gorm:"size:100" json:"os_version"`
	Arch          string     `gorm:"size:30" json:"arch"` // CPU 架构: x86_64 / aarch64 / armv7l（需认证采集）
	Virtualization string    `gorm:"size:30" json:"virtualization"` // 虚拟化: physical / vmware / kvm / hyper-v / xen / qemu / aws / container:* …（需认证采集）
	Ports         string     `gorm:"type:text" json:"ports"` // JSON 字符串数组，如 "[22, 80]"
	Tags          string     `gorm:"type:text" json:"tags"`  // JSON 字符串数组，如 ["生产","DMZ"]
	Description   string     `gorm:"type:text" json:"description"`
	CredentialID  *uint      `json:"credential_id"` // 关联凭证ID
	LastScannedAt *time.Time `json:"last_scanned_at"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	OwnerName     string     `gorm:"-" json:"owner_name"` // 非持久化：归属用户名（仅展示）
}

// Credential 代表登录凭证
type Credential struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	OwnerID    uint      `gorm:"index" json:"owner_id"` // 归属用户ID（数据隔离）
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
	Kind        string     `gorm:"size:20;default:'discovery'" json:"kind"`      // 扫描类型: discovery（端口发现） | vuln（nuclei 漏扫）
	Schedule    string     `gorm:"size:50" json:"schedule"`                      // 定时计划: "@every 1h" | "daily:HH:MM"
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

// SystemSetting 系统配置项 (key-value)
type SystemSetting struct {
	Key       string    `gorm:"primaryKey;size:100" json:"key"`
	Value     string    `gorm:"type:text" json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

// AssetHistory 资产字段变更历史
type AssetHistory struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AssetID   uint      `gorm:"index" json:"asset_id"`
	Field     string    `gorm:"size:50" json:"field"`
	OldValue  string    `gorm:"type:text" json:"old_value"`
	NewValue  string    `gorm:"type:text" json:"new_value"`
	CreatedAt time.Time `json:"created_at"`
}

// VulnFinding 漏洞扫描发现项（由 nuclei 引擎产生）
type VulnFinding struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	AssetID    uint      `gorm:"index" json:"asset_id"` // 关联资产（可能为 0：扫描目标未在 CMDB 中）
	Target     string    `gorm:"size:100;index" json:"target"`
	TemplateID string    `gorm:"size:200" json:"template_id"`
	Name       string    `gorm:"size:255" json:"name"`
	Severity   string    `gorm:"size:20" json:"severity"` // info | low | medium | high | critical
	MatchedAt  string    `gorm:"size:255" json:"matched_at"`
	Engine     string    `gorm:"size:30" json:"engine"` // nuclei
	CreatedAt  time.Time `json:"created_at"`
}

// Tag 代表全局资产标签
type Tag struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Name      string    `gorm:"size:50;not null;uniqueIndex" json:"name"`
	Color     string    `gorm:"size:20;default:'#1890ff'" json:"color"` // 预设 AntD 默认蓝色
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

