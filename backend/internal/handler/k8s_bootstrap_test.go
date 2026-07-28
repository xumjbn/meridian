package handler

import (
	"strings"
	"testing"
)

// TestParseBootstrapOutput 用远端脚本的真实输出（含 motd 噪声与 CRLF）验证解析，
// 并守住底线：token 绝不能混进要回传前端的 logs。
func TestParseBootstrapOutput(t *testing.T) {
	out := "Last login: Mon Jul 28 10:00:00 2026 from 10.0.0.1\n" +
		"K8SBOOT_KUBECTL: kubectl\n" +
		"K8SBOOT_LOG:kubectl 客户端：Client Version: v1.28.2\n" +
		"K8SBOOT_SERVER:https://10.10.10.10:6443\n" +
		"K8SBOOT_LOG:已确保 ServiceAccount kube-system/assetmanager 与只读 ClusterRole 存在\n" +
		"K8SBOOT_METHOD:create-token(1y)\r\n" +
		"K8SBOOT_TOKEN:eyJhbGciOiJSUzI1NiJ9.FAKE.TOKEN\n"

	r := parseBootstrapOutput(out)
	if r.token != "eyJhbGciOiJSUzI1NiJ9.FAKE.TOKEN" {
		t.Fatalf("token = %q", r.token)
	}
	if r.method != "create-token(1y)" {
		t.Fatalf("method = %q", r.method)
	}
	if r.kubectl != "kubectl" {
		t.Fatalf("kubectl = %q", r.kubectl)
	}
	if r.server != "https://10.10.10.10:6443" {
		t.Fatalf("server = %q", r.server)
	}
	if r.errMsg != "" {
		t.Fatalf("errMsg = %q", r.errMsg)
	}
	for _, l := range r.logs {
		if strings.Contains(l, "FAKE.TOKEN") {
			t.Fatalf("token 泄漏进 logs: %q", l)
		}
	}

	// 远端主动报错（如 kubeconfig 不是集群管理员）
	e := parseBootstrapOutput("K8SBOOT_KUBECTL: kubectl\nK8SBOOT_ERR:创建 ServiceAccount / RBAC 失败: Forbidden\n")
	if e.token != "" || !strings.Contains(e.errMsg, "Forbidden") {
		t.Fatalf("%+v", e)
	}

	// 脚本压根没跑起来：必须把原始输出带回去，不能只说一句"失败"
	n := parseBootstrapOutput("-bash: line 1: syntax error near unexpected token\n")
	if !strings.Contains(n.errMsg, "远端未返回预期结果") {
		t.Fatalf("%+v", n)
	}
}

// TestUsableAPIServerFrom kubeconfig 里的 server 只有在是「管理端也能连的 IP」时才可复用
func TestUsableAPIServerFrom(t *testing.T) {
	cases := map[string]string{
		"https://10.10.10.10:6443":  "10.10.10.10:6443",
		"https://127.0.0.1:6443":    "", // k3s 默认写回环，不能用
		"https://0.0.0.0:6443":      "",
		"https://k8s.internal:6443": "", // 域名在管理端未必解析得了
		"https://10.0.0.5":          "10.0.0.5:6443",
		"":                          "",
	}
	for in, want := range cases {
		if got := usableAPIServerFrom(in); got != want {
			t.Fatalf("usableAPIServerFrom(%q) = %q, want %q", in, got, want)
		}
	}
}
