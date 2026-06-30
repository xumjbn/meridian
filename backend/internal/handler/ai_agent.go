package handler

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"backend/internal/model"
	"backend/internal/store"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/ssh"
)

// ==========================================
// AI Agent — 一句话自动完成运维任务
// 模式：自动执行 + 高危拦截。AI 逐步生成命令，后端经独立 SSH 通道执行并回传
// 输出，AI 据此推进；命中高危命令时暂停等待用户确认。支持多轮对话与上下文记忆。
// 安全：归属校验、高危拦截、步数上限、每步超时、全程审计。
// ==========================================

const (
	maxAgentSteps    = 15               // 单个会话内累计执行命令上限
	agentCmdTimeout  = 30 * time.Second // 每条命令执行超时
	agentFeedLimit   = 3000             // 回传给模型的单条输出截断
	agentStoreLimit  = 6000             // 展示给前端的单条输出截断
	agentSessionTTL  = 1 * time.Hour    // 会话空闲存活时间
	agentMaxTokens   = 600
	agentCwdMarker   = "__MRD_CWD__:"
)

type chatMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// agentStepRec 一步执行记录（用于前端展示）
type agentStepRec struct {
	Index     int    `json:"index"`
	Thought   string `json:"thought,omitempty"`
	Command   string `json:"command"`
	Output    string `json:"output"`
	ExitCode  int    `json:"exit_code"`
	Dangerous bool   `json:"dangerous"`
}

// agentSession 一次 Agent 任务会话（含完整对话历史，支持多轮）
type agentSession struct {
	ID          string
	RequesterID uint
	Actor       string
	IP          string
	Title       string // 首条任务描述（截断，用于历史列表）
	Asset       model.Asset
	Cred        model.Credential
	OSHint      string
	WorkDir     string // 远端工作目录（跨命令保留）
	Messages    []chatMsg
	Steps       []agentStepRec
	Status      string // awaiting_confirm | done | error | aborted
	Pending     string // 待确认的高危命令
	PendingNote string // 待确认命令的 AI 说明
	PendingWarn string // 高危提示
	Summary     string
	LastErr     string
	LastUsed    time.Time
	mu          sync.Mutex

	// 停止控制：与 mu 分离，使 /stop 在 runLoop 持锁运行时也能立即生效
	cancelMu    sync.Mutex
	cancel      context.CancelFunc // 运行中为非 nil，可取消在途 LLM/SSH 调用
	stopRequest bool
}

// requestStop 标记并取消当前运行（无需 s.mu，可在 runLoop 持锁时调用）
func (s *agentSession) requestStop() {
	s.cancelMu.Lock()
	s.stopRequest = true
	if s.cancel != nil {
		s.cancel()
	}
	s.cancelMu.Unlock()
}

func (s *agentSession) stopped() bool {
	s.cancelMu.Lock()
	defer s.cancelMu.Unlock()
	return s.stopRequest
}

var (
	agentSessions = map[string]*agentSession{}
	agentMu       sync.Mutex
)

// agentAction 模型每步返回的结构化动作
type agentAction struct {
	Thought string `json:"thought"`
	Command string `json:"command"`
	Done    bool   `json:"done"`
	Summary string `json:"summary"`
}

func newSessionID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "agent-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return "agent-" + hex.EncodeToString(b)
}

func sweepAgentSessions() {
	cutoff := time.Now().Add(-agentSessionTTL)
	for id, s := range agentSessions {
		// 不清理仍在运行 / 等待确认的会话：否则会丢失其 cancel 与内存中最新状态，
		// 导致后续 /stop、/message 操作到从 DB 重建的过期副本上、对真实在跑的 goroutine 失效。
		if s.cancel != nil || s.Status == "running" || s.Status == "awaiting_confirm" {
			continue
		}
		if s.LastUsed.Before(cutoff) {
			delete(agentSessions, id)
		}
	}
}

