# 方案：Kubernetes 集群管理 + 扫描探测 + 一键控制台

> 分支：`feature/k8s-management` · 起草：2026-06-25 · 状态（起草时）：**Phase 1（MVP）已实现，待评审/测试**
>
> **本文性质**：这是 2026-06-25 的**历史计划快照**，记录当时的设计决策与分期设想，保留原貌。
> 后续实现已超出本计划（如「自动归类」「实时看板」），与代码不符之处已在正文用 `> 注（截至 v0.64）：…` 标注，
> 并在文末「§十一、实现状态（截至 v0.64）」统一对照当前 `backend/internal/handler/k8s.go` 等源码给出结论。
>
> 决策（起草时已拍板「按推荐来」）：①一键控制台走方案 A（复制密码+打开 VIP:443）；②集群人工建+人工归类；③worker(10250) 默认随开关探测；④控制台路径可配（默认 `/`）；⑤本期只做接入跳转，不做 kube API 实时看板（Phase 3 后续）。
> 目标应用：Lynx · 猞猁（网络资产发现与统一接入平台）

---

## 一、背景与目标

把 K8s 纳入「发现 → 测绘 → 接入」三段式：

1. **扫描可选探测 K8s**：自动发现任务里加一个开关，扫到的主机若是 K8s 节点（API Server / kubelet），自动打 `k8s` 标签并标记角色（control-plane / worker）。
2. **K8s 集群管理界面**：新页面 `/k8s`，把零散的 K8s 节点归类成「集群」，集群带 **VIP + 控制台端口（默认 443）+ 绑定凭据**。
3. **一键控制台**：在集群上点一下，用 `https://VIP:443` 跳到控制台登录，并带上绑定的密码。

---

## 二、总体方案（数据流）

```
扫描任务(detect_k8s=on)
   │  探测 6443/10250 + TLS 证书 SAN + /version
   ▼
资产打标：tags += "k8s"，k8s_role = control-plane | worker，os_version 记录 k8s 版本
   │
   ▼
/k8s 页面：未归类 K8s 节点  ──(用户归类)──►  K8sCluster(name, vip, 443, credential)
   │                                              │
   │  每个节点可一键开 WebSSH 终端                  ▼
   └───────────────────────────────►  「打开控制台」= 开 https://VIP:443 + 用绑定密码登录
```

> 注（截至 v0.64）：apiserver 探测端口除标准 `6443` 外，还纳入了非标 `2070`（见 §四 / §十一）；
> 并新增了「自动归类」路径——读节点 `/etc/hosts` 的 `cluster-vip` 标记按 VIP 自动建/并集群，不再只有人工归类。

要点：
- **探测/打标是自动的**；**「集群」是用户手动建的归类单元**（VIP + 凭据靠扫描无法可靠推断，见 §8）。
- 节点复用现有 `Asset`（已带多租户、终端、SFTP、凭据），只加两个字段；集群是新实体。

---

## 三、数据模型

### 3.1 新增实体 `K8sCluster`（owner 隔离）

```go
type K8sCluster struct {
    ID          uint   `gorm:"primaryKey" json:"id"`
    OwnerID     uint   `gorm:"index" json:"owner_id"`        // 多租户隔离
    Name        string `gorm:"size:120" json:"name"`
    VIP         string `gorm:"size:100" json:"vip"`          // 控制台/控制平面虚拟 IP
    ConsolePort int    `gorm:"default:443" json:"console_port"`
    ConsolePath string `gorm:"size:200" json:"console_path"` // 如 "/#/login"、"/dashboard/"，默认 "/"
    APIServer   string `gorm:"size:120" json:"api_server"`   // 可选，默认 VIP:6443
    CredentialID *uint `json:"credential_id"`                // 绑定的控制台登录凭据（账号/密码）
    Description string `gorm:"type:text" json:"description"`
    CreatedAt   time.Time `json:"created_at"`
    UpdatedAt   time.Time `json:"updated_at"`
    // 非持久化展示字段
    NodeCount   int    `gorm:"-" json:"node_count"`
    MasterCount int    `gorm:"-" json:"master_count"`
    OwnerName   string `gorm:"-" json:"owner_name"`
}
```

