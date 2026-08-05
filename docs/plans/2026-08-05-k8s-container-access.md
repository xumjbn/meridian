# 方案：K8s 容器级接入（P0 地基 + P1 exec / 日志）

> 起草：2026-08-05 · 状态：**待评审** · 目标版本：v1.1.0
>
> **与 [2026-06-25-k8s-cluster-management.md](2026-06-25-k8s-cluster-management.md) 的关系**：那份把 K8s 做到了
> 「发现 → 归类 → 只读看板 → 跳控制台」。本方案不重复其内容，只补它明确列为未做的部分，
> 并修复本次代码走查中实测到的地基问题。
>
> 本文所有「现状」结论均对照源码给出行号，未经复现的猜测不写入。

---

## 一、目标与非目标

### 目标

1. **把 K8s 并入产品主线「统一接入」**：现在只能 SSH 到*节点*、跳到*控制台*，**容器这一层进不去**。
   补上 `exec` 终端与实时日志流，复用已有的 xterm / WebSocket / 多标签分屏基础设施。
2. **降低接入门槛**：目前只认 ServiceAccount Bearer Token（`k8s.go:404`），
   client-cert 认证的集群**根本接不进来**。支持 kubeconfig 导入 + 连接自检。
3. **修掉地基硬伤**：静默失败、重复全量拉取、静默截断、串行 SSH、N+1（详见 §二）。

### 非目标（本期明确不做）

- 不引入 `client-go`。理由：依赖树与产物体积同「纯 Go / 免 cgo / 单二进制 sidecar」定位冲突。
  exec 用 `gorilla/websocket`（**已在依赖里**）作客户端手写 `v4.channel.k8s.io`；
  kubeconfig 用 `gopkg.in/yaml.v3`（**已在依赖树里，indirect → 提为 direct，无新增下载**）。
- 不做写操作（scale / delete / apply / rollout）。本期只到「进得去 + 看得见」。
- 不做 Deployment / Service / Ingress / Events 视图（列入 P2）。
- 不做多集群总览页（列入 P3）。

---

## 二、现状问题（实测清单）

| # | 问题 | 位置 | 后果 |
|---|------|------|------|
| 1 | **解析错误被吞**：`_ = json.Unmarshal(...)` | `k8s.go:427` `:477` `:511` | API 返回异常结构时前端显示「空列表」而非报错。同一份结构 `k8s_sync.go:72` 是检查了的，两套处理 |
| 2 | **开一次抽屉拉两次全量 Pod**：`overview` 拉 `?limit=2000`，`live/pods` 再拉 `?limit=500` | `k8s.go:503` / `k8s.go:463` | 抽屉打开触发 4 次 kube API 调用（`K8sClusters.tsx:173-175` 三个并行 + overview 内部串行两次），2000 Pod 集群单次十几 MB JSON |
| 3 | **overview 内部串行** nodes → pods | `k8s.go:502-503` | 延迟叠加 |
| 4 | **Pod 列表静默截断**：`limit=500` 不处理 `continue` | `k8s.go:463` | 600 个 Pod 只显示 500，界面无任何提示 |
| 5 | **自动归类串行 SSH**：逐节点 `cat /etc/hosts`，无并发/无单节点超时/无进度 | `k8s.go:620` | 几十节点必然把 HTTP 请求拖超时；且该规则（`/etc/hosts` 的 `cluster-vip` 标记）是站点特化约定 |
| 6 | **N+1 查询**：每个集群 2 次 COUNT + 1 次凭据查询 | `k8s.go:43-51` | 集群列表随集群数线性劣化 |
| 7 | **认证方式单一**：仅 Bearer Token | `k8s.go:338` `:404` | client-cert 集群接不进来；kubeconfig 用户需手工提取 token |
| 8 | **无连接自检** | — | Token / APIServer 填错要等打开看板才 502，无「测试连接」 |

> 注：`InsecureSkipVerify`（`k8s.go:343`）沿用项目既有取舍，本期不改默认行为。
> 但 kubeconfig 导入会顺带带来 CA 证书，因此**新增**一个可选项：填了 CA 就真校验（见 §4.1），默认仍不校验。

