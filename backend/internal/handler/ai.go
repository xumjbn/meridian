package handler

import (
	"bytes"
	"encoding/json"
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

// ==========================================
// AI 命令助手 — 自然语言转 shell 命令（OpenAI 兼容）
// 安全：仅生成不自动执行；高危命令标记；归属校验；全程审计
// ==========================================

// 高危/破坏性命令模式（命中则标记 dangerous，前端二次确认）
var dangerousCmdPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\brm\s+-[a-z]*r[a-z]*f`),     // rm -rf / rm -fr
	regexp.MustCompile(`(?i)\brm\s+-[a-z]*f[a-z]*r`),
	regexp.MustCompile(`(?i)\bmkfs(\.\w+)?\b`),           // 格式化
	regexp.MustCompile(`(?i)\bdd\b.*\bof=/dev/`),         // dd 覆写设备
	regexp.MustCompile(`(?i)>\s*/dev/(sd|nvme|hd)`),      // 覆写磁盘设备
	regexp.MustCompile(`:\s*\(\s*\)\s*\{`),               // fork 炸弹
	regexp.MustCompile(`(?i)\b(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b`),
	regexp.MustCompile(`(?i)\bchmod\s+-R\s+0*777\s+/`),
	regexp.MustCompile(`(?i)\bchown\s+-R\s+\S+\s+/\s*$`),
	regexp.MustCompile(`(?i)>\s*/etc/(passwd|shadow|sudoers)`),
	regexp.MustCompile(`(?i)\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b`), // 远程脚本直接执行
	regexp.MustCompile(`(?i)\brm\s+-rf\s+(/|/\*|~|\$HOME)\s*$`),
	regexp.MustCompile(`(?i)\btruncate\s+-s\s*0\s+/`),
}

func checkDangerousCommand(cmd string) (bool, string) {
	for _, re := range dangerousCmdPatterns {
		if re.MatchString(cmd) {
			return true, "⚠️ 检测到潜在高危/破坏性操作，执行前请务必人工核对"
		}
	}
	return false, ""
}

// cleanCommand 清洗模型输出：去掉 markdown 代码块/反引号，取首条非空命令行
func cleanCommand(s string) string {
	s = strings.TrimSpace(s)
	for _, fence := range []string{"```bash", "```shell", "```sh", "```console", "```"} {
		s = strings.TrimPrefix(s, fence)
	}
	s = strings.TrimSuffix(s, "```")
	s = strings.TrimSpace(s)
	s = strings.Trim(s, "`")
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		// 跳过模型可能附带的提示行
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		return line
	}
	return ""
}

func truncateStr(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// callOpenAICompatible 调用 OpenAI 兼容 /chat/completions 接口
func callOpenAICompatible(baseURL, apiKey, model, systemPrompt, userPrompt string) (string, error) {
	url := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if !strings.HasSuffix(url, "/chat/completions") {
		url += "/chat/completions"
	}
	payload := map[string]interface{}{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userPrompt},
		},
		"temperature": 0.2,
		"max_tokens":  400,
		"stream":      false,
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 30 * time.Second}
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

type aiCommandReq struct {
	Prompt  string `json:"prompt"`
	AssetID uint   `json:"asset_id"`
}

// GenerateCommand 自然语言生成 shell 命令（不执行）
func GenerateCommand(c *gin.Context) {
	db := store.GlobalDB
	var req aiCommandReq
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, "参数格式错误")
		return
	}
	req.Prompt = strings.TrimSpace(req.Prompt)
	if req.Prompt == "" {
		SendError(c, 400, "请输入需求描述")
		return
	}

	if getSettingValue(db, "ai_enabled", "false") != "true" {
		SendError(c, 400, "AI 命令助手未启用，请联系管理员在系统设置中开启并配置")
		return
	}
	baseURL := getSettingValue(db, "ai_base_url", "")
	apiKey := getSettingValue(db, "ai_api_key", "")
	aiModel := getSettingValue(db, "ai_model", "")
	if baseURL == "" || apiKey == "" || aiModel == "" {
		SendError(c, 400, "AI 配置不完整（需 base_url / api_key / model）")
		return
	}

	// 资产上下文 + 归属校验（只能对自己有权的资产生成）
	osHint := "Linux"
	if req.AssetID > 0 {
		var asset model.Asset
		if err := db.First(&asset, req.AssetID).Error; err == nil {
			if !canAccess(c, asset.OwnerID) {
				SendError(c, 403, "无权访问该资产")
				return
			}
			if asset.OSVersion != "" {
				osHint = asset.OSVersion
			}
		}
	}

	sysPrompt := fmt.Sprintf("你是一名严谨的运维命令助手。用户用自然语言描述需求，你只输出一条可直接在 %s 主机 shell 中执行的命令。要求：1) 只输出命令本身，不要任何解释、不要 markdown 代码块、不要反引号；2) 只输出一行；3) 优先选择安全、只读或低风险的实现；4) 若需求会造成破坏或不明确，输出尽量安全的等价命令。", osHint)

	out, err := callOpenAICompatible(baseURL, apiKey, aiModel, sysPrompt, req.Prompt)
	if err != nil {
		SendError(c, 502, "AI 调用失败: "+err.Error())
		return
	}
	command := cleanCommand(out)
	if command == "" {
		SendError(c, 502, "AI 未返回有效命令")
		return
	}

	dangerous, warning := checkDangerousCommand(command)

	// 审计：记录谁、对哪台资产、生成了什么命令
	db.Create(&model.AuditLog{
		Actor:  currentUsername(c),
		Action: "AI_CMD",
		Path:   fmt.Sprintf("资产#%d: %s", req.AssetID, command),
		Status: 200,
		IP:     c.ClientIP(),
	})

	SendSuccess(c, gin.H{"command": command, "dangerous": dangerous, "warning": warning})
}

// GetAIStatus 仅返回 AI 助手是否启用（不含任何密钥），供前端决定是否展示入口
func GetAIStatus(c *gin.Context) {
	enabled := getSettingValue(store.GlobalDB, "ai_enabled", "false") == "true" &&
		getSettingValue(store.GlobalDB, "ai_base_url", "") != "" &&
		getSettingValue(store.GlobalDB, "ai_model", "") != ""
	SendSuccess(c, gin.H{"enabled": enabled})
}

// TestAI 管理员用当前编辑中的配置做一次连通性测试
func TestAI(c *gin.Context) {
	var req struct {
		BaseURL string `json:"base_url"`
		APIKey  string `json:"api_key"`
		Model   string `json:"model"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, "参数格式错误")
		return
	}
	if req.BaseURL == "" || req.APIKey == "" || req.Model == "" {
		SendError(c, 400, "请先填写 base_url / api_key / model")
		return
	}
	out, err := callOpenAICompatible(req.BaseURL, req.APIKey, req.Model,
		"你是一个测试助手，只输出一行命令。", "输出 echo hello 这条命令")
	if err != nil {
		SendError(c, 400, "连接失败: "+err.Error())
		return
	}
	SendSuccess(c, gin.H{"ok": true, "sample": cleanCommand(out)})
}
