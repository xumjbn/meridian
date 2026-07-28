package model

import (
	"backend/internal/crypto"
	"gorm.io/gorm"
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
	SSHPort       int        `gorm:"default:22" json:"ssh_port"` // SSH/SFTP 连接端口（默认 22，支持非标端口）
	Vendor        string     `gorm:"size:100" json:"vendor"` // Cisco, Huawei, Dell, Ubuntu等
	OSVersion     string     `gorm:"size:100" json:"os_version"`
	Arch          string     `gorm:"size:30" json:"arch"` // CPU 架构: x86_64 / aarch64 / armv7l（需认证采集）
	Virtualization string    `gorm:"size:30" json:"virtualization"` // 虚拟化: physical / vmware / kvm / hyper-v / xen / qemu / aws / container:* …（需认证采集）
	Ports         string     `gorm:"type:text" json:"ports"` // JSON 字符串数组，如 "[22, 80]"
	Tags          string     `gorm:"type:text" json:"tags"`  // JSON 字符串数组，如 ["生产","DMZ"]
	Description   string     `gorm:"type:text" json:"description"`
	CredentialID  *uint      `json:"credential_id"` // 关联凭证ID
	K8sRole       string     `gorm:"size:20;index" json:"k8s_role"`     // "" | control-plane | worker（扫描探测得到）
	K8sClusterID  *uint      `gorm:"index" json:"k8s_cluster_id"`       // 归属 K8s 集群（可空=未归类）
	LastScannedAt *time.Time `json:"last_scanned_at"`

	// ── 资源用量（认证采集，兼容 Linux / macOS / Windows 目标机）──
	// 统一单位：CPU 为百分比，内存/磁盘为 KB；MetricsAt 为空表示尚未采集过。
	CPUPercent  float64    `json:"cpu_percent"`
	MemUsedKB   int64      `json:"mem_used_kb"`
	MemTotalKB  int64      `json:"mem_total_kb"`
	DiskUsedKB  int64      `json:"disk_used_kb"`
	DiskTotalKB int64      `json:"disk_total_kb"`
	MetricsOS   string     `gorm:"size:20" json:"metrics_os"` // Linux / Darwin / Windows
	MetricsAt   *time.Time `json:"metrics_at"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	OwnerName string    `gorm:"-" json:"owner_name"` // 非持久化：归属用户名（仅展示）
}

// ResolvedSSHPort 返回有效 SSH 端口（未设置时回退默认 22）
func (a *Asset) ResolvedSSHPort() int {
	if a.SSHPort > 0 {
		return a.SSHPort
	}
	return 22
}

// Credential 代表登录凭证
type Credential struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	OwnerID    uint      `gorm:"index" json:"owner_id"` // 归属用户ID（数据隔离）
	Name       string    `gorm:"size:100;not null" json:"name"`
	Type       string    `gorm:"size:20;not null" json:"type"` // ssh_password, ssh_key, telnet
	Username   string    `gorm:"size:100" json:"username"`
	// 密码与私钥落库前由 GORM 钩子加密（AES-256-GCM），读出时自动解密。
	// json 标签置为 "-"：秘密绝不随接口返回给前端，前端只凭 has_* 判断是否已配置。
	Password   string    `gorm:"type:text" json:"-"`
	PrivateKey string    `gorm:"type:text" json:"-"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`

	// 非持久化：仅用于前端展示「是否已配置密码/私钥」
	HasPassword   bool `gorm:"-" json:"has_password"`
	HasPrivateKey bool `gorm:"-" json:"has_private_key"`
}

// BeforeSave 落库前加密敏感字段
func (c *Credential) BeforeSave(tx *gorm.DB) error {
	enc, err := crypto.EncryptSecret(c.Password)
	if err != nil {
		return err
	}
	c.Password = enc
	enc, err = crypto.EncryptSecret(c.PrivateKey)
	if err != nil {
		return err
	}
	c.PrivateKey = enc
	return nil
}

// AfterFind 读出后解密，并回填 has_* 展示位。
// 历史明文数据没有密文前缀，会原样返回，保证升级后旧凭据仍可用。
func (c *Credential) AfterFind(tx *gorm.DB) error {
	c.Password = crypto.MustDecrypt(c.Password)
	c.PrivateKey = crypto.MustDecrypt(c.PrivateKey)
	c.HasPassword = c.Password != ""
	c.HasPrivateKey = c.PrivateKey != ""
	return nil
}

// ScanTask 代表自动发现扫描任务
type ScanTask struct {
	ID          uint       `gorm:"primaryKey" json:"id"`
	Name        string     `gorm:"size:100;not null" json:"name"`
	TargetRange string     `gorm:"size:100;not null" json:"target_range"` // 192.168.1.0/24 或 192.168.1.1-192.168.1.100
	Ports       string     `gorm:"size:200;default:'22,23,80,443'" json:"ports"` // 逗号分隔的端口
	Kind        string     `gorm:"size:20;default:'discovery'" json:"kind"`      // 扫描类型: discovery（端口发现） | vuln（nuclei 漏扫）
	DetectK8s   bool       `gorm:"default:false" json:"detect_k8s"`              // 是否探测 Kubernetes 节点（并入 6443/10250）
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

// AgentSession 持久化 AI Agent 会话（写穿缓存，服务重启不丢；也作为历史对话来源）
// AuthSession 登录会话。原先只放在进程内存里，而桌面端每次启动都会重新拉起
// 后端进程，于是上一轮的 token 必然失效——前端却还留着它，开机就是一屏
// 「获取数据失败」，必须登出再登录。落库后重启不掉线。
type AuthSession struct {
	Token     string    `gorm:"primaryKey;size:64" json:"-"`
	UserID    uint      `gorm:"index" json:"user_id"`
	Username  string    `gorm:"size:64" json:"username"`
	Role      string    `gorm:"size:32" json:"role"`
	ExpiresAt time.Time `gorm:"index" json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

type AgentSession struct {
	ID          string    `gorm:"primaryKey;size:64" json:"id"`
	RequesterID uint      `gorm:"index" json:"requester_id"`
	AssetID     uint      `gorm:"index" json:"asset_id"`
	AssetName   string    `gorm:"size:120" json:"asset_name"`
	Title       string    `gorm:"size:255" json:"title"` // 首条任务描述（截断）
	OSHint      string    `gorm:"size:255" json:"os_hint"`
	WorkDir     string    `gorm:"size:512" json:"work_dir"`
	Messages    string    `gorm:"type:text" json:"-"` // 完整对话历史 JSON
	Steps       string    `gorm:"type:text" json:"-"` // 执行步骤 JSON
	Status      string    `gorm:"size:20" json:"status"`
	Pending     string    `gorm:"type:text" json:"pending"`
	PendingNote string    `gorm:"type:text" json:"pending_note"`
	PendingWarn string    `gorm:"size:255" json:"pending_warning"`
	Summary     string    `gorm:"type:text" json:"summary"`
	LastErr     string    `gorm:"type:text" json:"error"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// K8sCluster 代表一个 Kubernetes 集群（用户手动建立的归类单元）
// 节点复用 Asset（通过 Asset.K8sClusterID 归属）；集群带 VIP + 控制台端口 + 绑定凭据用于一键登录
type K8sCluster struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	OwnerID      uint      `gorm:"index" json:"owner_id"` // 多租户隔离
	Name         string    `gorm:"size:120;not null" json:"name"`
	VIP          string    `gorm:"size:100" json:"vip"`           // 控制台/控制平面虚拟 IP
	ConsolePort  int       `gorm:"default:443" json:"console_port"`
	ConsolePath  string    `gorm:"size:200" json:"console_path"`  // 控制台路径，如 "/#/login"，默认 "/"
	APIServer    string    `gorm:"size:120" json:"api_server"`    // 可选，默认 VIP:6443
	APIToken     string    `gorm:"type:text" json:"-"`            // kube-apiserver ServiceAccount Bearer Token（不回传前端）
	CredentialID *uint     `json:"credential_id"`                 // 绑定的控制台登录凭据
	Description  string    `gorm:"type:text" json:"description"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`

	// ── 控制台指纹（由「探测控制台」写入，见 handler.probeConsole）──
	ConsoleKind      string     `gorm:"size:40" json:"console_kind"`     // uc / kubernetes-dashboard / rancher / web
	ConsoleTitle     string     `gorm:"size:200" json:"console_title"`   // 控制台页面标题
	ConsoleVersion   string     `gorm:"size:60" json:"console_version"`  // 识别到的版本号
	ConsoleCheckedAt *time.Time `json:"console_checked_at"`              // 最近一次探测时间

	// 非持久化展示字段
	NodeCount   int    `gorm:"-" json:"node_count"`
	MasterCount int    `gorm:"-" json:"master_count"`
	OwnerName   string `gorm:"-" json:"owner_name"`
	CredName    string `gorm:"-" json:"cred_name"`
	Online      bool   `gorm:"-" json:"online"`     // VIP:console_port 连通性（探测得到）
	HasToken    bool   `gorm:"-" json:"has_token"`  // 是否已配置 kube API Token
}

// BeforeSave 落库前加密 API Token。
// 这个 token 通常绑着一个能读全集群的 ServiceAccount，和 SSH 密码是同一量级的秘密，
// 之前却是明文落库——Credential 走了加密钩子，这里漏了。
func (c *K8sCluster) BeforeSave(tx *gorm.DB) error {
	enc, err := crypto.EncryptSecret(c.APIToken)
	if err != nil {
		return err
	}
	c.APIToken = enc
	return nil
}

// AfterFind 读出后解密。历史明文数据没有密文前缀，MustDecrypt 原样返回，
// 升级后旧集群的 token 照常能用，不需要用户重填。
func (c *K8sCluster) AfterFind(tx *gorm.DB) error {
	c.APIToken = crypto.MustDecrypt(c.APIToken)
	c.HasToken = c.APIToken != ""
	return nil
}