> 注（截至 v0.64）：实体已落地，但比上面起草版**多了几个字段**：
> 持久化字段新增 `APIToken string \`gorm:"type:text" json:"-"\``（ServiceAccount Bearer Token，Phase 3 实时看板用，**不回传前端**）；
> 展示字段新增 `CredName`（绑定凭据名）、`Online bool`（VIP:console_port TCP 连通性）、`HasToken bool`（是否已配 Token）。
> 详见 `backend/internal/model/models.go` 的 `K8sCluster`。

### 3.2 `Asset` 扩展两个字段

```go
K8sRole      string `gorm:"size:20;index" json:"k8s_role"`   // "" | control-plane | worker
K8sClusterID *uint  `gorm:"index" json:"k8s_cluster_id"`     // 归属集群（可空=未归类）
```

- AutoMigrate 增 `K8sCluster` 表 + Asset 两列（GORM 自动加列，无损）。
- 删除集群时把其节点 `k8s_cluster_id` 置空（解引用），节点资产本身保留。

> 注（截至 v0.64）：以上两字段与落地代码完全一致。

---

## 四、扫描时 K8s 探测

### 4.1 任务开关
`ScanTask` 增字段：
```go
DetectK8s bool `gorm:"default:false" json:"detect_k8s"`
```
- 前端「自动发现」新建/编辑任务表单加一个 Checkbox「探测 Kubernetes 节点」。
- `runDiscoveryScan` 里：`detect_k8s=true` 时，把 `6443`（API Server）和 `10250`（kubelet）并入探测端口集合（去重）。

> 注（截至 v0.64）：字段已落地。实际并入端口为 **`6443, 2070, 10250`**——非标 `2070` 作为 apiserver 候选端口（`k8sAPIPorts = []int{6443, 2070}`）。见 `scanner.go`。

### 4.2 判定逻辑（强信号优先，降低误报）
对开放 `6443` 的主机做 `probeK8sAPIServer(ip)`：
1. **TLS 证书 SAN（最可靠）**：`tls.Dial(ip:6443, InsecureSkipVerify)`，读对端证书 `DNSNames`，命中 `kubernetes` / `kubernetes.default` / `kubernetes.default.svc(.cluster.local)` → 判定 **control-plane**。
2. **HTTP /version 兜底**：`GET https://ip:6443/version`（跳过校验）：
   - 匿名放行 → 200 + `{"gitVersion":"v1.28.x",...}` → 取版本写入 `os_version`。
   - 匿名拒绝（常见）→ 401/403 + `{"kind":"Status","apiVersion":"v1",...}` → 这套 Status JSON 形状即 K8s 强信号。
3. 仅开放 `10250`（无 6443）→ `probeKubelet`：TLS + `GET /healthz`（多为 401，但 10250+TLS 证书由集群 CA 签发是较弱信号）→ 判定 **worker**（默认开启但标注「弱判定」，可在设置关）。

命中后在 `saveSingleAsset` 写入：`tags += "k8s"`（自动注册全局标签）、`K8sRole`、`os_version`（含 K8s 版本时）。

> 注（截至 v0.64）：判定逻辑按此实现，函数名落地为 `probeK8s` / `isK8sAPIServer` / `tryReadK8sVersion` / `isKubelet`。
> apiserver 候选端口为 `6443` 与 `2070`（两者都走「TLS SAN 优先、/version 兜底」）。
> `k8s` 标签自动注册并固定颜色 `#326ce5`。**worker 弱判定开关（系统设置项）未实现**——10250 探测随 `detect_k8s` 开关一并生效，无单独开关。

### 4.3 探测产物
扫描只负责**打标 + 角色 + 版本**，不自动建集群（VIP/凭据需人工）。打了标的节点出现在 `/k8s` 的「未归类 K8s 节点」区，等待归类。

