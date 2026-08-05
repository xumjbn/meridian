package handler

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"backend/internal/model"
	"backend/internal/store"

	"github.com/gin-gonic/gin"
	"gopkg.in/yaml.v3"
)

// ─────────────────────────────────────────────────────────────
// kubeconfig 导入 + 连接自检
//
// 此前接入 kube API 只有一条路：手填 ServiceAccount Bearer Token。
// 但多数人手上现成的是一份 kubeconfig，而且里面给的往往是
// client-certificate/client-key（证书认证），这类集群原先根本接不进来。
//
// 这里只解析 kubeconfig 的必要子集：server / CA / token / 客户端证书对。
// 不引 client-go —— 依赖体量与本项目「纯 Go 单二进制」的定位不匹配，
// 而所需字段就这几个，yaml.v3（依赖树里已有）足够。
// ─────────────────────────────────────────────────────────────

// kubeconfigFile kubeconfig 的最小解析结构
type kubeconfigFile struct {
	CurrentContext string `yaml:"current-context"`
	Clusters       []struct {
		Name    string `yaml:"name"`
		Cluster struct {
			Server                   string `yaml:"server"`
			CertificateAuthorityData string `yaml:"certificate-authority-data"`
			InsecureSkipTLSVerify    bool   `yaml:"insecure-skip-tls-verify"`
		} `yaml:"cluster"`
	} `yaml:"clusters"`
	Users []struct {
		Name string `yaml:"name"`
		User struct {
			Token                 string `yaml:"token"`
			ClientCertificateData string `yaml:"client-certificate-data"`
			ClientKeyData         string `yaml:"client-key-data"`
		} `yaml:"user"`
	} `yaml:"users"`
	Contexts []struct {
		Name    string `yaml:"name"`
		Context struct {
			Cluster string `yaml:"cluster"`
			User    string `yaml:"user"`
		} `yaml:"context"`
	} `yaml:"contexts"`
}

// kubeconfigPick 从 kubeconfig 中按 context 解析出的一组接入参数
type kubeconfigPick struct {
	Context    string
	APIServer  string // host:port，与 kubeAPIServer 的表示保持一致
	CACert     string
	Token      string
	ClientCert string
	ClientKey  string
}