// getAgentSession 取会话；内存未命中则从数据库加载并重建（重启后仍可继续/查看）
func getAgentSession(id string) *agentSession {
	agentMu.Lock()
	if s := agentSessions[id]; s != nil {
		agentMu.Unlock()
		return s
	}
	agentMu.Unlock()

	var rec model.AgentSession
	if err := store.GlobalDB.First(&rec, "id = ?", id).Error; err != nil {
		return nil
	}
	s := &agentSession{
		ID:          rec.ID,
		RequesterID: rec.RequesterID,
		Title:       rec.Title,
		OSHint:      rec.OSHint,
		WorkDir:     rec.WorkDir,
		Status:      rec.Status,
		Pending:     rec.Pending,
		PendingNote: rec.PendingNote,
		PendingWarn: rec.PendingWarn,
		Summary:     rec.Summary,
		LastErr:     rec.LastErr,
		LastUsed:    time.Now(),
	}
	_ = json.Unmarshal([]byte(rec.Messages), &s.Messages)
	_ = json.Unmarshal([]byte(rec.Steps), &s.Steps)
	// 重新加载资产与凭据以便继续执行
	store.GlobalDB.First(&s.Asset, rec.AssetID)
	s.Actor = "" // 由调用方按当前用户补充审计
	if s.Asset.CredentialID != nil {
		store.GlobalDB.First(&s.Cred, *s.Asset.CredentialID)
	}
	agentMu.Lock()
	agentSessions[id] = s
	agentMu.Unlock()
	return s
}

// persistSession 写穿持久化会话（调用方应持有 s.mu）
func persistSession(s *agentSession) {
	msgs, _ := json.Marshal(s.Messages)
	steps, _ := json.Marshal(s.Steps)
	rec := model.AgentSession{
		ID:          s.ID,
		RequesterID: s.RequesterID,
		AssetID:     s.Asset.ID,
		AssetName:   s.Asset.Name,
		Title:       s.Title,
		OSHint:      s.OSHint,
		WorkDir:     s.WorkDir,
		Messages:    string(msgs),
		Steps:       string(steps),
		Status:      s.Status,
		Pending:     s.Pending,
		PendingNote: s.PendingNote,
		PendingWarn: s.PendingWarn,
		Summary:     s.Summary,
		LastErr:     s.LastErr,
	}
	// 主键存在则更新，否则创建
	store.GlobalDB.Save(&rec)
}

// shSingleQuote 安全地单引号包裹路径，供 shell 使用
func shSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// dialSSHForAsset 按资产凭据建立 SSH 客户端（与终端/SFTP 一致，支持非标端口）
func dialSSHForAsset(asset *model.Asset, cred *model.Credential) (*ssh.Client, error) {
	timeout := 10 * time.Second
	if n, err := strconv.Atoi(getSettingValue(store.GlobalDB, "ssh_timeout", "10")); err == nil && n > 0 {
		timeout = time.Duration(n) * time.Second
	}
	cfg := &ssh.ClientConfig{
		User:            cred.Username,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         timeout,
	}
	if cred.Type == "ssh_key" && cred.PrivateKey != "" {
		signer, err := ssh.ParsePrivateKey([]byte(cred.PrivateKey))
		if err != nil {
			return nil, fmt.Errorf("私钥解析失败: %v", err)
		}
		cfg.Auth = []ssh.AuthMethod{ssh.PublicKeys(signer)}
	} else {
		cfg.Auth = []ssh.AuthMethod{ssh.Password(cred.Password)}
	}
	return ssh.Dial("tcp", net.JoinHostPort(asset.IP, strconv.Itoa(asset.ResolvedSSHPort())), cfg)
}

// runRemoteCmd 在独立 SSH 会话中执行一条命令；保留工作目录、合并 stdout/stderr、带超时。
// 返回输出、退出码、新的工作目录。
func runRemoteCmd(ctx context.Context, client *ssh.Client, workDir, command string, timeout time.Duration) (string, int, string) {
	sess, err := client.NewSession()
	if err != nil {
		return "会话创建失败: " + err.Error(), -1, workDir
	}
	defer sess.Close()

	cdPart := ""
	if strings.TrimSpace(workDir) != "" {
		cdPart = "cd " + shSingleQuote(workDir) + " 2>/dev/null; "
	}
	// 末尾打印 pwd 标记以跟踪工作目录；exit 透传命令退出码
	wrapped := cdPart + "{ " + command + " ; }; __ec=$?; printf '\\n" + agentCwdMarker + "%s\\n' \"$(pwd)\"; exit $__ec"

	type result struct {
		out []byte
		err error
	}
	ch := make(chan result, 1)
	go func() {
		out, e := sess.CombinedOutput(wrapped)
		ch <- result{out, e}
	}()

	select {
	case r := <-ch:
		exitCode := 0
		if r.err != nil {
			if ee, ok := r.err.(*ssh.ExitError); ok {
				exitCode = ee.ExitStatus()
			} else {
				exitCode = -1
			}
		}
		out := string(r.out)
		newWorkDir := workDir
		if idx := strings.LastIndex(out, agentCwdMarker); idx >= 0 {
			tail := strings.TrimSpace(out[idx+len(agentCwdMarker):])
			if nl := strings.IndexAny(tail, "\r\n"); nl >= 0 {
				tail = tail[:nl]
			}
			if tail != "" {
				newWorkDir = tail
			}
			out = strings.TrimRight(out[:idx], "\r\n")
		}
		return out, exitCode, newWorkDir
	case <-ctx.Done():
		_ = sess.Signal(ssh.SIGKILL)
		_ = sess.Close()
		return "■ 已被用户停止", -1, workDir
	case <-time.After(timeout):
		_ = sess.Signal(ssh.SIGKILL)
		_ = sess.Close()
		return fmt.Sprintf("⏱ 命令执行超时（>%s），已终止", timeout), -1, workDir
	}
}

