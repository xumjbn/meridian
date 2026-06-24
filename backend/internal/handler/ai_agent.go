package handler

import (
	"bytes"
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
		if s.LastUsed.Before(cutoff) {
			delete(agentSessions, id)
		}
	}
}

func getAgentSession(id string) *agentSession {
	agentMu.Lock()
	defer agentMu.Unlock()
	return agentSessions[id]
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
func runRemoteCmd(client *ssh.Client, workDir, command string, timeout time.Duration) (string, int, string) {
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

// callOpenAIMessages 带完整消息历史的 OpenAI 兼容调用（多轮上下文）
func callOpenAIMessages(baseURL, apiKey, model string, messages []chatMsg, maxTokens int) (string, error) {
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
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
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
	return fmt.Sprintf(`你是一名严谨的 Linux 运维自动化助手，通过 SSH 在「%s」主机上执行命令来逐步完成用户交代的运维任务。

你每一步必须只回复一个 JSON 对象（不要 markdown、不要多余文字、不要反引号），格式二选一：
- 需要执行命令时：{"thought":"一句话说明你的判断","command":"要执行的单条 shell 命令","done":false}
- 任务已完成时：{"thought":"...","command":"","done":true,"summary":"用一两句话向用户总结结果"}

规则：
1) command 必须是非交互式的单条命令（可用管道与 && 串联），不要使用 vim/nano/top/less 等需要交互的程序，包管理一律加 -y。
2) 每条命令在独立 shell 中按顺序执行：工作目录(cd)会被保留，但环境变量(export)不保留——需要时用 && 串联或使用绝对路径。
3) 我会把每条命令的退出码与真实输出回传给你，你必须据此判断下一步，不要臆造输出。
4) 优先采用只读/低风险方式；破坏性或高危操作仅在任务确需时使用（这类命令会被系统拦截并请用户二次确认）。
5) 尽量高效，步数有限（最多 %d 步）；任务达成后立即 done。`, osHint, maxAgentSteps)
}

// runLoop 执行 Agent 推理-执行循环，直至：完成 / 命中高危待确认 / 出错 / 达步数上限。
// 若 s.Pending 非空，表示用户已确认上一条高危命令，先执行它再继续。
func (s *agentSession) runLoop() {
	db := store.GlobalDB
	baseURL := getSettingValue(db, "ai_base_url", "")
	apiKey := getSettingValue(db, "ai_api_key", "")
	aiModel := getSettingValue(db, "ai_model", "")

	client, err := dialSSHForAsset(&s.Asset, &s.Cred)
	if err != nil {
		s.Status = "error"
		s.LastErr = "SSH 连接失败: " + err.Error()
		return
	}
	defer client.Close()

	s.Status = "running"
	for len(s.Steps) < maxAgentSteps {
		var action agentAction

		if s.Pending != "" {
			// 用户已确认的高危命令：直接执行，跳过模型与高危门
			action = agentAction{Command: s.Pending, Thought: s.PendingNote}
			s.Pending = ""
			s.PendingNote = ""
			s.PendingWarn = ""
		} else {
			reply, err := callOpenAIMessages(baseURL, apiKey, aiModel, s.Messages, agentMaxTokens)
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
		out, code, newWD := runRemoteCmd(client, s.WorkDir, action.Command, agentCmdTimeout)
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

		// 把执行结果回传给模型推进下一步
		obs := fmt.Sprintf("命令已执行，退出码 %d。输出如下：\n%s", code, truncateStr(out, agentFeedLimit))
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
		AssetID uint   `json:"asset_id"`
		Prompt  string `json:"prompt"`
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

	s := &agentSession{
		ID:          newSessionID(),
		RequesterID: currentUserID(c),
		Actor:       currentUsername(c),
		IP:          c.ClientIP(),
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
	SendSuccess(c, agentStateResp(s))
}
