package handler

import (
	"backend/internal/notifier"
	"github.com/gin-gonic/gin"
)

// TestNotify 用当前编辑中的渠道配置发送一条测试通知
func TestNotify(c *gin.Context) {
	var req struct {
		Type string `json:"type"`
		URL  string `json:"url"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, "参数格式错误")
		return
	}
	if req.URL == "" {
		SendError(c, 400, "请先填写 Webhook 地址")
		return
	}
	if err := notifier.SendTest(req.Type, req.URL); err != nil {
		SendError(c, 400, "发送失败: "+err.Error())
		return
	}
	SendSuccess(c, gin.H{"ok": true})
}