---

## 三、P0 · 地基修复

改动集中在 `handler/k8s.go`，无数据模型变更，可独立发布。

### 3.1 三处静默失败改为报错

`GetK8sLiveNodes` / `GetK8sLivePods` / `GetK8sOverview` 的 `json.Unmarshal` 一律检查，
失败返回 `502 + "解析 kube API 响应失败: ..."`，与 `k8s_sync.go:72` 对齐。

### 3.2 引入 kube API 短 TTL 缓存，消除重复拉取

```go
// 进程内缓存：key = clusterID + "|" + path，TTL 10s，RWMutex 保护
// 只缓存 GET 结果，集群编辑/同步后按 clusterID 主动失效
type kubeCacheEntry struct{ body []byte; code int; at time.Time }
```

- `overview` 不再自己拉 Pod 全量：改为与 `live/nodes`、`live/pods` **共享同一份缓存结果**。
  抽屉打开由「4 次调用 + 2 份全量 Pod」降为「2 次调用（nodes / pods）+ 复用」。
- `overview` 内部 nodes / pods 改为并发（`errgroup` 手写等价物即可，不引新依赖）。

### 3.3 Pod 分页与截断可见

- `kubeGet` 透传 `?limit=` 与 `continue`；`live/pods` 返回体由裸数组改为
  `{items: [...], continue: "...", truncated: bool, total_hint: n}`。
- 前端表格底部在 `truncated` 时显示「已截断，仅显示前 N 条，请用 namespace 过滤」。
- **不做静默上限**：这条是硬要求，宁可提示也不悄悄砍。

### 3.4 自动归类并发化 + 进度

- worker pool（并发 8，可配），单节点 SSH 超时 10s，整体超时 5min。
- 改为 SSE 推进度（复用扫描任务已有的 SSE 约定，`?token=` 鉴权），
  前端显示「已处理 x/y，当前 IP」。
- 保留同步接口作为兼容（节点数 ≤ 10 时直接同步返回）。

### 3.5 `enrichCluster` 去 N+1

一次 `GROUP BY k8s_cluster_id` 取全部集群的 total / master 计数，
凭据名一次 `IN (...)` 查询，在内存里拼装。

### P0 验收

- [ ] 造一个返回非法 JSON 的假 apiserver → 前端显示错误而非空列表
- [ ] 600+ Pod 集群：抽屉打开只发 2 次 Pod 请求（日志计数），界面显示截断提示
- [ ] 50 节点自动归类不超时，进度条可见
- [ ] 20 个集群的列表页 SQL 查询数从 ~60 降到 3

---

## 四、P1 · 接入闭环

### 4.1 kubeconfig 导入 + 连接自检

**数据模型**（`model.K8sCluster` 增字段，AutoMigrate 无损加列）：

```go
AuthMode   string `gorm:"size:20;default:token" json:"auth_mode"` // token | clientcert
ClientCert string `gorm:"type:text" json:"-"`                     // PEM，clientcert 模式用
ClientKey  string `gorm:"type:text" json:"-"`                     // PEM
CACert     string `gorm:"type:text" json:"-"`                     // PEM，非空则真校验 TLS
// 展示字段
HasCert    bool   `gorm:"-" json:"has_cert"`
```

