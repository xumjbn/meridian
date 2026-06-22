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
	UserID    uint
	Username  string
	Role      string
	ExpiresAt time.Time
}

var (
	sessionMu sync.RWMutex
	sessions  = map[string]session{}
)

// issueToken 生成随机会话 token 并登记
func issueToken(userID uint, username, role string) string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		// 极端情况下退化为基于时间的弱 token，仅为不 panic
		return hex.EncodeToString([]byte(time.Now().String()))
	}
	token := hex.EncodeToString(b)
	sessionMu.Lock()
	sessions[token] = session{UserID: userID, Username: username, Role: role, ExpiresAt: time.Now().Add(sessionTTL)}
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
		c.Set("user_id", s.UserID)
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

// ==========================================
// 登录失败锁定 — 连续失败 N 次锁定一段时间
// ==========================================

const (
	maxLoginFails   = 5
	loginLockWindow = 10 * time.Minute
)

type loginAttempt struct {
	fails       int
	lockedUntil time.Time
}

var (
	loginMu       sync.Mutex
	loginAttempts = map[string]*loginAttempt{}
)

// loginLocked 返回该用户名是否处于锁定中，以及剩余时长
func loginLocked(username string) (bool, time.Duration) {
	loginMu.Lock()
	defer loginMu.Unlock()
	a := loginAttempts[username]
	if a == nil {
		return false, 0
	}
	if !a.lockedUntil.IsZero() && time.Now().Before(a.lockedUntil) {
		return true, time.Until(a.lockedUntil)
	}
	// 锁定已过期：清零，给予新的尝试窗口
	if !a.lockedUntil.IsZero() {
		a.fails = 0
		a.lockedUntil = time.Time{}
	}
	return false, 0
}

// recordLoginFail 登记一次失败，达到阈值则锁定
func recordLoginFail(username string) {
	loginMu.Lock()
	defer loginMu.Unlock()
	a := loginAttempts[username]
	if a == nil {
		a = &loginAttempt{}
		loginAttempts[username] = a
	}
	a.fails++
	if a.fails >= maxLoginFails {
		a.lockedUntil = time.Now().Add(loginLockWindow)
	}
}

// resetLoginFails 登录成功后清除失败计数
func resetLoginFails(username string) {
	loginMu.Lock()
	delete(loginAttempts, username)
	loginMu.Unlock()
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

// currentUserID 读取当前登录用户ID（中间件已注入）
func currentUserID(c *gin.Context) uint {
	if v, ok := c.Get("user_id"); ok {
		if id, ok := v.(uint); ok {
			return id
		}
	}
	return 0
}

// isAdmin 当前会话是否为管理员
func isAdmin(c *gin.Context) bool {
	if v, ok := c.Get("role"); ok {
		return v == "admin"
	}
	return false
}

// canAccess 数据隔离判定：管理员可访问任意归属，普通用户仅限自己的记录
func canAccess(c *gin.Context, ownerID uint) bool {
	return isAdmin(c) || ownerID == currentUserID(c)
}

// Logout 注销当前会话
func Logout(c *gin.Context) {
	revokeToken(extractToken(c))
	SendSuccess(c, gin.H{"ok": true})
}
