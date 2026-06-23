package handler

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"

	"backend/internal/model"
	"backend/internal/store"
	"github.com/gin-gonic/gin"
)

// ==========================================
// 审计日志 — 记录所有状态变更请求
// ==========================================

// bodyCaptureWriter 包装 gin 的 ResponseWriter 以截获响应体，用于解析业务 code
type bodyCaptureWriter struct {
	gin.ResponseWriter
	body *bytes.Buffer
}

func (w *bodyCaptureWriter) Write(b []byte) (int, error) {
	w.body.Write(b)
	return w.ResponseWriter.Write(b)
}

// AuditMiddleware 仅审计写操作（POST/PUT/DELETE），记录操作人/路径/结果/IP。
// 需挂在 api 组最外层（含 login/register），登录态由后续中间件或处理器注入。
func AuditMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		m := c.Request.Method
		if m != "POST" && m != "PUT" && m != "DELETE" {
			c.Next()
			return
		}
		// SFTP / AI 操作由各自处理器显式审计（含路径/命令明细），此处跳过避免重复记录
		if strings.Contains(c.Request.URL.Path, "/sftp/") || strings.Contains(c.Request.URL.Path, "/ai/") {
			c.Next()
			return
		}

		w := &bodyCaptureWriter{ResponseWriter: c.Writer, body: &bytes.Buffer{}}
		c.Writer = w
		c.Next()

		// 解析业务 code（应用统一以 HTTP 200 + body.code 返回）
		code := 0
		var parsed struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(w.body.Bytes(), &parsed); err == nil {
			code = parsed.Code
		}

		// 操作人：登录用户（AuthMiddleware 注入）优先，其次 login/register 处理器写入的尝试用户名
		actor := currentUsername(c)
		if actor == "" {
			actor = c.GetString("audit_actor")
		}

		store.GlobalDB.Create(&model.AuditLog{
			Actor:  actor,
			Action: m,
			Path:   c.Request.URL.Path,
			Status: code,
			IP:     c.ClientIP(),
		})
	}
}

// GetAuditLogs 返回审计日志（管理员），支持 actor 过滤与 limit
func GetAuditLogs(c *gin.Context) {
	db := store.GlobalDB
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "200"))
	if limit <= 0 || limit > 1000 {
		limit = 200
	}

	q := db.Model(&model.AuditLog{}).Order("id desc").Limit(limit)
	if actor := c.Query("actor"); actor != "" {
		q = q.Where("actor = ?", actor)
	}
	if action := c.Query("action"); action != "" {
		q = q.Where("action = ?", action)
	}

	var logs []model.AuditLog
	if err := q.Find(&logs).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	SendSuccess(c, logs)
}