**新增接口**

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/k8s/clusters/:id/import-kubeconfig` | body `{kubeconfig: "<yaml>", context?: "..."}`，解析出 server / CA / token 或 client cert 写入集群 |
| POST | `/api/k8s/clusters/:id/test-connection` | 调 `/version` + `/api/v1/nodes?limit=1`，返回 `{ok, version, node_count, latency_ms, error}` |

- kubeconfig 解析：`yaml.v3` 解出 `clusters[].cluster.{server,certificate-authority-data}` 与
  `users[].user.{token,client-certificate-data,client-key-data}`，按 `current-context` 或指定 context 取。
  多 context 时返回可选列表让前端选。
- `kubeGet` 改造：按 `AuthMode` 组装 `tls.Config`（client cert）或 `Authorization` 头；
  `CACert` 非空时 `RootCAs` 装载并关闭 `InsecureSkipVerify`。
- 前端集群编辑 Modal 增「导入 kubeconfig」（粘贴框 + 拖拽文件）与「测试连接」按钮，
  测试结果就地显示延迟与版本，不必等打开看板。

### 4.2 Pod exec 终端（核心）

**协议选择**：kube-apiserver 的 exec 端点原生支持 WebSocket 子协议 `v4.channel.k8s.io`，
帧首字节为通道号，无需 SPDY、无需 client-go：

| 通道 | 方向 | 含义 |
|------|------|------|
| 0 | → | stdin |
| 1 | ← | stdout |
| 2 | ← | stderr |
| 3 | ← | error（结束状态 JSON） |
| 4 | → | resize，负载 `{"Width":w,"Height":h}` |

**后端**：新增 `handler/k8s_exec.go`

```
GET /api/ws/k8s/:id/exec?namespace=&pod=&container=&shell=
```

- 鉴权：沿用 WS 的 `?token=` 约定 + `loadClusterWithToken` 的 owner 校验。
- 后端作为 WS **客户端**连 apiserver：
  `wss://<apiserver>/api/v1/namespaces/{ns}/pods/{pod}/exec?container=&stdin=true&stdout=true&stderr=true&tty=true&command=...`
  子协议 `v4.channel.k8s.io`，带 Bearer / client cert。
- **shell 回退链**：依次尝试 `bash` → `sh`，首个成功即用（通过 channel 3 的 error 状态判断），
  前端可在参数里指定。发行版镜像里 `bash` 常缺失，这条不能省。
- 前端↔后端沿用现有终端协议（JSON 控制帧 `{type:'resize'|'ping'}` + 裸数据），
  后端负责在「现有终端协议」与「v4.channel」之间转换。这样 `TerminalPage` 几乎不用改。
- 写侧沿用 `writeMu` 串行化（与现有 WS handler 一致）。

**前端会话模型改造**（`terminalSessions.tsx`）：

现在会话以 `assetId` 为唯一键（`terminalSessions.tsx:112` 用 `assetId` 去重，本地终端用负数占位）。
Pod 会话没有 assetId，继续塞负数会和本地终端撞。改为：

```ts
type SessionTarget =
  | { kind: 'ssh'; assetId: number }
  | { kind: 'local' }
  | { kind: 'k8s-exec'; clusterId: number; namespace: string; pod: string; container: string };

interface TerminalSession {
  id: number;
  target: SessionTarget;
  dedupKey: string;   // 由 target 派生，替代原来的 assetId 去重
  assetId?: number;   // 兼容保留：ssh 会话仍有，标签名/配色的 localStorage 键继续可用
  ...
}
```

- `dedupKey`：ssh → `a:{id}`，local → `local`，exec → `k8s:{cluster}/{ns}/{pod}/{container}`。
- 标签页标题显示 `pod-name · container`，图标区分。
- **迁移注意**：标签名/配色存在 localStorage 且以 assetId 为键（见 `terminalSessions.tsx:119`），
  改造时 ssh 会话的键必须保持不变，否则老用户丢标签自定义。

**入口**：集群抽屉的 Pod 表格每行加「终端」按钮；容器数 > 1 时先弹容器选择。

### 4.3 实时日志流

```
GET /api/ws/k8s/:id/logs?namespace=&pod=&container=&tail=500&follow=1&previous=0
```

- 后端流式代理 `/api/v1/namespaces/{ns}/pods/{pod}/log?follow=true&tailLines=&timestamps=`，
  逐行推给前端 WS。
- **前端用同一套 xterm 渲染，不另做日志组件**：直接白拿 `Ctrl+F` 屏幕搜索、滚动回看、
  ANSI 配色、字号缩放——这几样恰好是看日志最需要的，也是现成能力。
