package handler

import (
	"fmt"
	"io"
	"net"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	"backend/internal/model"
	"backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// ==========================================
// SFTP 文件传输 — 权限隔离 + 安全 + 全程审计
// ==========================================

// auditSftp 显式记录每一次 SFTP 操作（成功/失败/越权都记），含资产与远端路径
func auditSftp(c *gin.Context, assetID uint, action, remotePath string, status int) {
	store.GlobalDB.Create(&model.AuditLog{
		Actor:  currentUsername(c),
		Action: action, // LIST | DOWNLOAD | UPLOAD
		Path:   fmt.Sprintf("资产#%d:%s", assetID, remotePath),
		Status: status,
		IP:     c.ClientIP(),
	})
}

// resolveSFTPAsset 加载资产并完成权限与凭据校验；失败时已写审计与响应，返回 ok=false
func resolveSFTPAsset(c *gin.Context, action, remotePath string) (*model.Asset, *model.Credential, bool) {
	db := store.GlobalDB
	id, _ := strconv.Atoi(c.Param("id"))

	var asset model.Asset
	if err := db.First(&asset, id).Error; err != nil {
		auditSftp(c, uint(id), action, remotePath, 404)
		SendError(c, 404, "资产不存在")
		return nil, nil, false
	}
	// 权限隔离：仅资产归属者或管理员可访问
	if !canAccess(c, asset.OwnerID) {
		auditSftp(c, asset.ID, action, remotePath, 403)
		SendError(c, 403, "无权访问该资产的文件")
		return nil, nil, false
	}
	if asset.CredentialID == nil {
		auditSftp(c, asset.ID, action, remotePath, 400)
		SendError(c, 400, "请先为该资产绑定 SSH 凭据")
		return nil, nil, false
	}
	var cred model.Credential
	if err := db.First(&cred, *asset.CredentialID).Error; err != nil {
		auditSftp(c, asset.ID, action, remotePath, 400)
		SendError(c, 400, "关联凭据不存在")
		return nil, nil, false
	}
	if cred.Type == "telnet" {
		auditSftp(c, asset.ID, action, remotePath, 400)
		SendError(c, 400, "Telnet 资产不支持文件传输（仅 SSH）")
		return nil, nil, false
	}
	return &asset, &cred, true
}

// openSFTP 复用终端相同的 SSH 拨号方式（22 端口）建立 SFTP 客户端
func openSFTP(asset *model.Asset, cred *model.Credential) (*ssh.Client, *sftp.Client, error) {
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
			return nil, nil, fmt.Errorf("私钥解析失败: %v", err)
		}
		cfg.Auth = []ssh.AuthMethod{ssh.PublicKeys(signer)}
	} else {
		cfg.Auth = []ssh.AuthMethod{ssh.Password(cred.Password)}
	}

	client, err := ssh.Dial("tcp", net.JoinHostPort(asset.IP, "22"), cfg)
	if err != nil {
		return nil, nil, fmt.Errorf("SSH 连接失败: %v", err)
	}
	sc, err := sftp.NewClient(client)
	if err != nil {
		client.Close()
		return nil, nil, fmt.Errorf("SFTP 初始化失败: %v", err)
	}
	return client, sc, nil
}

type sftpEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	IsDir   bool   `json:"is_dir"`
	Mode    string `json:"mode"`
	ModTime int64  `json:"mod_time"`
}

// SftpList 列出远端目录内容
func SftpList(c *gin.Context) {
	reqPath := c.DefaultQuery("path", "")
	asset, cred, ok := resolveSFTPAsset(c, "LIST", reqPath)
	if !ok {
		return
	}

	sshc, sc, err := openSFTP(asset, cred)
	if err != nil {
		auditSftp(c, asset.ID, "LIST", reqPath, 400)
		SendError(c, 400, err.Error())
		return
	}
	defer sshc.Close()
	defer sc.Close()

	// 路径缺省解析到家目录
	if strings.TrimSpace(reqPath) == "" {
		if wd, err := sc.Getwd(); err == nil && wd != "" {
			reqPath = wd
		} else {
			reqPath = "/"
		}
	}

	infos, err := sc.ReadDir(reqPath)
	if err != nil {
		auditSftp(c, asset.ID, "LIST", reqPath, 400)
		SendError(c, 400, "读取目录失败: "+err.Error())
		return
	}

	entries := make([]sftpEntry, 0, len(infos))
	for _, fi := range infos {
		entries = append(entries, sftpEntry{
			Name:    fi.Name(),
			Path:    path.Join(reqPath, fi.Name()),
			Size:    fi.Size(),
			IsDir:   fi.IsDir(),
			Mode:    fi.Mode().String(),
			ModTime: fi.ModTime().Unix(),
		})
	}
	// 目录在前，再按名称排序
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return entries[i].Name < entries[j].Name
	})

	SendSuccess(c, gin.H{"path": reqPath, "entries": entries})
}