// parseAgentAction 从模型回复中解析结构化动作；无法解析时退化为「完成 + 文本总结」
func parseAgentAction(s string) agentAction {
	i := strings.Index(s, "{")
	j := strings.LastIndex(s, "}")
	if i >= 0 && j > i {
		var a agentAction
		if json.Unmarshal([]byte(s[i:j+1]), &a) == nil {
			a.Command = cleanCommand(a.Command)
			return a
		}
	}
	return agentAction{Done: true, Summary: strings.TrimSpace(s)}
}

// callOpenAIMessages 带完整消息历史的 OpenAI 兼容调用（多轮上下文，支持 ctx 取消）
func callOpenAIMessages(ctx context.Context, baseURL, apiKey, model string, messages []chatMsg, maxTokens int) (string, error) {
	url := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if !strings.HasSuffix(url, "/chat/completions") {
		url += "/chat/completions"
	}
	msgs := make([]map[string]string, 0, len(messages))
	for _, m := range messages {
		msgs = append(msgs, map[string]string{"role": m.Role, "content": m.Content})
	}
	payload := map[string]interface{}{
		"model":       model,
		"messages":    msgs,
		"temperature": 0.2,
		"max_tokens":  maxTokens,
		"stream":      false,
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("接口返回 %d: %s", resp.StatusCode, truncateStr(string(respBody), 300))
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", fmt.Errorf("解析返回失败: %v", err)
	}
	if len(parsed.Choices) == 0 {
		return "", fmt.Errorf("接口未返回内容")
	}
	return parsed.Choices[0].Message.Content, nil
}

func agentSystemPrompt(osHint string) string {
	return fmt.Sprintf(`你是一名资深 Linux 运维工程师，通过 SSH 在「%s」主机上执行命令，以「观察→决策→执行」的循环逐步完成用户交代的任务。每次只做一步。

每一步只回复一个 JSON 对象（不要 markdown、不要反引号、不要任何多余文字），二选一：
- 执行命令：{"thought":"你的判断与本步目的","command":"单条 shell 命令","done":false}
- 任务完成：{"thought":"...","command":"","done":true,"summary":"向用户汇报结果与关键数据（可核对）"}

工作准则：
1) 先观察后动手：做任何修改/删除/重启前，先用只读命令确认现状（如 ls -lh、cat、df -h、systemctl status、ss -tlnp），核实路径、文件是否存在、影响范围，再决定下一步——绝不基于猜测直接动手。
2) 命令精确且自包含：用绝对路径或基于「当前目录」（每步回执会告诉你 pwd）；可用管道与 &&；必须非交互式——不要用 vim/nano/top/less/man 等交互程序，分页器加 | cat，包管理与确认一律加 -y / -f。
3) 状态规则：每条命令在独立 shell 顺序执行，工作目录(cd)会保留并在回执中回报当前目录；环境变量(export)不保留，需要时用 && 串联。
4) 严格依据真实回执：我会回传每条命令的退出码、当前目录与真实输出；命令失败(退出码≠0)时先读输出诊断原因再调整，不要重复同一条失败命令，也不要臆测输出。
5) 破坏性/高危命令（删除、清空、重启服务、改权限等）会被系统拦截并请用户确认后才执行；因此请先用只读命令把要处理的目标列清楚，再给出精确的高危命令。
6) 高效收敛：步数上限 %d 步；目标达成立即 done，并在 summary 里给出可核对的结论（处理了什么、释放/变更了多少）。`, osHint, maxAgentSteps)
}

