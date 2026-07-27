package handler

import (
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"backend/internal/model"
	"backend/internal/store"

	"github.com/gin-gonic/gin"
)

// ─────────────────────────────────────────────────────────────
// 容器云控制台（UC）指纹探测
//
// 背景：自动归类此前把控制台路径一律写死成 /uc，但各版本容器云的入口并不一致
// （/uc、/、/console、/#/login 都出现过），写死会导致「打开控制台」跳到 404。
// 这里按候选路径逐个探测，用页面指纹选出真实入口，并识别控制台类型与版本。
// ─────────────────────────────────────────────────────────────

// consoleCandidatePaths 是候选入口，按经验命中率排序（/uc 是容器云 UC 的惯例入口）
var consoleCandidatePaths = []string{"/uc", "/", "/console", "/dashboard", "/ui", "/login", "/#/login"}

// consoleProbeResult 单个候选路径的探测结果
type consoleProbeResult struct {
	Path    string `json:"path"`
	Status  int    `json:"status"`
	Title   string `json:"title"`
	Kind    string `json:"kind"`
	Version string `json:"version"`
	Score   int    `json:"score"`
}

var (
	titleRe = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	// 版本号：匹配 "version":"1.2.3" / version: v1.2.3 / Version 1.2.3 等常见写法
	versionRe = regexp.MustCompile(`(?i)"?version"?\s*[:=]\s*"?\s*(v?\d+\.\d+(?:\.\d+)?(?:[-.\w]+)?)`)
	// 前端构建产物里常见的版本注释，作为兜底
	buildVerRe = regexp.MustCompile(`(?i)\b(?:release|build|app)[-_ ]?version[^\d]{0,10}(v?\d+\.\d+(?:\.\d+)?)`)
)

func consoleHTTPClient() *http.Client {
	return &http.Client{
		Timeout:   5 * time.Second,
		Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
	}
}

// classifyConsole 依据标题与正文特征判定控制台类型
func classifyConsole(path, title, body string) string {
	t := strings.ToLower(title)
	b := strings.ToLower(body)
	switch {
	case strings.Contains(b, "kubernetes dashboard") || strings.Contains(t, "kubernetes dashboard"):
		return "kubernetes-dashboard"
	case strings.Contains(t, "rancher") || strings.Contains(b, "rancher"):
		return "rancher"
	case strings.Contains(t, "kubesphere") || strings.Contains(b, "kubesphere"):
		return "kubesphere"
	// 容器云 UC：路径命中 /uc，或标题/正文出现容器云特征词
	case strings.HasPrefix(path, "/uc") || strings.Contains(t, "容器云") || strings.Contains(b, "容器云") ||
		strings.Contains(b, "/uc/") || strings.Contains(t, "统一控制台"):
		return "uc"
	default:
		return "web"
	}
}

// extractVersion 从正文里抽取版本号（优先显式 version 字段，其次构建版本注释）
func extractVersion(body string) string {
	if m := versionRe.FindStringSubmatch(body); len(m) > 1 {
		v := strings.TrimSpace(m[1])
		// 过滤明显不是产品版本的噪声（如 HTML5 的 charset、api 版本 v1）
		if v != "" && v != "v1" && !strings.EqualFold(v, "1.0") {
			return v
		}
	}
	if m := buildVerRe.FindStringSubmatch(body); len(m) > 1 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

// probeConsolePath 探测单个候选路径；不可达返回 ok=false
func probeConsolePath(base, path string) (consoleProbeResult, bool) {
	// 片段（#后面）不会发给服务端，探测时去掉
	reqPath := path
	if i := strings.Index(reqPath, "#"); i >= 0 {
		reqPath = reqPath[:i]
		if reqPath == "" {
			reqPath = "/"
		}
	}
	resp, err := consoleHTTPClient().Get(base + reqPath)
	if err != nil {
		return consoleProbeResult{}, false
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 256<<10))
	body := string(raw)

	title := ""
	if m := titleRe.FindStringSubmatch(body); len(m) > 1 {
		title = strings.TrimSpace(m[1])
		if len(title) > 120 {
			title = title[:120]
		}
	}

	res := consoleProbeResult{
		Path:    path,
		Status:  resp.StatusCode,
		Title:   title,
		Kind:    classifyConsole(path, title, body),
		Version: extractVersion(body),
	}

	// 打分：能进人机界面的路径优先。2xx > 3xx（跳登录页也算入口）> 401（需登录，仍是入口）
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		res.Score = 60
	case resp.StatusCode >= 300 && resp.StatusCode < 400:
		res.Score = 45
	case resp.StatusCode == 401 || resp.StatusCode == 403:
		res.Score = 35
	case resp.StatusCode == 404:
		return res, false // 明确不存在的入口直接淘汰
	default:
		res.Score = 10
	}
	// 指纹加分：像个前端控制台（有 title / HTML 骨架 / 已识别类型）
	if title != "" {
		res.Score += 15
	}
	if strings.Contains(strings.ToLower(body), "<div id=\"app\"") || strings.Contains(strings.ToLower(body), "<div id=\"root\"") {
		res.Score += 10
	}
	if res.Kind != "web" {
		res.Score += 20
	}
	if res.Version != "" {
		res.Score += 5
	}
	return res, true
}

