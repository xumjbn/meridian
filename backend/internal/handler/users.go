package handler

import (
	"strconv"
	"strings"

	"backend/internal/model"
	"backend/internal/store"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// ==========================================
// 用户管理 — 注册 / 列表 / 增删改 / 修改密码
// ==========================================

// hashPassword 生成 bcrypt 哈希（登录账户口令仅需校验，故单向加密存储）
func hashPassword(p string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(p), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// checkPassword 比对明文与 bcrypt 哈希
func checkPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}

// validateUsername / validatePassword 返回非空字符串表示校验未通过
func validateUsername(name string) string {
	n := len([]rune(name))
	if n < 3 || n > 32 {
		return "用户名长度需为 3–32 个字符"
	}
	return ""
}

func validatePassword(pw string) string {
	if len(pw) < 6 || len(pw) > 64 {
		return "密码长度需为 6–64 个字符"
	}
	return ""
}

func normalizeRole(role string) string {
	if role == "admin" {
		return "admin"
	}
	return "user"
}

// ── 注册（开放）──────────────────────────────────
type registerReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// Register 开放注册：任何人可创建一个普通用户（role=user, status=active）
func Register(c *gin.Context) {
	db := store.GlobalDB
	var req registerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, "参数格式错误")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	c.Set("audit_actor", req.Username) // 供审计中间件记录注册用户名
	if msg := validateUsername(req.Username); msg != "" {
		SendError(c, 400, msg)
		return
	}
	if msg := validatePassword(req.Password); msg != "" {
		SendError(c, 400, msg)
		return
	}

	var count int64
	db.Model(&model.User{}).Where("username = ?", req.Username).Count(&count)
	if count > 0 {
		SendError(c, 409, "用户名已存在")
		return
	}

	hash, err := hashPassword(req.Password)
	if err != nil {
		SendError(c, 500, "密码加密失败")
		return
	}
	u := model.User{Username: req.Username, Password: hash, Role: "user", Status: "active"}
	if err := db.Create(&u).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	logActivity(db, "user_registered", "新用户注册: "+u.Username, u.ID)
	SendSuccess(c, gin.H{"id": u.ID, "username": u.Username})
}

// ── 列表 ────────────────────────────────────────
// ListUsers 返回全部用户（Password 字段带 json:"-"，不会泄露哈希）
func ListUsers(c *gin.Context) {
	db := store.GlobalDB
	var users []model.User
	if err := db.Order("id asc").Find(&users).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	SendSuccess(c, users)
}

// ── 管理员新增 ───────────────────────────────────
type createUserReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

// CreateUser 管理员后台新增用户（可指定角色）
func CreateUser(c *gin.Context) {
	db := store.GlobalDB
	var req createUserReq
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, "参数格式错误")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if msg := validateUsername(req.Username); msg != "" {
		SendError(c, 400, msg)
		return
	}
	if msg := validatePassword(req.Password); msg != "" {
		SendError(c, 400, msg)
		return
	}

	var count int64
	db.Model(&model.User{}).Where("username = ?", req.Username).Count(&count)
	if count > 0 {
		SendError(c, 409, "用户名已存在")
		return
	}

	hash, err := hashPassword(req.Password)
	if err != nil {
		SendError(c, 500, "密码加密失败")
		return
	}
	u := model.User{Username: req.Username, Password: hash, Role: normalizeRole(req.Role), Status: "active"}
	if err := db.Create(&u).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	logActivity(db, "user_created", "新增用户: "+u.Username+"（"+u.Role+"）", u.ID)
	SendSuccess(c, gin.H{"id": u.ID, "username": u.Username, "role": u.Role})
}

// ── 管理员更新（改角色 / 启禁用 / 重置密码）──────────
type updateUserReq struct {
	Role     *string `json:"role"`
	Status   *string `json:"status"`
	Password *string `json:"password"` // 非空则重置密码
}

