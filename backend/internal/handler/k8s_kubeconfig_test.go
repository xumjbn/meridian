package handler

import (
	"encoding/base64"
	"strings"
	"testing"
)

func b64(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }

// 证书认证的 kubeconfig：最常见的一种，也是原先接不进来的那种
func TestParseKubeconfigClientCert(t *testing.T) {
	raw := `
apiVersion: v1
kind: Config
current-context: prod
clusters:
- name: prod-cluster
  cluster:
    server: https://10.0.0.250:6443
    certificate-authority-data: ` + b64("CA-PEM") + `
users:
- name: prod-admin
  user:
    client-certificate-data: ` + b64("CERT-PEM") + `
    client-key-data: ` + b64("KEY-PEM") + `
contexts:
- name: prod
  context:
    cluster: prod-cluster
    user: prod-admin
`
	pick, contexts, err := parseKubeconfig(raw, "")
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if pick.APIServer != "10.0.0.250:6443" {
		t.Errorf("APIServer = %q，期望 10.0.0.250:6443", pick.APIServer)
	}
	if pick.CACert != "CA-PEM" || pick.ClientCert != "CERT-PEM" || pick.ClientKey != "KEY-PEM" {
		t.Errorf("证书解码不对: ca=%q cert=%q key=%q", pick.CACert, pick.ClientCert, pick.ClientKey)
	}
	if pick.Context != "prod" || len(contexts) != 1 {
		t.Errorf("context 处理不对: %q %v", pick.Context, contexts)
	}
}

// server 省略端口时补 6443
func TestParseKubeconfigDefaultPort(t *testing.T) {
	raw := `
current-context: c
clusters:
- name: cl
  cluster:
    server: https://k8s.internal
users:
- name: u
  user:
    token: abc123
contexts:
- name: c
  context: {cluster: cl, user: u}
`
	pick, _, err := parseKubeconfig(raw, "")
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if pick.APIServer != "k8s.internal:6443" {
		t.Errorf("APIServer = %q，期望补上 :6443", pick.APIServer)
	}
	if pick.Token != "abc123" {
		t.Errorf("Token = %q", pick.Token)
	}
}

// 多 context：指定名字取对应那个，未知名字要报错并回传可选列表
func TestParseKubeconfigMultiContext(t *testing.T) {
	raw := `
current-context: dev
clusters:
- name: c1
  cluster: {server: https://1.1.1.1:6443}
- name: c2
  cluster: {server: https://2.2.2.2:6443}
users:
- name: u1
  user: {token: t1}
- name: u2
  user: {token: t2}
contexts:
- name: dev
  context: {cluster: c1, user: u1}
- name: prod
  context: {cluster: c2, user: u2}
`
	pick, _, err := parseKubeconfig(raw, "prod")
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if pick.APIServer != "2.2.2.2:6443" || pick.Token != "t2" {
		t.Errorf("按 context 取错了: %+v", pick)
	}

	// 不指定则走 current-context
	pick2, _, err := parseKubeconfig(raw, "")
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if pick2.Token != "t1" {
		t.Errorf("current-context 未生效: %+v", pick2)
	}

	// 未知 context：报错且把可选列表带回去，前端才能让用户挑
	_, ctxs, err := parseKubeconfig(raw, "staging")
	if err == nil {
		t.Fatal("未知 context 应当报错")
	}
	if len(ctxs) != 2 {
		t.Errorf("应回传 2 个可选 context，实际 %v", ctxs)
	}
}

// insecure-skip-tls-verify 时不装 CA：装了等于强行开校验，多半反而连不上
func TestParseKubeconfigInsecureSkipsCA(t *testing.T) {
	raw := `
current-context: c
clusters:
- name: cl
  cluster:
    server: https://1.2.3.4:6443
    insecure-skip-tls-verify: true
    certificate-authority-data: ` + b64("CA-PEM") + `
users:
- name: u
  user: {token: t}
contexts:
- name: c
  context: {cluster: cl, user: u}
`
	pick, _, err := parseKubeconfig(raw, "")
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if pick.CACert != "" {
		t.Errorf("insecure 模式不该装 CA，实际 %q", pick.CACert)
	}
}

// 只有 exec/auth-provider 插件认证的 kubeconfig 要明确拒绝，不能静默存个空凭证
func TestParseKubeconfigRejectsExecAuth(t *testing.T) {
	raw := `
current-context: c
clusters:
- name: cl
  cluster: {server: https://1.2.3.4:6443}
users:
- name: u
  user:
    exec:
      command: aws
contexts:
- name: c
  context: {cluster: cl, user: u}
`
	_, _, err := parseKubeconfig(raw, "")
	if err == nil {
		t.Fatal("exec 插件认证应当被拒绝")
	}
	if !strings.Contains(err.Error(), "token") {
		t.Errorf("错误信息应说明缺少可用凭证，实际: %v", err)
	}
}
