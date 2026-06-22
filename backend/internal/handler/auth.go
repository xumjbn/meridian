package handler

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// ==========================================
// 会话与鉴权 — 真实 token + 中间件
// ==========================================
//
// 说明：会话保存在进程内存中（单实例内网工具，足够），后端重启后
// 需要重新登录。若需重启不掉线，可改为 DB 会话表或 HMAC 无状态 token。

const sessionTTL = 7 * 24 * time.Hour

type session struct {
	Username  string
	Role      string
	ExpiresAt time.Time
}

var (
	sessionMu sync.RWMutex
	sessions  = map[string]session{}
)

// issueToken 生成随机会话 token 并登记
func issueToken(username, role string) string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		// 极端情况下退化为基于时间的弱 token，仅为不 panic
		return hex.EncodeToString([]byte(time.Now().String()))
	}
	token := hex.EncodeToString(b)
	sessionMu.Lock()
	sessions[token] = session{Username: username, Role: role, ExpiresAt: time.Now().Add(sessionTTL)}
	sessionMu.Unlock()
	return token
}

// lookupSession 校验 token 并返回会话（过期则清除）
func lookupSession(token string) (session, bool) {
	if token == "" {
		return session{}, false
	}
	sessionMu.RLock()
	s, ok := sessions[token]
	sessionMu.RUnlock()
	if !ok {
		return session{}, false
	}
	if time.Now().After(s.ExpiresAt) {
		revokeToken(token)
		return session{}, false
	}
	return s, true
}

func revokeToken(token string) {
	sessionMu.Lock()
	delete(sessions, token)
	sessionMu.Unlock()
}

// revokeUserSessions 注销某用户的全部会话（禁用/删除/改密后调用）
func revokeUserSessions(username string) {
	sessionMu.Lock()
	for tok, s := range sessions {
		if s.Username == username {
			delete(sessions, tok)
		}
	}
	sessionMu.Unlock()
}

// extractToken 优先取 Authorization: Bearer，其次取 ?token=（供 WS/SSE 使用）
func extractToken(c *gin.Context) string {
	auth := c.GetHeader("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimSpace(auth[len("Bearer "):])
	}
	return c.Query("token")
}

// AuthMiddleware 校验会话，注入当前用户名/角色到上下文
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		s, ok := lookupSession(extractToken(c))
		if !ok {
			c.AbortWithStatusJSON(http.StatusOK, JSONResponse{Code: 401, Message: "未登录或会话已过期"})
			return
		}
		c.Set("username", s.Username)
		c.Set("role", s.Role)
		c.Next()
	}
}

// AdminMiddleware 要求当前会话角色为管理员
func AdminMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if role, _ := c.Get("role"); role != "admin" {
			c.AbortWithStatusJSON(http.StatusOK, JSONResponse{Code: 403, Message: "需要管理员权限"})
			return
		}
		c.Next()
	}
}

// currentUsername 读取当前登录用户名（中间件已注入）
func currentUsername(c *gin.Context) string {
	if v, ok := c.Get("username"); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// Logout 注销当前会话
func Logout(c *gin.Context) {
	revokeToken(extractToken(c))
	SendSuccess(c, gin.H{"ok": true})
}