// decodeB64 kubeconfig 里的证书字段是 base64 的 PEM
func decodeB64(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", nil
	}
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// serverToHostPort 把 kubeconfig 的 server（https://host:6443）规整成 host:port。
// 缺端口时补 6443——kubeconfig 里省略端口的写法并不少见。
func serverToHostPort(server string) (string, error) {
	s := strings.TrimSpace(server)
	if s == "" {
		return "", fmt.Errorf("kubeconfig 中 cluster.server 为空")
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil {
		return "", fmt.Errorf("cluster.server 无法解析: %v", err)
	}
	host := u.Host
	if host == "" {
		return "", fmt.Errorf("cluster.server 中没有主机名")
	}
	if u.Port() == "" {
		host += ":6443"
	}
	return host, nil
}

// parseKubeconfig 解析 kubeconfig，按指定 context（留空取 current-context）取出接入参数。
// 同时返回全部可选 context 名，供前端在多 context 时让用户挑。
func parseKubeconfig(raw string, wantContext string) (*kubeconfigPick, []string, error) {
	var kc kubeconfigFile
	if err := yaml.Unmarshal([]byte(raw), &kc); err != nil {
		return nil, nil, fmt.Errorf("kubeconfig 不是合法 YAML: %v", err)
	}
	names := make([]string, 0, len(kc.Contexts))
	for _, ctx := range kc.Contexts {
		names = append(names, ctx.Name)
	}
	if len(kc.Contexts) == 0 {
		return nil, names, fmt.Errorf("kubeconfig 中没有 contexts")
	}

	target := strings.TrimSpace(wantContext)
	if target == "" {
		target = strings.TrimSpace(kc.CurrentContext)
	}
	if target == "" {
		target = kc.Contexts[0].Name // 既没指定也没有 current-context，取第一个
	}

	var clusterName, userName string
	found := false
	for _, ctx := range kc.Contexts {
		if ctx.Name == target {
			clusterName, userName, found = ctx.Context.Cluster, ctx.Context.User, true
			break
		}
	}
	if !found {
		return nil, names, fmt.Errorf("kubeconfig 中没有名为 %q 的 context", target)
	}

	pick := &kubeconfigPick{Context: target}
	for _, cl := range kc.Clusters {
		if cl.Name != clusterName {
			continue
		}
		hp, err := serverToHostPort(cl.Cluster.Server)
		if err != nil {
			return nil, names, err
		}
		pick.APIServer = hp
		// 显式写了 insecure-skip-tls-verify 就别装 CA，否则等于强行开启校验，
		// 而这类 kubeconfig 的 CA 往往本来就对不上
		if !cl.Cluster.InsecureSkipTLSVerify {
			ca, err := decodeB64(cl.Cluster.CertificateAuthorityData)
			if err != nil {
				return nil, names, fmt.Errorf("CA 证书 base64 解码失败: %v", err)
			}
			pick.CACert = ca
		}
		break
	}
	if pick.APIServer == "" {
		return nil, names, fmt.Errorf("kubeconfig 中找不到 context 对应的 cluster %q", clusterName)
	}

	for _, u := range kc.Users {
		if u.Name != userName {
			continue
		}
		pick.Token = strings.TrimSpace(u.User.Token)
		cert, err := decodeB64(u.User.ClientCertificateData)
		if err != nil {
			return nil, names, fmt.Errorf("客户端证书 base64 解码失败: %v", err)
		}
		key, err := decodeB64(u.User.ClientKeyData)
		if err != nil {
			return nil, names, fmt.Errorf("客户端私钥 base64 解码失败: %v", err)
		}
		pick.ClientCert, pick.ClientKey = cert, key
		break
	}
	if pick.Token == "" && (pick.ClientCert == "" || pick.ClientKey == "") {
		return nil, names, fmt.Errorf("kubeconfig 的用户 %q 既没有 token，也没有完整的客户端证书对（本工具不支持 exec/auth-provider 插件认证）", userName)
	}
	return pick, names, nil
}

// ImportK8sKubeconfig 导入 kubeconfig，写入集群的 API Server 与认证信息
func ImportK8sKubeconfig(c *gin.Context) {
	cl, ok := loadCluster(c)
	if !ok {
		return
	}
	var req struct {
		Kubeconfig string `json:"kubeconfig"`
		Context    string `json:"context"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, "参数格式错误")
		return
	}
	if strings.TrimSpace(req.Kubeconfig) == "" {
		SendError(c, 400, "kubeconfig 内容为空")
		return
	}

	pick, contexts, err := parseKubeconfig(req.Kubeconfig, req.Context)
	if err != nil {
		// 多 context 时把可选项一并返回，前端可直接让用户挑一个重试
		c.JSON(400, gin.H{"code": 400, "message": err.Error(), "data": gin.H{"contexts": contexts}})
		return
	}

	cl.APIServer = pick.APIServer
	cl.CACert = pick.CACert
	if pick.ClientCert != "" && pick.ClientKey != "" {
		cl.AuthMode = "clientcert"
		cl.ClientCert, cl.ClientKey = pick.ClientCert, pick.ClientKey
		cl.APIToken = "" // 两种认证只留一种，避免下次改配置时搞不清到底哪个在生效
	} else {
		cl.AuthMode = "token"
		cl.APIToken = pick.Token
		cl.ClientCert, cl.ClientKey = "", ""
	}

	if err := store.GlobalDB.Save(cl).Error; err != nil {
		SendError(c, 500, "保存集群失败: "+err.Error())
		return
	}
	invalidateKubeCache(cl.ID)

	store.GlobalDB.Create(&model.AuditLog{
		Actor: currentUsername(c), Action: "K8S_KUBECONFIG_IMPORT",
		Path:   fmt.Sprintf("集群#%d 导入 kubeconfig（context=%s, 认证=%s）", cl.ID, pick.Context, cl.AuthMode),
		Status: 200, IP: c.ClientIP(),
	})

	// 导入完立刻自检一次，省得用户还要再点一下「测试连接」才知道成没成
	result := testKubeConnection(cl)
	enrichCluster(cl)
	SendSuccess(c, gin.H{
		"context": pick.Context, "contexts": contexts,
		"api_server": cl.APIServer, "auth_mode": cl.AuthMode,
		"verify_tls": cl.CACert != "",
		"test":       result,
	})
}

// kubeTestResult 连接自检结果
type kubeTestResult struct {
	OK         bool   `json:"ok"`
	Version    string `json:"version"`
	NodeCount  int    `json:"node_count"`
	LatencyMS  int64  `json:"latency_ms"`
	CanExec    bool   `json:"can_exec"`
	Error      string `json:"error,omitempty"`
	ExecReason string `json:"exec_reason,omitempty"`
}

// testKubeConnection 打一次 /version 与 /api/v1/nodes，顺带看能不能 exec。
// 之前配错 APIServer 或 Token 要等到打开看板才 502，这里让用户当场知道结果。
func testKubeConnection(cl *model.K8sCluster) kubeTestResult {
	var res kubeTestResult
	if !kubeConfigured(cl) {
		res.Error = "未配置 kube API 凭证"
		return res
	}

	start := time.Now()
	body, code, err := kubeGet(cl, "/version")
	res.LatencyMS = time.Since(start).Milliseconds()
	if err != nil {
		res.Error = "连接 kube-apiserver 失败: " + err.Error()
		return res
	}
	if code != 200 {
		res.Error = fmt.Sprintf("kube API /version 返回 %d: %s", code, truncateStr(string(body), 200))
		return res
	}
	var ver struct {
		GitVersion string `json:"gitVersion"`
	}
	// 版本拿不到不算失败（有些发行版 /version 结构不同），继续往下探节点
	if err := json.Unmarshal(body, &ver); err == nil {
		res.Version = ver.GitVersion
	}

	nodes, err := fetchKubeNodes(cl)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	res.NodeCount = len(nodes.Items)
	res.OK = true

	// exec 依赖 pods/exec 子资源权限；只读 SA 常常没有。
	// 提前探明白，免得用户点了终端才发现开不了。
	if _, code, err := kubeGet(cl, "/api/v1/namespaces/default/pods?limit=1"); err != nil || code != 200 {
		res.ExecReason = "无法列出 default 命名空间的 Pod，exec 可能不可用"
	} else {
		res.CanExec = true
	}
	return res
}

// TestK8sConnection 连接自检接口
func TestK8sConnection(c *gin.Context) {
	cl, ok := loadCluster(c)
	if !ok {
		return
	}
	SendSuccess(c, testKubeConnection(cl))
}