// runLoop 执行 Agent 推理-执行循环，直至：完成 / 命中高危待确认 / 出错 / 达步数上限。
// 若 s.Pending 非空，表示用户已确认上一条高危命令，先执行它再继续。
func (s *agentSession) runLoop() {
	db := store.GlobalDB
	baseURL := getSettingValue(db, "ai_base_url", "")
	apiKey := getSettingValue(db, "ai_api_key", "")
	aiModel := getSettingValue(db, "ai_model", "")

	// 建立可取消的上下文：/stop 调用 s.cancel() 即可中止在途 LLM/SSH 调用
	ctx, cancel := context.WithCancel(context.Background())
	s.cancelMu.Lock()
	s.stopRequest = false
	s.cancel = cancel
	s.cancelMu.Unlock()
	defer func() {
		s.cancelMu.Lock()
		s.cancel = nil
		s.cancelMu.Unlock()
		cancel()
	}()

	markStopped := func() {
		s.Status = "aborted"
		s.Summary = "已停止：用户中止了任务。可继续追加指令或新建对话。"
	}

	client, err := dialSSHForAsset(&s.Asset, &s.Cred)
	if err != nil {
		if s.stopped() {
			markStopped()
			return
		}
		s.Status = "error"
		s.LastErr = "SSH 连接失败: " + err.Error()
		return
	}
	defer client.Close()

	s.Status = "running"
	for len(s.Steps) < maxAgentSteps {
		if s.stopped() {
			markStopped()
			return
		}
		var action agentAction

		if s.Pending != "" {
			// 用户已确认的高危命令：直接执行，跳过模型与高危门
			action = agentAction{Command: s.Pending, Thought: s.PendingNote}
			s.Pending = ""
			s.PendingNote = ""
			s.PendingWarn = ""
		} else {
			reply, err := callOpenAIMessages(ctx, baseURL, apiKey, aiModel, s.Messages, agentMaxTokens)
			if s.stopped() {
				markStopped()
				return
			}
			if err != nil {
				s.Status = "error"
				s.LastErr = "AI 调用失败: " + err.Error()
				return
			}
			s.Messages = append(s.Messages, chatMsg{Role: "assistant", Content: reply})
			action = parseAgentAction(reply)

			if action.Done || strings.TrimSpace(action.Command) == "" {
				s.Status = "done"
				s.Summary = strings.TrimSpace(action.Summary)
				if s.Summary == "" {
					s.Summary = strings.TrimSpace(action.Thought)
				}
				return
			}

			if dangerous, warning := checkDangerousCommand(action.Command); dangerous {
				s.Status = "awaiting_confirm"
				s.Pending = action.Command
				s.PendingNote = action.Thought
				s.PendingWarn = warning
				return
			}
		}

		// 执行命令
		out, code, newWD := runRemoteCmd(ctx, client, s.WorkDir, action.Command, agentCmdTimeout)
		if s.stopped() {
			markStopped()
			return
		}
		s.WorkDir = newWD
		danger, _ := checkDangerousCommand(action.Command)
		s.Steps = append(s.Steps, agentStepRec{
			Index:     len(s.Steps) + 1,
			Thought:   action.Thought,
			Command:   action.Command,
			Output:    truncateStr(out, agentStoreLimit),
			ExitCode:  code,
			Dangerous: danger,
		})

		// 审计每条实际执行的命令
		db.Create(&model.AuditLog{
			Actor:  s.Actor,
			Action: "AI_AGENT",
			Path:   fmt.Sprintf("资产#%d: %s (exit=%d)", s.Asset.ID, action.Command, code),
			Status: 200,
			IP:     s.IP,
		})

		// 把执行结果回传给模型推进下一步（含当前目录，便于其跟踪状态）
		obs := fmt.Sprintf("退出码 %d ｜ 当前目录 %s\n输出:\n%s", code, s.WorkDir, truncateStr(out, agentFeedLimit))
		s.Messages = append(s.Messages, chatMsg{Role: "user", Content: obs})
	}

	// 达到步数上限
	s.Status = "done"
	if s.Summary == "" {
		s.Summary = fmt.Sprintf("已达到最大步数上限（%d 步），任务可能尚未完成，请检查执行记录或继续追加指令。", maxAgentSteps)
	}
}

// agentStateResp 序列化会话状态返回前端
func agentStateResp(s *agentSession) gin.H {
	return gin.H{
		"session_id":      s.ID,
		"status":          s.Status,
		"steps":           s.Steps,
		"pending":         s.Pending,
		"pending_note":    s.PendingNote,
		"pending_warning": s.PendingWarn,
		"summary":         s.Summary,
		"error":           s.LastErr,
		"work_dir":        s.WorkDir,
	}
}