> 注（截至 v0.64）：另外，扫描会**主动排除已知集群 VIP**（`loadClusterVIPs` 从待扫列表剔除 VIP），避免 VIP 代答端口生成「幽灵主机」资产。这点起草时未写明。

---

## 五、后端 API（owner 隔离 + 审计）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/k8s/clusters` | 集群列表（含节点数/master 数） |
| POST | `/api/k8s/clusters` | 新建集群 `{name, vip, console_port, console_path, credential_id, description}` |
| GET | `/api/k8s/clusters/:id` | 集群详情 + 节点列表 |
| PUT | `/api/k8s/clusters/:id` | 编辑 |
| DELETE | `/api/k8s/clusters/:id` | 删除（节点解引用） |
| POST | `/api/k8s/clusters/:id/nodes` | 归类节点 `{asset_ids:[], role?}` |
| DELETE | `/api/k8s/clusters/:id/nodes/:assetId` | 移出节点 |
| GET | `/api/k8s/nodes/unassigned` | 未归类的 `k8s` 标签资产 |
| GET | `/api/k8s/clusters/:id/console` | 返回 `{url, username, password}` 供前端「复制密码+打开」，并写审计 `K8S_CONSOLE` |

> 扫描相关：`ScanTask.detect_k8s` 经 Create/Update 自动绑定；scanner 读取并探测。

> 注（截至 v0.64）：上表全部落地。**实际还多了三组接口**（计划起草时归为 Phase 3 后续，后已实现）：
> - `POST /api/k8s/auto-classify` —— 自动归类（读节点 `/etc/hosts` 的 `cluster-vip` 标记按 VIP 建/并集群）；
> - `GET /api/k8s/clusters/:id/overview` —— 实时概览（节点就绪/总、Pod 运行/总、版本）；
> - `GET /api/k8s/clusters/:id/live/nodes`、`/live/pods` —— 实时节点 / Pod 列表（`pods` 支持 `?namespace=`）。
> 详见 `backend/cmd/server/main.go` 路由与 `handler/k8s.go`。请求体里 `POST /k8s/clusters` 还接受可选 `api_server` / `api_token`。

---

## 六、前端：Kubernetes 集群管理页 `/k8s`

路由/菜单按现有模式接入（`App.tsx` 加 lazy page + navItem「Kubernetes 集群」+ 管理员 gating + `<Route>`）。图标用 `CloudServerOutlined`。

> 注（截至 v0.64）：页面已落地于 `frontend/src/pages/K8sClusters.tsx`，挂在侧边栏「资产中心」分组下。
> **未做「管理员 gating」**——`/k8s` 不在 `App.tsx` 的 `adminOnlyKeys` 里，**对所有登录用户可见**（仍按 `owner_id` 隔离数据）。

### 6.1 页面布局（ASCII 原型）

```
┌ Kubernetes 集群 ───────────────[自动归类][刷新][新建集群]┐
│                                                          │
│  ┌─ 集群卡片 ───────────────────────────────────────┐   │
│  │ ⎈ prod-cluster        VIP 10.0.0.250  ● 在线        │  │
│  │ 节点 5（master 3 / worker 2）  凭据: k8s-admin       │  │
│  │ [打开控制台 ↗] [节点/看板] [编辑] [删除]             │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌─ 集群卡片 ───────────────────────────────────────┐    │
│  │ ⎈ test-cluster        VIP 10.0.1.10   ● 在线        │  │
│  │ ...                                                 │  │
│  └────────────────────────────────────────────────────┘  │
│                                                            │
│  ▾ 未归类 K8s 节点 (3)                       [归类到集群]   │
│  ┌──────────────────────────────────────────────────┐    │
│  │ □ 192.168.1.11  control-plane  v1.28.2  ● 在线  [终端]│ │
│  │ □ 192.168.1.12  worker         v1.28.2  ● 在线  [终端]│ │
│  └──────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────┘
```