// SftpDownload 流式下载远端文件
func SftpDownload(c *gin.Context) {
	reqPath := c.Query("path")
	asset, cred, ok := resolveSFTPAsset(c, "DOWNLOAD", reqPath)
	if !ok {
		return
	}
	if strings.TrimSpace(reqPath) == "" {
		auditSftp(c, asset.ID, "DOWNLOAD", reqPath, 400)
		SendError(c, 400, "缺少文件路径")
		return
	}

	sshc, sc, err := openSFTP(asset, cred)
	if err != nil {
		auditSftp(c, asset.ID, "DOWNLOAD", reqPath, 400)
		SendError(c, 400, err.Error())
		return
	}
	defer sshc.Close()
	defer sc.Close()

	fi, err := sc.Stat(reqPath)
	if err != nil {
		auditSftp(c, asset.ID, "DOWNLOAD", reqPath, 400)
		SendError(c, 400, "文件不存在或不可读: "+err.Error())
		return
	}
	if fi.IsDir() {
		auditSftp(c, asset.ID, "DOWNLOAD", reqPath, 400)
		SendError(c, 400, "不能下载目录")
		return
	}

	f, err := sc.Open(reqPath)
	if err != nil {
		auditSftp(c, asset.ID, "DOWNLOAD", reqPath, 400)
		SendError(c, 400, "打开文件失败: "+err.Error())
		return
	}
	defer f.Close()

	// 审计：成功发起下载
	auditSftp(c, asset.ID, "DOWNLOAD", reqPath, 200)

	filename := sanitizeHeaderValue(path.Base(reqPath))
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Length", strconv.FormatInt(fi.Size(), 10))
	if _, err := io.Copy(c.Writer, f); err != nil {
		// 连接已写出部分内容，无法再改响应码，仅记录日志
		fmt.Printf("SftpDownload: stream error for asset#%d %s: %v\n", asset.ID, reqPath, err)
	}
}

// SftpUpload 流式上传文件到远端目录
func SftpUpload(c *gin.Context) {
	dir := c.PostForm("path")
	if strings.TrimSpace(dir) == "" {
		dir = "."
	}
	asset, cred, ok := resolveSFTPAsset(c, "UPLOAD", dir)
	if !ok {
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		auditSftp(c, asset.ID, "UPLOAD", dir, 400)
		SendError(c, 400, "请选择要上传的文件")
		return
	}
	src, err := fileHeader.Open()
	if err != nil {
		auditSftp(c, asset.ID, "UPLOAD", dir, 400)
		SendError(c, 400, "读取上传文件失败")
		return
	}
	defer src.Close()

	sshc, sc, err := openSFTP(asset, cred)
	if err != nil {
		auditSftp(c, asset.ID, "UPLOAD", dir, 400)
		SendError(c, 400, err.Error())
		return
	}
	defer sshc.Close()
	defer sc.Close()

	target := path.Join(dir, path.Base(fileHeader.Filename))
	dst, err := sc.Create(target)
	if err != nil {
		auditSftp(c, asset.ID, "UPLOAD", target, 400)
		SendError(c, 400, "创建远端文件失败: "+err.Error())
		return
	}
	defer dst.Close()

	n, err := io.Copy(dst, src)
	if err != nil {
		auditSftp(c, asset.ID, "UPLOAD", target, 500)
		SendError(c, 500, "上传失败: "+err.Error())
		return
	}

	auditSftp(c, asset.ID, "UPLOAD", target, 200)
	SendSuccess(c, gin.H{"path": target, "size": n})
}