// StartAgent 启动一次 Agent 任务（一句话 → 自动执行）
func StartAgent(c *gin.Context) {
	db := store.GlobalDB
	var req struct {
		AssetID   uint   `json:"asset_id"`
		Prompt    string `json:"prompt"`
		SessionID string `json:"session_id"` // 前端预生成，便于首轮即可调用 /stop
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, "参数格式错误")
		return
	}
	req.Prompt = strings.TrimSpace(req.Prompt)
	if req.Prompt == "" {
		SendError(c, 400, "请输入任务描述")
		return
	}
	if getSettingValue(db, "ai_enabled", "false") != "true" {
		SendError(c, 400, "AI 命令助手未启用，请联系管理员在系统设置中开启并配置")
		return
	}
	if getSettingValue(db, "ai_base_url", "") == "" || getSettingValue(db, "ai_api_key", "") == "" || getSettingValue(db, "ai_model", "") == "" {
		SendError(c, 400, "AI 配置不完整（需 base_url / api_key / model）")
		return
	}
	if req.AssetID == 0 {
		SendError(c, 400, "请先选择要操作的资产")
		return
	}

	var asset model.Asset
	if err := db.First(&asset, req.AssetID).Error; err != nil {
		SendError(c, 404, "资产不存在")
		return
	}
	if !canAccess(c, asset.OwnerID) {
		SendError(c, 403, "无权操作该资产")
		return
	}
	if asset.CredentialID == nil {
		SendError(c, 400, "请先为该资产绑定 SSH 凭据")
		return
	}
	var cred model.Credential
	if err := db.First(&cred, *asset.CredentialID).Error; err != nil {
		SendError(c, 400, "关联凭据不存在")
		return
	}
	if cred.Type == "telnet" {
		SendError(c, 400, "Telnet 资产不支持 Agent 自动执行（仅 SSH）")
		return
	}

	osHint := "Linux"
	if asset.OSVersion != "" {
		osHint = asset.OSVersion
	}

	// 优先使用前端预生成的 session_id（格式校验 + 防撞内存中会话）；否则后端生成
	sid := strings.TrimSpace(req.SessionID)
	if !strings.HasPrefix(sid, "agent-") || len(sid) < 8 || len(sid) > 80 || getAgentSession(sid) != nil {
		sid = newSessionID()
	}

	s := &agentSession{
		ID:          sid,
		RequesterID: currentUserID(c),
		Actor:       currentUsername(c),
		IP:          c.ClientIP(),
		Title:       truncateStr(req.Prompt, 80),
		Asset:       asset,
		Cred:        cred,
		OSHint:      osHint,
		LastUsed:    time.Now(),
		Messages: []chatMsg{
			{Role: "system", Content: agentSystemPrompt(osHint)},
			{Role: "user", Content: "任务：" + req.Prompt},
		},
	}

	// 审计任务启动
	db.Create(&model.AuditLog{
		Actor:  s.Actor,
		Action: "AI_AGENT_START",
		Path:   fmt.Sprintf("资产#%d: %s", asset.ID, req.Prompt),
		Status: 200,
		IP:     s.IP,
	})

	agentMu.Lock()
	sweepAgentSessions()
	agentSessions[s.ID] = s
	agentMu.Unlock()

	s.mu.Lock()
	s.runLoop()
	s.LastUsed = time.Now()
	persistSession(s)
	resp := agentStateResp(s)
	s.mu.Unlock()

	SendSuccess(c, resp)
}

