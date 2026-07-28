package handler

import (
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"

	"backend/internal/model"
	"backend/internal/store"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/ssh"
)

// ─────────────────────────────────────────────────────────────
// 用 SSH 凭据自动配置 kube API Token
//
// 原来要用实时看板/节点同步，用户必须自己去 master 上敲 kubectl create token，
// 再把一长串 JWT 粘回表单——这一步劝退了绝大多数人，于是集群建完就停在「没 Token」。
//
// 但用户手里本来就有这些机器的 SSH 凭据（终端/SFTP/指标采集都在用）。
// 那就让后端替他走一遍：SSH 登到 master → 找到能用的 kubectl → 建一个只读 SA
// → 取 Token → 落库（加密）→ 顺手把节点同步回来。用户只需要「填 VIP + 选凭据」。
//
// 安全约定：Token 全程只在后端内存和加密的 DB 字段里流动，不写日志、不回传前端。
// ─────────────────────────────────────────────────────────────

const (
	// SA 名不带 readonly 后缀：ClusterRole 是 "<SA>-readonly"，否则会拼成 xxx-readonly-readonly
	defaultBootstrapSA = "assetmanager"
	defaultBootstrapNS = "kube-system"
)

// k8sNameRe Kubernetes 对象名规范（RFC1123 label）。
// 虽然下面进 shell 前已经单引号转义，但名字最终还要拼进 YAML，
// 这里先卡一道，避免把奇怪的字符带到远端。
var k8sNameRe = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`)

type k8sSSHBootstrapReq struct {
	Host           string `json:"host"`            // master 地址，留空用集群 VIP
	SSHPort        int    `json:"ssh_port"`        // 留空默认 22
	CredentialID   *uint  `json:"credential_id"`   // 留空用集群已绑定的凭据
	Namespace      string `json:"namespace"`       // 留空 kube-system
	ServiceAccount string `json:"service_account"` // 留空 assetmanager-readonly
	SyncNodes      *bool  `json:"sync_nodes"`      // 留空=拿到 Token 后立刻同步节点
	CreateMissing  bool   `json:"create_missing"`  // 同步时是否补录资产表里没有的节点
}

// bootstrapScript 远端脚本：找 kubectl → 建只读 SA/RBAC → 取 Token。
// 全程用 K8SBOOT_* 前缀行回传结构化结果，正常输出一概不解析，
// 免得被 motd / 登录 banner 之类的噪声干扰。
// 占位符 {{SA}} / {{NS}} 由 Go 侧单引号转义后替换。
const bootstrapScript = `
set -u
SA={{SA}}
NS={{NS}}
T64=""
TOKEN=""
METHOD=""

log() { echo "K8SBOOT_LOG:$1"; }
fail() { echo "K8SBOOT_ERR:$1"; exit 1; }

# 候选组合：二进制 × kubeconfig × 是否 sudo。
# 判定标准是「真的能问到 apiserver」（get --raw /version），而不是 which kubectl——
# 后者会把「装了 kubectl 但没 kubeconfig / 没权限」误判成可用，然后在建 SA 那步才炸。
KC=""
for K in kubectl /usr/local/bin/kubectl /usr/bin/kubectl /snap/bin/kubectl /var/lib/rancher/rke2/bin/kubectl "k3s kubectl" "/usr/local/bin/k3s kubectl" "microk8s kubectl"; do
  for CFG in "" /etc/kubernetes/admin.conf /etc/rancher/k3s/k3s.yaml /etc/rancher/rke2/rke2.yaml "${HOME:-/root}/.kube/config" /root/.kube/config; do
    for S in "" "sudo -n"; do
      if [ -n "$CFG" ]; then
        # 非 sudo 时读不到的 kubeconfig 直接跳过，少几十次无谓的进程启动
        [ -r "$CFG" ] || [ -n "$S" ] || continue
        C="$S $K --kubeconfig=$CFG"
      else
        C="$S $K"
      fi
      if $C get --raw /version --request-timeout=6s >/dev/null 2>&1; then KC="$C"; break 3; fi
    done
  done
done

if [ -z "$KC" ]; then
  fail "找不到可用的 kubectl。已尝试 kubectl / k3s kubectl / microk8s kubectl（含 sudo -n，以及 /etc/kubernetes/admin.conf、/etc/rancher/k3s/k3s.yaml、/etc/rancher/rke2/rke2.yaml、~/.kube/config 等 kubeconfig）。请确认这台是 master/控制平面节点，且该 SSH 用户能执行 kubectl（或已配置 NOPASSWD sudo）。"