// probeConsole 依次探测候选路径，返回得分最高者与全部探测明细
func probeConsole(cl *model.K8sCluster) (consoleProbeResult, []consoleProbeResult, bool) {
	port := cl.ConsolePort
	if port <= 0 {
		port = 443
	}
	base := fmt.Sprintf("https://%s:%d", cl.VIP, port)

	// 已配置的自定义路径优先纳入候选（用户手填的可能就是对的）
	cands := make([]string, 0, len(consoleCandidatePaths)+1)
	if p := strings.TrimSpace(cl.ConsolePath); p != "" && p != "/" {
		cands = append(cands, p)
	}
	for _, p := range consoleCandidatePaths {
		if !containsStr(cands, p) {
			cands = append(cands, p)
		}
	}

	all := make([]consoleProbeResult, 0, len(cands))
	var best consoleProbeResult
	found := false
	for _, p := range cands {
		r, ok := probeConsolePath(base, p)
		if !ok {
			continue
		}
		all = append(all, r)
		if !found || r.Score > best.Score {
			best = r
			found = true
		}
	}
	return best, all, found
}

func containsStr(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// applyConsoleProbe 把探测结果写回集群记录
func applyConsoleProbe(cl *model.K8sCluster, r consoleProbeResult) {
	now := time.Now()
	cl.ConsolePath = r.Path
	cl.ConsoleKind = r.Kind
	cl.ConsoleTitle = r.Title
	cl.ConsoleVersion = r.Version
	cl.ConsoleCheckedAt = &now
}

// DetectK8sConsole 探测并保存集群控制台的真实路径 / 类型 / 版本
func DetectK8sConsole(c *gin.Context) {
	cl, ok := loadCluster(c)
	if !ok {
		return
	}
	if strings.TrimSpace(cl.VIP) == "" {
		SendError(c, 400, "该集群未配置 VIP，无法探测控制台")
		return
	}
	best, all, found := probeConsole(cl)
	if !found {
		SendError(c, 502, fmt.Sprintf("控制台探测失败：%s:%d 上的候选路径均不可达", cl.VIP, cl.ConsolePort))
		return
	}
	applyConsoleProbe(cl, best)
	store.GlobalDB.Model(cl).Updates(map[string]interface{}{
		"console_path":       cl.ConsolePath,
		"console_kind":       cl.ConsoleKind,
		"console_title":      cl.ConsoleTitle,
		"console_version":    cl.ConsoleVersion,
		"console_checked_at": cl.ConsoleCheckedAt,
	})
	store.GlobalDB.Create(&model.AuditLog{
		Actor: currentUsername(c), Action: "K8S_CONSOLE_DETECT",
		Path:   fmt.Sprintf("集群#%d 探测控制台 → %s (%s %s)", cl.ID, best.Path, best.Kind, best.Version),
		Status: 200, IP: c.ClientIP(),
	})
	SendSuccess(c, gin.H{"best": best, "candidates": all})
}