// ContinueAgent 对高危命令做确认/中止
func ContinueAgent(c *gin.Context) {
	var req struct {
		SessionID string `json:"session_id"`
		Approve   bool   `json:"approve"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, "参数格式错误")
		return
	}
	s := getAgentSession(req.SessionID)
	if s == nil {
		SendError(c, 404, "会话不存在或已过期，请重新发起")
		return
	}
	if s.RequesterID != currentUserID(c) && !isAdmin(c) {
		SendError(c, 403, "无权操作该会话")
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.Actor = currentUsername(c) // 刷新审计主体（DB 加载的会话 Actor 为空）
	s.IP = c.ClientIP()

	if s.Status != "awaiting_confirm" || s.Pending == "" {
		SendSuccess(c, agentStateResp(s))
		return
	}

	if req.Approve {
		// 审计用户对高危命令的放行
		store.GlobalDB.Create(&model.AuditLog{
			Actor:  s.Actor,
			Action: "AI_AGENT_CONFIRM",
			Path:   fmt.Sprintf("资产#%d: %s", s.Asset.ID, s.Pending),
			Status: 200,
			IP:     c.ClientIP(),
		})
		s.runLoop() // s.Pending 非空 → 先执行该命令再继续
	} else {
		note := "用户拒绝执行高危命令「" + s.Pending + "」并中止本步。"
		s.Pending = ""
		s.PendingNote = ""
		s.PendingWarn = ""
		s.Status = "aborted"
		s.Summary = "已中止：用户拒绝执行高危命令。可继续追加指令换一种方式。"
		s.Messages = append(s.Messages, chatMsg{Role: "user", Content: note})
	}
	s.LastUsed = time.Now()
	persistSession(s)
	SendSuccess(c, agentStateResp(s))
}

// MessageAgent 多轮追加指令（带完整上下文记忆，继续推进）
func MessageAgent(c *gin.Context) {
	var req struct {
		SessionID string `json:"session_id"`
		Prompt    string `json:"prompt"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, "参数格式错误")
		return
	}
	req.Prompt = strings.TrimSpace(req.Prompt)
	if req.Prompt == "" {
		SendError(c, 400, "请输入追加指令")
		return
	}
	s := getAgentSession(req.SessionID)
	if s == nil {
		SendError(c, 404, "会话不存在或已过期，请重新发起")
		return
	}
	if s.RequesterID != currentUserID(c) && !isAdmin(c) {
		SendError(c, 403, "无权操作该会话")
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.Actor = currentUsername(c) // 刷新审计主体（DB 加载的会话 Actor 为空）
	s.IP = c.ClientIP()

	// 追加指令视为新一轮意图：清空挂起的高危命令，让模型重新决策
	s.Pending = ""
	s.PendingNote = ""
	s.PendingWarn = ""
	s.Summary = ""
	s.LastErr = ""
	s.Messages = append(s.Messages, chatMsg{Role: "user", Content: "补充指令：" + req.Prompt})

	store.GlobalDB.Create(&model.AuditLog{
		Actor:  s.Actor,
		Action: "AI_AGENT_MSG",
		Path:   fmt.Sprintf("资产#%d: %s", s.Asset.ID, req.Prompt),
		Status: 200,
		IP:     c.ClientIP(),
	})

	s.runLoop()
	s.LastUsed = time.Now()
	persistSession(s)
	SendSuccess(c, agentStateResp(s))
}

// StopAgent 立即中止运行中的 Agent 任务（误操作后停止）：取消在途 LLM/SSH 调用，
// runLoop 在下一个检查点收尾为 aborted。无需 s.mu，运行中也能即时生效。
func StopAgent(c *gin.Context) {
	var req struct {
		SessionID string `json:"session_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, "参数格式错误")
		return
	}
	s := getAgentSession(req.SessionID)
	if s == nil {
		SendError(c, 404, "会话不存在或已结束")
		return
	}
	if s.RequesterID != currentUserID(c) && !isAdmin(c) {
		SendError(c, 403, "无权操作该会话")
		return
	}
	s.requestStop()
	SendSuccess(c, gin.H{"ok": true})
}

// ListAgentSessions 当前用户的历史 Agent 会话（最近在前，供前端切换历史对话）
func ListAgentSessions(c *gin.Context) {
	var recs []model.AgentSession
	store.GlobalDB.
		Where("requester_id = ?", currentUserID(c)).
		Order("updated_at desc").
		Limit(50).
		Find(&recs)
	out := make([]gin.H, 0, len(recs))
	for _, r := range recs {
		out = append(out, gin.H{
			"session_id": r.ID,
			"asset_id":   r.AssetID,
			"asset_name": r.AssetName,
			"title":      r.Title,
			"status":     r.Status,
			"summary":    r.Summary,
			"updated_at": r.UpdatedAt,
		})
	}
	SendSuccess(c, out)
}

// GetAgentSessionDetail 读取单个历史会话完整状态（含步骤），供前端载入查看/继续
func GetAgentSessionDetail(c *gin.Context) {
	s := getAgentSession(c.Param("id"))
	if s == nil {
		SendError(c, 404, "会话不存在")
		return
	}
	if s.RequesterID != currentUserID(c) && !isAdmin(c) {
		SendError(c, 403, "无权访问该会话")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	SendSuccess(c, agentStateResp(s))
}