> 注（截至 v0.64）：头部除「刷新 / 新建集群」外，多了「自动归类」按钮；卡片显示在线/离线（TCP 探测 VIP:console_port）；
> 已配 API Token 的集群「节点」按钮显示为「节点 / 看板」。

### 6.2 集群详情抽屉（点「节点」）
- 节点表：IP / 角色（master/worker）/ K8s 版本 / 状态 / 操作（**终端**＝复用 `openTerminal`、SFTP、移出集群）。
- 顶部：VIP、控制台地址、绑定凭据、`[打开控制台]`。

> 注（截至 v0.64）：抽屉据 `has_token` 增加「实时节点 / Pod / 归类节点」Tabs + 概览统计（Phase 3 已实现，见 §九）。

### 6.3 交互
- **新建/编辑集群**：Modal 填 name / VIP / 控制台端口(默认 443) / 控制台路径 / 选绑定凭据（复用凭据保管箱下拉）/ 描述。
- **归类节点**：在「未归类」勾选 → 选目标集群 + 角色 → 提交。
- **打开控制台**：见 §7。
- **节点终端**：直接复用现有一键 WebSSH。

> 注（截至 v0.64）：新建/编辑 Modal 还多了「API Server（可选）」「API Token（实时看板用）」两项；
> 控制台路径支持 `{username}`/`{password}` 占位符（命中即真·一键免登）。

---

## 七、VIP:443 一键跳转登录 + 绑定密码（核心，含取舍）

**关键事实**：浏览器同源策略下，前端**无法跨域自动填充** K8s 控制台（VIP:443，另一个源）的登录表单。所以「直接跳转登录 + 用绑定密码」有三条现实路径：

| 方案 | 做法 | 体验 | 可行性/成本 |
|------|------|------|------------|
| **A 复制+打开（推荐 v1）** | 点击→`GET /console` 取 `{url,username,password}`→**自动复制密码到剪贴板** + 新标签打开 `https://VIP:443{path}`，toast「密码已复制，粘贴即登录」 | 一键、一次粘贴 | 低、稳、通用，任何控制台都行 |
| **B 后端反代自动登录（v2）** | 后端按「控制台类型」（k8s-dashboard / Rancher / KubeSphere）走对应登录 API，用绑定凭据拿到会话 Cookie/Token，再把已登录会话交给浏览器 | 真·免登 | 高、脆（每种控制台登录流不同），需加 `console_type` 字段逐个适配 |
| **C basic-auth URL** | 打开 `https://user:pass@VIP:443` | 取决于站点 | 现代浏览器多已弃用/拦截密码段，不稳，**不推荐** |

**推荐**：**v1 走 A**（稳、通用、立刻可用），把「控制台类型 + 自动登录」作为 **v2** 对少数主流控制台做反代免登。`/console` 端点返回密码这一步全程审计（`K8S_CONSOLE`）。

> 若你的控制台支持 URL 传 token（个别自研/Rancher SSO），可在集群里配 `console_path` 模板（如 `/login?token={password}`），A 方案即可变成真·免登——这点做成可配置。

> 注（截至 v0.64）：方案 A 已落地（无占位符时复制密码 + 新标签打开）。
> 文末提到的「`console_path` 占位符模板」也已落地——`{username}`/`{password}` 会被绑定凭据替换后直接打开 URL，实现真·一键免登。
> 方案 B（按控制台类型后端反代免登）**未实现**，无 `console_type` 字段。

---

## 八、技术细节与坑