// UpdateUser 更新用户的角色、状态，或重置其密码
func UpdateUser(c *gin.Context) {
	db := store.GlobalDB
	id, _ := strconv.Atoi(c.Param("id"))

	var u model.User
	if err := db.First(&u, id).Error; err != nil {
		SendError(c, 404, "用户不存在")
		return
	}

	var req updateUserReq
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, "参数格式错误")
		return
	}

	updates := map[string]interface{}{}

	if req.Role != nil {
		newRole := normalizeRole(*req.Role)
		// 防止把最后一个管理员降级为普通用户
		if u.Role == "admin" && newRole != "admin" {
			var admins int64
			db.Model(&model.User{}).Where("role = ?", "admin").Count(&admins)
			if admins <= 1 {
				SendError(c, 400, "系统至少需保留一个管理员账号")
				return
			}
		}
		updates["role"] = newRole
	}

	if req.Status != nil {
		newStatus := *req.Status
		if newStatus != "active" && newStatus != "disabled" {
			SendError(c, 400, "状态值非法")
			return
		}
		// 防止禁用最后一个启用中的管理员
		if u.Role == "admin" && newStatus == "disabled" {
			var activeAdmins int64
			db.Model(&model.User{}).Where("role = ? AND status = ?", "admin", "active").Count(&activeAdmins)
			if activeAdmins <= 1 {
				SendError(c, 400, "不能禁用最后一个启用的管理员账号")
				return
			}
		}
		updates["status"] = newStatus
	}

	if req.Password != nil && *req.Password != "" {
		if msg := validatePassword(*req.Password); msg != "" {
			SendError(c, 400, msg)
			return
		}
		hash, err := hashPassword(*req.Password)
		if err != nil {
			SendError(c, 500, "密码加密失败")
			return
		}
		updates["password"] = hash
	}

	if len(updates) == 0 {
		SendError(c, 400, "没有需要更新的字段")
		return
	}

	if err := db.Model(&u).Updates(updates).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	// 禁用、改密或降级后，强制使该用户已有会话失效
	if _, ok := updates["password"]; ok {
		revokeUserSessions(u.Username)
	}
	if st, ok := updates["status"]; ok && st == "disabled" {
		revokeUserSessions(u.Username)
	}
	logActivity(db, "user_updated", "更新用户: "+u.Username, u.ID)
	SendSuccess(c, gin.H{"ok": true})
}

// ── 管理员删除 ───────────────────────────────────
// DeleteUser 删除用户（禁止删除最后一个管理员）
func DeleteUser(c *gin.Context) {
	db := store.GlobalDB
	id, _ := strconv.Atoi(c.Param("id"))

	var u model.User
	if err := db.First(&u, id).Error; err != nil {
		SendError(c, 404, "用户不存在")
		return
	}
	if u.Role == "admin" {
		var admins int64
		db.Model(&model.User{}).Where("role = ?", "admin").Count(&admins)
		if admins <= 1 {
			SendError(c, 400, "不能删除最后一个管理员账号")
			return
		}
	}
	if err := db.Delete(&u).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	revokeUserSessions(u.Username)
	logActivity(db, "user_deleted", "删除用户: "+u.Username, u.ID)
	SendSuccess(c, gin.H{"ok": true})
}

// ── 修改密码（用户本人）──────────────────────────
type changePasswordReq struct {
	Username    string `json:"username"`
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

// ChangePassword 校验原密码后更新为新密码
func ChangePassword(c *gin.Context) {
	db := store.GlobalDB
	var req changePasswordReq
	if err := c.ShouldBindJSON(&req); err != nil {
		SendError(c, 400, "参数格式错误")
		return
	}
	req.Username = strings.TrimSpace(req.Username)

	var u model.User
	if err := db.Where("username = ?", req.Username).First(&u).Error; err != nil {
		SendError(c, 404, "用户不存在")
		return
	}
	if !checkPassword(u.Password, req.OldPassword) {
		SendError(c, 400, "原密码错误")
		return
	}
	if msg := validatePassword(req.NewPassword); msg != "" {
		SendError(c, 400, msg)
		return
	}
	hash, err := hashPassword(req.NewPassword)
	if err != nil {
		SendError(c, 500, "密码加密失败")
		return
	}
	if err := db.Model(&u).Update("password", hash).Error; err != nil {
		SendError(c, 500, err.Error())
		return
	}
	logActivity(db, "user_password_changed", "用户修改密码: "+u.Username, u.ID)
	SendSuccess(c, gin.H{"ok": true})
}