// SftpMkdir 在远端创建目录（含父级）
func SftpMkdir(c *gin.Context) {
	var req struct {
		Path string `json:"path"`
	}
	_ = c.ShouldBindJSON(&req)
	req.Path = strings.TrimSpace(req.Path)

	asset, cred, ok := resolveSFTPAsset(c, "MKDIR", req.Path)
	if !ok {
		return
	}
	if req.Path == "" {
		auditSftp(c, asset.ID, "MKDIR", req.Path, 400)
		SendError(c, 400, "缺少目录路径")
		return
	}

	sshc, sc, err := openSFTP(asset, cred)
	if err != nil {
		auditSftp(c, asset.ID, "MKDIR", req.Path, 400)
		SendError(c, 400, err.Error())
		return
	}
	defer sshc.Close()
	defer sc.Close()

	if err := sc.MkdirAll(req.Path); err != nil {
		auditSftp(c, asset.ID, "MKDIR", req.Path, 400)
		SendError(c, 400, "创建目录失败: "+err.Error())
		return
	}
	auditSftp(c, asset.ID, "MKDIR", req.Path, 200)
	SendSuccess(c, gin.H{"ok": true, "path": req.Path})
}

// SftpRemove 删除远端文件或目录（目录递归删除）
func SftpRemove(c *gin.Context) {
	var req struct {
		Path string `json:"path"`
	}
	_ = c.ShouldBindJSON(&req)
	req.Path = strings.TrimSpace(req.Path)

	asset, cred, ok := resolveSFTPAsset(c, "DELETE", req.Path)
	if !ok {
		return
	}
	// 安全：禁止删除空路径或根目录
	if req.Path == "" || req.Path == "/" {
		auditSftp(c, asset.ID, "DELETE", req.Path, 400)
		SendError(c, 400, "路径非法，拒绝删除")
		return
	}

	sshc, sc, err := openSFTP(asset, cred)
	if err != nil {
		auditSftp(c, asset.ID, "DELETE", req.Path, 400)
		SendError(c, 400, err.Error())
		return
	}
	defer sshc.Close()
	defer sc.Close()

	fi, err := sc.Stat(req.Path)
	if err != nil {
		auditSftp(c, asset.ID, "DELETE", req.Path, 400)
		SendError(c, 400, "目标不存在: "+err.Error())
		return
	}
	if fi.IsDir() {
		err = sftpRemoveAll(sc, req.Path)
	} else {
		err = sc.Remove(req.Path)
	}
	if err != nil {
		auditSftp(c, asset.ID, "DELETE", req.Path, 500)
		SendError(c, 500, "删除失败: "+err.Error())
		return
	}
	auditSftp(c, asset.ID, "DELETE", req.Path, 200)
	SendSuccess(c, gin.H{"ok": true})
}

// SftpRename 重命名/移动远端文件或目录
func SftpRename(c *gin.Context) {
	var req struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	_ = c.ShouldBindJSON(&req)
	req.From = strings.TrimSpace(req.From)
	req.To = strings.TrimSpace(req.To)
	detail := req.From + " → " + req.To

	asset, cred, ok := resolveSFTPAsset(c, "RENAME", detail)
	if !ok {
		return
	}
	if req.From == "" || req.To == "" || req.From == "/" {
		auditSftp(c, asset.ID, "RENAME", detail, 400)
		SendError(c, 400, "源路径或目标路径非法")
		return
	}

	sshc, sc, err := openSFTP(asset, cred)
	if err != nil {
		auditSftp(c, asset.ID, "RENAME", detail, 400)
		SendError(c, 400, err.Error())
		return
	}
	defer sshc.Close()
	defer sc.Close()

	if err := sc.Rename(req.From, req.To); err != nil {
		auditSftp(c, asset.ID, "RENAME", detail, 400)
		SendError(c, 400, "重命名失败: "+err.Error())
		return
	}
	auditSftp(c, asset.ID, "RENAME", detail, 200)
	SendSuccess(c, gin.H{"ok": true, "path": req.To})
}

// sftpRemoveAll 递归删除目录及其内容
func sftpRemoveAll(sc *sftp.Client, p string) error {
	fi, err := sc.Stat(p)
	if err != nil {
		return err
	}
	if !fi.IsDir() {
		return sc.Remove(p)
	}
	entries, err := sc.ReadDir(p)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := sftpRemoveAll(sc, path.Join(p, e.Name())); err != nil {
			return err
		}
	}
	return sc.RemoveDirectory(p)
}

// sanitizeHeaderValue 去除可能导致响应头注入的字符
func sanitizeHeaderValue(s string) string {
	s = strings.ReplaceAll(s, "\r", "")
	s = strings.ReplaceAll(s, "\n", "")
	s = strings.ReplaceAll(s, "\"", "'")
	return s
}
