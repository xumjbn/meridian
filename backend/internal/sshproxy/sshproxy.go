package sshproxy

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"sync"
	"time"

	"backend/internal/model"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

// wsReadIdleTimeout 是 WebSocket 读空闲超时。前端每 15s 发一次心跳 ping，
// 超过该时长仍无任何帧到达即判定为半开连接（客户端休眠/掉线/被 kill），
// 由 ReadMessage 报错触发 closeAll，释放 SSH 会话、PTY 与协程，避免半开连接长期泄漏。
const wsReadIdleTimeout = 90 * time.Second

// WSMessage 定义前端发送的控制指令 JSON
type WSMessage struct {
	Type     string `json:"type"`                // auth_response, resize, status, ping
	Username string `json:"username,omitempty"`  // 临时输入的用户名
	Password string `json:"password,omitempty"`  // 临时输入的密码
	Cols     int    `json:"cols,omitempty"`      // 终端列数
	Rows     int    `json:"rows,omitempty"`      // 终端行数
	Message  string `json:"message,omitempty"`   // 状态消息
}

// ProxyTerminal 处理 WebSocket 与 目标主机的 SSH 终端代理
func ProxyTerminal(ws *websocket.Conn, asset *model.Asset, cred *model.Credential) {
	defer ws.Close()

	// 线程安全的 WebSocket 写入包装函数
	var writeMu sync.Mutex
	writeMessage := func(messageType int, data []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return ws.WriteMessage(messageType, data)
	}

	var username string
	var password string
	var privateKey string

	// 1. 获取凭据
	if cred != nil {
		username = cred.Username
		password = cred.Password
		privateKey = cred.PrivateKey
	}

	// 2. 如果资产没有关联凭据，提示前端输入
	if username == "" && password == "" && privateKey == "" {
		// 发送索要凭证请求
		reqMsg, _ := json.Marshal(WSMessage{
			Type:    "auth_request",
			Message: "该资产未关联凭证，请输入 SSH 登录信息",
		})
		_ = writeMessage(websocket.TextMessage, reqMsg)

		// 等待前端回复凭据
		for {
			mt, message, err := ws.ReadMessage()
			if err != nil {
				log.Printf("SSHProxy: read error waiting for auth: %v", err)
				return
			}
			if mt == websocket.TextMessage {
				var msg WSMessage
				if err := json.Unmarshal(message, &msg); err == nil && msg.Type == "auth_response" {
					username = msg.Username
					password = msg.Password
					break
				}
			}
		}
	}

	// 发送正在连接状态
	statusMsg, _ := json.Marshal(WSMessage{
		Type:    "status",
		Message: "正在建立远程 SSH 连接...",
	})
	_ = writeMessage(websocket.TextMessage, statusMsg)

	// 3. 建立 SSH 连接
	sshConfig := &ssh.ClientConfig{
		User:            username,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	if privateKey != "" {
		signer, err := ssh.ParsePrivateKey([]byte(privateKey))
		if err != nil {
			errStatus, _ := json.Marshal(WSMessage{
				Type:    "status",
				Message: fmt.Sprintf("解析私钥凭据失败: %v", err),
			})
			_ = writeMessage(websocket.TextMessage, errStatus)
			return
		}
		sshConfig.Auth = []ssh.AuthMethod{ssh.PublicKeys(signer)}
	} else {
		sshConfig.Auth = []ssh.AuthMethod{ssh.Password(password)}
	}

	sshClient, err := ssh.Dial("tcp", fmt.Sprintf("%s:%d", asset.IP, asset.ResolvedSSHPort()), sshConfig)
	if err != nil {
		errStatus, _ := json.Marshal(WSMessage{
			Type:    "status",
			Message: fmt.Sprintf("SSH 连接拨号失败: %v", err),
		})
		_ = writeMessage(websocket.TextMessage, errStatus)
		return
	}
	defer sshClient.Close()

	// 4. 创建 SSH 会话
	sshSession, err := sshClient.NewSession()
	if err != nil {
		errStatus, _ := json.Marshal(WSMessage{
			Type:    "status",
			Message: fmt.Sprintf("创建 SSH 会话失败: %v", err),
		})
		_ = writeMessage(websocket.TextMessage, errStatus)
		return
	}
	defer sshSession.Close()

	// 5. 请求分配 Pty 伪终端
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,     // 开启回显
		ssh.TTY_OP_ISPEED: 14400, // 输入速率
		ssh.TTY_OP_OSPEED: 14400, // 输出速率
	}
	if err := sshSession.RequestPty("xterm", 24, 80, modes); err != nil {
		errStatus, _ := json.Marshal(WSMessage{
			Type:    "status",
			Message: fmt.Sprintf("请求 PTY 失败: %v", err),
		})
		_ = writeMessage(websocket.TextMessage, errStatus)
		return
	}

	// 6. 获取输入输出流
	sshStdin, err := sshSession.StdinPipe()
	if err != nil {
		return
	}
	sshStdout, err := sshSession.StdoutPipe()
	if err != nil {
		return
	}
	sshStderr, err := sshSession.StderrPipe()
	if err != nil {
		return
	}

	// 6.5 强制远端 UTF-8 字符集：避免 macOS 等未设 LANG 的主机以 C/POSIX 区域设置
	// 输出多字节字符时乱码（如 ls 中文文件名）。需服务器 AcceptEnv LANG LC_*（macOS/多数 Linux 默认开）；
	// 不被接受时静默忽略，不影响连接。
	_ = sshSession.Setenv("LANG", "en_US.UTF-8")
	_ = sshSession.Setenv("LC_ALL", "en_US.UTF-8")

	// 7. 开启 Shell
	if err := sshSession.Shell(); err != nil {
		errStatus, _ := json.Marshal(WSMessage{
			Type:    "status",
			Message: fmt.Sprintf("启动 Shell 失败: %v", err),
		})
		_ = writeMessage(websocket.TextMessage, errStatus)
		return
	}

	// 通知前端已成功连接
	successMsg, _ := json.Marshal(WSMessage{
		Type:    "status",
		Message: "connected",
	})
	_ = writeMessage(websocket.TextMessage, successMsg)

	// 8. 开启双向管道代理
	var once sync.Once
	closeAll := func() {
		once.Do(func() {
			ws.Close()
			sshSession.Close()
			sshClient.Close()
			log.Printf("SSHProxy: Session for %s closed", asset.IP)
		})
	}

	// 协程 A: 将 SSH stdout 输出写入 WebSocket
	go func() {
		buf := make([]byte, 8192)
		for {
			n, err := sshStdout.Read(buf)
			if n > 0 {
				err = writeMessage(websocket.BinaryMessage, buf[:n])
				if err != nil {
					closeAll()
					return
				}
			}
			if err != nil {
				closeAll()
				return
			}
		}
	}()

	// 协程 B: 将 SSH stderr 输出写入 WebSocket
	go func() {
		buf := make([]byte, 8192)
		for {
			n, err := sshStderr.Read(buf)
			if n > 0 {
				err = writeMessage(websocket.BinaryMessage, buf[:n])
				if err != nil {
					closeAll()
					return
				}
			}
			if err != nil {
				closeAll()
				return
			}
		}
	}()

	// 主协程 (读循环): 处理来自 WebSocket 的输入与控制信令
	for {
		_ = ws.SetReadDeadline(time.Now().Add(wsReadIdleTimeout))
		mt, message, err := ws.ReadMessage()
		if err != nil {
			closeAll()
			break
		}

		if mt == websocket.BinaryMessage {
			// 收到键盘输入二进制字节流，直接写入 SSH 标准输入
			_, err = sshStdin.Write(message)
			if err != nil {
				closeAll()
				break
			}
		} else if mt == websocket.TextMessage {
			// 收到文本控制消息 (如 Resize 终端大小, 心跳 Ping)
			var msg WSMessage
			if err := json.Unmarshal(message, &msg); err == nil {
				if msg.Type == "resize" {
					_ = sshSession.WindowChange(msg.Rows, msg.Cols)
				} else if msg.Type == "ping" {
					// 收到前端心跳，写入 pong 回应以重置超时，同时保持连接活跃
					pongMsg, _ := json.Marshal(WSMessage{
						Type:    "pong",
						Message: "pong",
					})
					_ = writeMessage(websocket.TextMessage, pongMsg)
				}
			}
		}
	}
}

// WriteCloserWrapper 用于将 Stdin 包装为可写关闭的 io.WriteCloser
type WriteCloserWrapper struct {
	io.WriteCloser
}