- 支持：tail 行数、follow 开关、上一容器（`previous=1`，查 CrashLoopBackOff 必需）、
  时间戳开关、一键下载当前缓冲。

---

## 五、API 汇总（新增）

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/k8s/clusters/:id/import-kubeconfig` | 导入 kubeconfig |
| POST | `/api/k8s/clusters/:id/test-connection` | 连接自检 |
| GET | `/api/ws/k8s/:id/exec` | Pod exec 终端（WS） |
| GET | `/api/ws/k8s/:id/logs` | Pod 日志流（WS） |
| GET | `/api/k8s/clusters/:id/live/pods` | **改**：返回体加 `continue` / `truncated` |
| POST | `/api/k8s/auto-classify` | **改**：SSE 进度 + 并发 |

---

## 六、安全与审计

- **审计**：新增 `K8S_EXEC`（记 namespace/pod/container/shell）、`K8S_LOGS`、
  `K8S_KUBECONFIG_IMPORT`。exec 会话结束时补记时长。
- **权限取舍（需拍板）**：exec 等价于容器内 root shell，权力显著大于只读看板。
  两个选项：
  1. exec 仅管理员可用（`/k8s` 页面当前对所有登录用户可见，见旧方案 §十一「偏差小结」）；
  2. 所有集群 owner 均可，但 exec 入口二次确认 + 全程审计。

  **推荐 2**：与产品「自己的资产自己接入」的既有模型一致（普通用户本来就能 SSH 到自己的节点，
  而节点 root ≥ 容器 root，禁 exec 并不实际提升安全水位），且不引入新的权限维度。
- **凭据存储**：`APIToken` / `ClientKey` 沿用现有明文存储取舍，`json:"-"` 不回传前端。
- **TLS**：默认维持 `InsecureSkipVerify`；导入 kubeconfig 带 CA 时**可选**开启真校验（新增能力，非默认变更）。

---

## 七、分阶段交付与验收

| 阶段 | 内容 | 可独立发布 |
|------|------|-----------|
| **S1** | §三 P0 全部 | ✅ 无模型变更，先发 |
| **S2** | §4.1 kubeconfig + 测试连接 | ✅ 加列无损 |
| **S3** | §4.2 exec 终端（含前端会话模型改造） | ✅ |
| **S4** | §4.3 日志流 | ✅ |

**S3 验收要点**（最容易出问题的一环）：

- [ ] 无 `bash` 的镜像（如 alpine）能自动回退 `sh`
- [ ] 终端 resize 生效（改窗口大小后 `stty size` 正确）
- [ ] Pod 被删除 / 容器退出时前端收到明确提示而非静默挂死
- [ ] 同一 Pod 重复点「终端」复用已有标签，不重复开
- [ ] 老用户的 ssh 标签自定义名称/配色**未丢失**（localStorage 键兼容）
- [ ] 中文输出不乱码（UTF-8 直通，不做二次转码）

---

## 八、风险与取舍

| 风险 | 说明 | 应对 |
|------|------|------|
| 手写 `v4.channel.k8s.io` | 不用 client-go 就得自己处理通道帧与错误状态 | 协议简单且稳定多年；对 alpine / ubuntu / 无 TTY 三种情况写集成测试 |
| apiserver 不允许 WS exec | 极少数老版本或中间有不支持 WS 的反代 | `test-connection` 里顺带探测 exec 端点，失败时界面明确说明原因 |
| 前端会话模型改造 | 触及所有终端类型的公共路径，回归面大 | 独立一个 S3 阶段发布；改造后按 §七验收单逐条过 |
| 日志刷屏 | 高频日志打满前端缓冲 | 沿用终端已有的 scrollback 上限 + 背压（暂停 follow） |

---

## 九、后续（不在本期）

- P2：namespace 选择器、Deployment / StatefulSet / Service 视图、Events 时间线
- P3：多集群总览页
- 控制台 `console_type` + 后端反代免登（旧方案遗留未做项）
- worker(10250) 弱判定独立开关（旧方案遗留未做项）