- **TLS 自签**：探测与控制台都用 `InsecureSkipVerify`（与项目现有 `InsecureIgnoreHostKey` 取舍一致）。
- **探测误报**：以**证书 SAN**为主信号，`/version` 的 Status JSON 为辅，显著降低 6443 上跑别的服务被误判的概率。
- **worker 判定较弱**：10250 多需鉴权，仅作 best-effort；可在系统设置加「弱判定开关」。
- **VIP ≠ 节点 IP**：HA 集群 VIP 是控制平面/LB 前端，可能不在扫描结果里，因此 VIP 作为集群独立字段、人工填。
- **控制台形态各异**：k8s Dashboard / Rancher / KubeSphere / 自研，路径各不同 → `console_path` 可配。
- **多租户**：`K8sCluster.owner_id` 隔离；节点（Asset）本就 owner 隔离；`canAccess` 校验；普通用户只见自己的集群。
- **审计**：建/删集群、归类、打开控制台（取密码）全部入审计。
- **凭据复用**：控制台登录凭据复用现有 `Credential`（明文存储，沿用现有安全取舍）。

> 注（截至 v0.64）：「worker 弱判定开关（系统设置）」**未做**（10250 随 detect_k8s 开关生效）。
> 审计动作落地为 `K8S_ASSIGN`（归类）/ `K8S_AUTOCLASSIFY`（自动归类）/ `K8S_CONSOLE`（控制台取密码）/ `K8S_API`（拉实时看板）。
> 另：新建/编辑集群时若选了**他人凭据会被拒**（`assertCredentialOwned`，403），防止跨租户经控制台泄露密码——这点起草时未写。

---

## 九、实施分期与工作量（粗估）

**Phase 1（MVP，建议先做）**
- 后端：`K8sCluster` 模型 + AutoMigrate + Asset 两字段；`ScanTask.detect_k8s`；scanner 6443 探测+打标+角色+版本；集群 CRUD + 节点归类 + `/console` 端点 + 审计。
- 前端：`/k8s` 页（集群卡片 + 未归类节点 + 归类 + 新建/编辑 Modal + 节点抽屉 + 一键终端）；方案 A 一键控制台；任务表单加 `探测 K8s` 开关。
- 文档/版本：docs 同步 + 版本号 +0.01。
- 量级：后端 ~1 文件新增(handler/k8s.go) + 模型/扫描小改；前端 1 个新页 + api.ts。约中等。

**Phase 2（增强）**
- [x] **集群健康探测**：列表/详情并发探测 VIP:console_port 连通性，卡片显示在线/离线。
- [x] **`console_path` 模板化免登**：路径支持 `{username}`/`{password}` 占位符；命中即用绑定凭据拼 URL 真·一键免登，否则回退「复制密码+打开」。
- [ ] worker(10250) 探测开关（系统设置）。
- [ ] 控制台 `console_type` + 后端反代免登（k8s Dashboard token / Rancher / KubeSphere，逐个适配）。

**Phase 3（深度）— 已实现实时看板**
- [x] 集群绑定 **ServiceAccount Bearer Token**（`K8sCluster.APIToken`，`json:"-"` 不回传前端）；
- [x] 后端调 kube-apiserver（Token 仅服务端用）：`/overview`、`/live/nodes`、`/live/pods`；
- [x] 前端集群抽屉加「实时节点 / Pod / 归类节点」Tabs + 概览统计（节点就绪/总、Pod 运行/总、版本）。
- [ ] 后续可扩展：Deployment/Service 视图、namespace 过滤、在线 `kubectl`/exec。

> 注（截至 v0.64）：计划外**额外落地**了「自动归类」（`POST /k8s/auto-classify`）——读各 K8s 节点 `/etc/hosts` 的 `cluster-vip` 标记，按 (owner, VIP) 建/并集群（控制台路径默认 `/uc`）。这不在原计划三个 Phase 内。

---

## 十、待确认问题（评审请拍板）

1. **一键控制台**：v1 用「复制密码+打开新标签」可接受吗？还是首版就要对某个具体控制台（哪个？k8s Dashboard / Rancher / KubeSphere）做后端反代免登？
2. **集群归类**：确认「人工建集群 + 人工归类节点」即可？（自动从扫描推断集群成员不可靠）
3. **worker 节点探测**（10250 弱判定）：要不要默认开？
4. **控制台地址**：默认 `https://VIP:443/`，路径是否需要按控制台类型预置模板？
5. 是否需要 Phase 3 的「调用 kube API 拉实时节点/Pod 看板」，还是仅做「接入跳转」？