fi
echo "K8SBOOT_KUBECTL:$KC"

CV=$($KC version --client 2>/dev/null | head -1)
if [ -n "$CV" ]; then log "kubectl 客户端：$CV"; fi

SRV=$($KC config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null)
if [ -n "$SRV" ]; then echo "K8SBOOT_SERVER:$SRV"; fi

$KC get namespace "$NS" >/dev/null 2>&1 || $KC create namespace "$NS" >/dev/null 2>&1

# 只读 SA：只给 nodes/pods/namespaces 的 get/list，够本应用用，也不至于交出一个万能凭证
APPLY_OUT=$($KC apply --request-timeout=20s -f - 2>&1 <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: $SA
  namespace: $NS
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: $SA-readonly
rules:
  - apiGroups: [""]
    resources: ["nodes", "nodes/status", "pods", "namespaces"]
    verbs: ["get", "list"]
  - nonResourceURLs: ["/version"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: $SA-readonly
subjects:
  - kind: ServiceAccount
    name: $SA
    namespace: $NS
roleRef:
  kind: ClusterRole
  name: $SA-readonly
  apiGroup: rbac.authorization.k8s.io
EOF
) || fail "创建 ServiceAccount / RBAC 失败（该 kubeconfig 可能不是集群管理员）: $APPLY_OUT"
log "已确保 ServiceAccount $NS/$SA 与只读 ClusterRole 存在"

# 取 Token：优先 kubectl create token（1.24+）；不行再退回 ServiceAccount Secret
if TOKEN=$($KC create token "$SA" -n "$NS" --duration=8760h --request-timeout=20s 2>/dev/null); then
  METHOD="create-token(1y)"
elif TOKEN=$($KC create token "$SA" -n "$NS" --request-timeout=20s 2>/dev/null); then
  # apiserver 对 --duration 有上限时会直接拒绝，退回默认有效期（通常 1h）
  METHOD="create-token(默认有效期)"
else
  log "kubectl create token 不可用（kubectl < 1.24 或 apiserver 不支持 TokenRequest），改用 ServiceAccount Secret"
  SEC=$($KC get sa "$SA" -n "$NS" -o jsonpath='{.secrets[0].name}' 2>/dev/null)
  if [ -n "$SEC" ]; then
    METHOD="sa-secret"
  else
    # 1.24 起不再自动签发 SA Secret，得自己声明一个长期 token secret
    SEC="$SA-token"
    $KC apply --request-timeout=20s -f - >/dev/null 2>&1 <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: $SEC
  namespace: $NS
  annotations:
    kubernetes.io/service-account.name: $SA
type: kubernetes.io/service-account-token
EOF
    METHOD="manual-secret"
  fi
  # token 控制器是异步填充的，给它几秒
  i=0
  while [ $i -lt 10 ]; do
    T64=$($KC get secret "$SEC" -n "$NS" -o jsonpath='{.data.token}' 2>/dev/null)
    if [ -n "$T64" ]; then break; fi
    i=$((i+1))
    sleep 1
  done
  if [ -z "$T64" ]; then
    fail "kubectl create token 不可用，退回读取 ServiceAccount Secret 也没拿到 token（secret=$NS/$SEC）。请升级 kubectl 到 1.24+，或手工创建该 SA 的 token secret。"
  fi
  TOKEN=$(printf %s "$T64" | base64 -d 2>/dev/null || printf %s "$T64" | base64 --decode)
fi

if [ -z "$TOKEN" ]; then
  fail "未能获取 ServiceAccount Token（kubectl 命令成功但输出为空）"
fi
echo "K8SBOOT_METHOD:$METHOD"
echo "K8SBOOT_TOKEN:$TOKEN"
`

// bootstrapOutput 远端脚本回传的结构化结果
type bootstrapOutput struct {
	kubectl string
	method  string
	server  string
	token   string // 只在内存里流转，不进日志、不进响应
	errMsg  string
	logs    []string
}

// parseBootstrapOutput 按 K8SBOOT_* 标记解析远端输出。
// logs 里刻意不放 token 行——这份 logs 是要回给前端展示的。
func parseBootstrapOutput(out string) bootstrapOutput {
	var r bootstrapOutput
	sawMarker := false
	for _, raw := range strings.Split(out, "\n") {
		ln := strings.TrimRight(raw, "\r")
		switch {
		case strings.HasPrefix(ln, "K8SBOOT_TOKEN:"):
			sawMarker = true
			r.token = strings.TrimSpace(strings.TrimPrefix(ln, "K8SBOOT_TOKEN:"))
		case strings.HasPrefix(ln, "K8SBOOT_KUBECTL:"):
			sawMarker = true
			r.kubectl = strings.TrimSpace(strings.TrimPrefix(ln, "K8SBOOT_KUBECTL:"))
			r.logs = append(r.logs, "kubectl: "+r.kubectl)
		case strings.HasPrefix(ln, "K8SBOOT_METHOD:"):
			sawMarker = true
			r.method = strings.TrimSpace(strings.TrimPrefix(ln, "K8SBOOT_METHOD:"))
		case strings.HasPrefix(ln, "K8SBOOT_SERVER:"):
			sawMarker = true
			r.server = strings.TrimSpace(strings.TrimPrefix(ln, "K8SBOOT_SERVER:"))
			r.logs = append(r.logs, "kubeconfig 里的 apiserver: "+r.server)
		case strings.HasPrefix(ln, "K8SBOOT_ERR:"):
			sawMarker = true
			r.errMsg = strings.TrimSpace(strings.TrimPrefix(ln, "K8SBOOT_ERR:"))
		case strings.HasPrefix(ln, "K8SBOOT_LOG:"):
			sawMarker = true
			r.logs = append(r.logs, strings.TrimSpace(strings.TrimPrefix(ln, "K8SBOOT_LOG:")))
		}
	}
	// 一个标记都没有说明脚本压根没跑起来（登录 shell 不是 sh、被 rbash 拦了…），
	// 这时把原始输出带回去，否则用户只会看到一句「失败」无从下手。
	// 没有标记也就不可能有 token 行，不存在泄露。
	if !sawMarker && strings.TrimSpace(out) != "" {
		r.errMsg = "远端未返回预期结果，原始输出：" + truncateStr(strings.TrimSpace(out), 400)
	}
	return r
}

// runSSHScript 在一个独立会话里跑脚本并合并 stdout/stderr。
// 退出码非 0 不当错误：脚本靠 K8SBOOT_ERR 行说明原因，输出比退出码有用。
func runSSHScript(client *ssh.Client, script string, timeout time.Duration) (string, error) {
	sess, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("创建 SSH 会话失败: %v", err)
	}
	defer sess.Close()

	type result struct {
		out []byte
		err error
	}
	ch := make(chan result, 1)
	go func() {
		out, e := sess.CombinedOutput(script)
		ch <- result{out, e}
	}()
	select {
	case r := <-ch:
		return string(r.out), nil
	case <-time.After(timeout):
		_ = sess.Signal(ssh.SIGKILL)
		return "", fmt.Errorf("远端命令超时（%s），kubectl 可能卡在连不上的 apiserver 上", timeout)
	}
}

// usableAPIServerFrom 从 kubeconfig 的 server 字段里挑出「本机也能连」的 host:port。
// 只认 IP：k3s 之类会写成 https://127.0.0.1:6443，DNS 名也未必在管理端能解析，
// 拿不准就返回空，让调用方回落到用户填的 VIP:6443。
func usableAPIServerFrom(server string) string {
	s := strings.TrimSpace(server)
	s = strings.TrimPrefix(s, "https://")
	s = strings.TrimPrefix(s, "http://")
	s = strings.TrimRight(s, "/")
	if s == "" {
		return ""
	}
	host, port, err := net.SplitHostPort(s)
	if err != nil {
		host, port = s, "6443"
	}
	ip := net.ParseIP(host)
	if ip == nil || ip.IsLoopback() || ip.IsUnspecified() {
		return ""
	}
	return net.JoinHostPort(host, port)
}

// BootstrapK8sTokenBySSH 用 SSH 凭据登到 master 自动配置 API Token，并立刻同步节点
func BootstrapK8sTokenBySSH(c *gin.Context) {
	cl, ok := loadCluster(c)
	if !ok {
		return
	}
	var req k8sSSHBootstrapReq
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			SendError(c, 400, "参数格式错误")
			return
		}
	}

	host := strings.TrimSpace(req.Host)
	if host == "" {
		host = strings.TrimSpace(cl.VIP)
	}
	if host == "" {
		SendError(c, 400, "未指定 master 地址，且集群 VIP 为空")
		return
	}

	// 凭据：本次指定 > 集群绑定。跨租户防护同建/改集群，不能借别人的凭据去连机器。
	credID := req.CredentialID
	if credID == nil {
		credID = cl.CredentialID
	}
	if credID == nil {
		SendError(c, 400, "该集群未绑定凭据，请先在集群编辑里绑定一份 SSH 凭据，或在本次操作中选择")
		return
	}
	if !assertCredentialOwned(c, credID) {
		SendError(c, 403, "无权使用该凭据")
		return
	}
	var cred model.Credential
	if store.GlobalDB.First(&cred, *credID).Error != nil {
		SendError(c, 404, "凭据不存在")
		return
	}
	if cred.Type == "telnet" {
		SendError(c, 400, "该凭据是 telnet 类型，自动配置需要 SSH 凭据（密码或私钥）")
		return
	}

	ns := strings.TrimSpace(req.Namespace)
	if ns == "" {
		ns = defaultBootstrapNS
	}
	sa := strings.TrimSpace(req.ServiceAccount)
	if sa == "" {
		sa = defaultBootstrapSA
	}
	if !k8sNameRe.MatchString(ns) || !k8sNameRe.MatchString(sa) {
		SendError(c, 400, "命名空间 / ServiceAccount 名称不合法（只允许小写字母、数字与中划线）")
		return
	}

	asset := model.Asset{IP: host, SSHPort: req.SSHPort}
	client, err := dialSSHForAsset(&asset, &cred)
	if err != nil {
		SendError(c, 502, fmt.Sprintf("SSH 连接 %s 失败: %v",
			net.JoinHostPort(host, strconv.Itoa(asset.ResolvedSSHPort())), err))
		return
	}
	defer client.Close()

	script := strings.NewReplacer(
		"{{SA}}", shSingleQuote(sa),
		"{{NS}}", shSingleQuote(ns),
	).Replace(bootstrapScript)

	// 脚本里最多要试近百次 kubectl，外加 token secret 最长等 10s，超时给足
	out, runErr := runSSHScript(client, script, 120*time.Second)
	res := parseBootstrapOutput(out)

	if res.token == "" {
		msg := res.errMsg
		if msg == "" && runErr != nil {
			msg = runErr.Error()
		}
		if msg == "" {
			msg = "远端没有返回 Token，也没有返回错误说明"
		}
		if len(res.logs) > 0 {
			msg += "（已探测到 " + strings.Join(res.logs, "；") + "）"
		}
		SendError(c, 502, "自动获取 Token 失败: "+msg)
		return
	}

	cl.APIToken = res.token // 落库时由 K8sCluster.BeforeSave 加密
	// 只在用户没填过 api_server 时才用 kubeconfig 里的地址补一手，不覆盖用户的显式配置
	if strings.TrimSpace(cl.APIServer) == "" {
		if hp := usableAPIServerFrom(res.server); hp != "" {
			cl.APIServer = hp
			res.logs = append(res.logs, "已自动填入 API Server: "+hp)
		} else if res.server != "" {
			res.logs = append(res.logs, "kubeconfig 里的 apiserver 不可直接复用（回环地址或域名），仍按 "+kubeAPIServer(cl)+" 访问")
		}
	}
	if err := store.GlobalDB.Save(cl).Error; err != nil {
		SendError(c, 500, "保存 Token 失败: "+err.Error())
		return
	}
	// K8sCluster.BeforeSave 是「就地」把 APIToken 改成密文的，Save 之后 cl 里躺的是
	// enc:v1:... 而不是 JWT。下面 syncK8sNodesCore 还要拿它当 Bearer 用，
	// 不还原就会把密文发给 apiserver 换来一个 401——这里必须复位成明文。
	cl.APIToken = res.token

	// 审计只记「谁、在哪台、用哪个 SA、什么方式」，Token 本身绝不入库以外的任何地方
	store.GlobalDB.Create(&model.AuditLog{
		Actor: currentUsername(c), Action: "K8S_SSH_BOOTSTRAP",
		Path: fmt.Sprintf("集群#%d 经 SSH %s 自动配置 API Token（SA %s/%s，方式 %s）",
			cl.ID, host, ns, sa, res.method),
		Status: 200, IP: c.ClientIP(),
	})

	resp := gin.H{
		"kubectl":         res.kubectl,
		"method":          res.method,
		"api_server":      kubeAPIServer(cl),
		"service_account": ns + "/" + sa,
		"token_saved":     true,
		"log":             res.logs,
	}
	// 拿到 Token 后顺手把节点同步回来——这才是用户真正想要的结果。
	// 同步失败不回滚 Token（Token 是好的，多半是 apiserver 地址不对），
	// 但必须把错误显式带回前端，不能装作全都成功。
	if req.SyncNodes == nil || *req.SyncNodes {
		sum, err := syncK8sNodesCore(c, cl, req.CreateMissing)
		if err != nil {
			resp["sync_error"] = err.Error()
		} else {
			resp["sync"] = sum
		}
	}
	SendSuccess(c, resp)
}
