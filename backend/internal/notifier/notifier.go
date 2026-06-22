package notifier

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"backend/internal/model"
	"backend/internal/store"
)

// ==========================================
// 告警通知 — 企业微信 / 钉钉群机器人 / 通用 Webhook
// ==========================================

// Config 通知配置（持久化于 system_settings）
type Config struct {
	Type   string // none | wecom | dingtalk | webhook
	URL    string
	OnScan bool // 扫描任务完成/失败时通知
}

func settingValue(key, def string) string {
	db := store.GlobalDB
	if db == nil {
		return def
	}
	var s model.SystemSetting
	if err := db.First(&s, "key = ?", key).Error; err == nil && s.Value != "" {
		return s.Value
	}
	return def
}

func loadConfig() Config {
	return Config{
		Type:   settingValue("notify_type", "none"),
		URL:    settingValue("notify_url", ""),
		OnScan: settingValue("notify_on_scan", "true") == "true",
	}
}

// ScanFinished 在扫描任务结束时调用（建议 go 协程异步），按配置推送结果
func ScanFinished(taskName, status, summary string) {
	cfg := loadConfig()
	if !cfg.OnScan {
		return
	}
	emoji, statusZh := "✅", "完成"
	if status == "failed" {
		emoji, statusZh = "❌", "失败"
	}
	title := fmt.Sprintf("%s 扫描任务%s", emoji, statusZh)
	text := fmt.Sprintf("任务：%s\n状态：%s\n%s", taskName, statusZh, summary)
	if err := dispatch(cfg.Type, cfg.URL, title, text); err != nil {
		log.Printf("notifier: 扫描通知发送失败: %v", err)
	}
}

// AssetStatusChanged 在资产在线状态切换时调用（受 notify_on_offline 控制）
func AssetStatusChanged(name, ip, newStatus string) {
	if settingValue("notify_on_offline", "true") != "true" {
		return
	}
	cfg := loadConfig()
	title, text := "✅ 资产恢复在线", fmt.Sprintf("资产：%s（%s）已恢复在线", name, ip)
	if newStatus == "offline" {
		title, text = "⚠️ 资产离线告警", fmt.Sprintf("资产：%s（%s）已离线", name, ip)
	}
	if err := dispatch(cfg.Type, cfg.URL, title, text); err != nil {
		log.Printf("notifier: 资产状态通知失败: %v", err)
	}
}

// SendTest 供「测试」按钮使用，使用显式配置并把错误返回给调用方
func SendTest(typ, url string) error {
	return dispatch(typ, url, "Meridian 测试通知", "这是一条来自 Meridian · 子午 的测试告警，配置已生效 🎉")
}

// dispatch 按渠道格式化并 POST 到 webhook
func dispatch(typ, url, title, text string) error {
	if typ == "" || typ == "none" {
		return fmt.Errorf("未启用通知渠道")
	}
	if url == "" {
		return fmt.Errorf("Webhook 地址为空")
	}

	var payload []byte
	switch typ {
	case "wecom": // 企业微信群机器人 markdown
		payload, _ = json.Marshal(map[string]interface{}{
			"msgtype":  "markdown",
			"markdown": map[string]string{"content": fmt.Sprintf("**%s**\n%s", title, text)},
		})
	case "dingtalk": // 钉钉群机器人 text
		payload, _ = json.Marshal(map[string]interface{}{
			"msgtype": "text",
			"text":    map[string]string{"content": fmt.Sprintf("%s\n%s", title, text)},
		})
	default: // 通用 webhook
		payload, _ = json.Marshal(map[string]string{"title": title, "text": text})
	}

	client := &http.Client{Timeout: 8 * time.Second}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("webhook 返回状态码 %d", resp.StatusCode)
	}
	return nil
}