> 注（截至 v0.64）回填：①控制台首版用方案 A，后补「占位符模板免登」；反代免登仍未做。
> ②除人工归类外，另做了「读 /etc/hosts cluster-vip 自动归类」。③worker 10250 随开关探测，未加独立设置开关。
> ④控制台路径可配 + 支持占位符模板。⑤Phase 3 实时看板已实现（需绑定 ServiceAccount Token）。

---

## 十一、实现状态（截至 v0.64）

> 对照 `backend/internal/handler/k8s.go`、`backend/internal/model/models.go`、`backend/cmd/server/main.go`、
> `backend/internal/scanner/scanner.go`、`frontend/src/pages/K8sClusters.tsx` 的现状结论。

### 已实现 ✅
- **数据模型**：`K8sCluster`（含计划外的 `api_token json:"-"`、展示字段 `cred_name`/`online`/`has_token`）；`Asset.k8s_role` / `k8s_cluster_id`；`ScanTask.detect_k8s`。
- **扫描探测**：`detect_k8s` 并入 `6443 + 2070 + 10250`；control-plane 走 TLS SAN + `/version`，worker 走 10250 弱判定；打 `k8s` 标签（`#326ce5`）、写角色与版本；**排除已知集群 VIP**。
- **集群 CRUD**：列表（含节点数/master 数/在线态）、详情+节点、新建、编辑、删除（节点解引用、资产保留）；owner 隔离 + 跨租户凭据防护（`assertCredentialOwned`）。
- **节点归类**：手动归类 `POST /k8s/clusters/:id/nodes`、移出 `DELETE .../nodes/:assetId`、未归类列表 `GET /k8s/nodes/unassigned`。
- **自动归类**（计划外）：`POST /k8s/auto-classify`——SSH 读节点 `/etc/hosts` 的 `cluster-vip` 标记，按 VIP 建/并集群（路径默认 `/uc`）。
- **一键控制台**：`GET /k8s/clusters/:id/console` 返回 `{url,username,password}` + 审计 `K8S_CONSOLE`；前端方案 A（复制密码+打开）+ `console_path` 占位符 `{username}/{password}` 真·一键免登。
- **集群在线探测**：列表/详情并发 TCP 探测 `VIP:console_port`，卡片显示在线/离线。
- **实时看板（Phase 3）**：需绑定 `api_token`（ServiceAccount Bearer Token，不回前端）；`GET /overview`（节点就绪/总、Pod 运行/总、版本，审计 `K8S_API`）、`/live/nodes`、`/live/pods`（支持 `?namespace=`）；前端抽屉 Tabs + 概览统计。
- **前端页面**：`/k8s` 挂「资产中心」分组，集群卡片 + 未归类节点表 + 归类 + 新建/编辑 Modal + 节点/看板抽屉 + 一键终端 + 自动归类按钮。

### 未实现 ❌（规划中）
- **方案 B 反代免登**：按控制台类型（k8s Dashboard / Rancher / KubeSphere）后端走登录 API 拿会话——无 `console_type` 字段，未做。
- **worker 弱判定独立开关**（系统设置项）：10250 探测随 `detect_k8s` 一并生效，无单独开关。
- **看板深化**：Deployment / Service 视图、namespace 过滤面板、在线 `kubectl` / exec。

### 与原计划的偏差小结
- apiserver 端口：计划写 `6443`，实际 `6443 + 非标 2070`。
- 归类方式：计划仅「人工」，实际增加「读 /etc/hosts 自动归类」。
- 前端权限：计划写「管理员 gating」，实际**对所有登录用户可见**（数据仍按 owner 隔离）。
- 实时看板：计划列为「Phase 3 后续」，实际已落地。
