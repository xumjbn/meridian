package sshproxy

import (
	"encoding/json"
	"fmt"
	"net"
	"sync"
	"time"

	"backend/internal/model"
	"github.com/gorilla/websocket"
)

// Telnet 协议控制字节
const (
	tnIAC  = 255 // 命令开始
	tnDONT = 254
	tnDO   = 253
	tnWONT = 252
	tnWILL = 251
	tnSB   = 250 // 子协商开始
	tnSE   = 240 // 子协商结束
)

// ProxyTelnet 通过 WebSocket 代理到目标主机的 Telnet (23) 会话。
// 采用最简协商策略：对所有选项一律拒绝（DO->WONT, WILL->DONT），
// 并从输出流中剥离 IAC 命令字节，保证 xterm 看到干净的字符流。
func ProxyTelnet(ws *websocket.Conn, asset *model.Asset, cred *model.Credential) {
	defer ws.Close()

	var writeMu sync.Mutex
	wsWrite := func(mt int, data []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return ws.WriteMessage(mt, data)
	}
	status := func(msg string) {
		b, _ := json.Marshal(WSMessage{Type: "status", Message: msg})
		_ = wsWrite(websocket.TextMessage, b)
	}

	status("正在建立 Telnet 连接...")
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:23", asset.IP), 10*time.Second)
	if err != nil {
		status(fmt.Sprintf("Telnet 连接失败: %v", err))
		return
	}
	status("connected")

	// 任一方向出错都对称关闭两端，保证两个 goroutine 都能退出（避免 socket/goroutine 泄漏）
	var once sync.Once
	closeAll := func() {
		once.Do(func() {
			ws.Close()
			conn.Close()
		})
	}
	defer closeAll()

	_ = cred // Telnet 走交互式登录，凭据暂保留（可在终端内手动输入）

	// TCP -> WS（处理 IAC 协商并剥离命令字节）
	go func() {
		buf := make([]byte, 4096)
		for {
			n, rerr := conn.Read(buf)
			if n > 0 {
				out := filterTelnet(conn, buf[:n])
				if len(out) > 0 {
					if werr := wsWrite(websocket.BinaryMessage, out); werr != nil {
						closeAll()
						return
					}
				}
			}
			if rerr != nil {
				closeAll()
				return
			}
		}
	}()

	// WS -> TCP
	for {
		mt, message, rerr := ws.ReadMessage()
		if rerr != nil {
			closeAll()
			break
		}
		switch mt {
		case websocket.BinaryMessage:
			if _, werr := conn.Write(message); werr != nil {
				closeAll()
				return
			}
		case websocket.TextMessage:
			var msg WSMessage
			if json.Unmarshal(message, &msg) == nil && msg.Type == "ping" {
				pong, _ := json.Marshal(WSMessage{Type: "pong", Message: "pong"})
				_ = wsWrite(websocket.TextMessage, pong)
			}
			// Telnet 无窗口尺寸概念，忽略 resize
		}
	}
}

// filterTelnet 处理一段输入中的 IAC 协商：对收到的 DO/WILL 一律拒绝，
// 跳过子协商，并返回剥离了命令字节后的可显示数据。
func filterTelnet(conn net.Conn, data []byte) []byte {
	out := make([]byte, 0, len(data))
	i := 0
	for i < len(data) {
		b := data[i]
		if b != tnIAC {
			out = append(out, b)
			i++
			continue
		}
		// 遇到 IAC
		if i+1 >= len(data) {
			break // 命令不完整，丢弃尾部
		}
		cmd := data[i+1]
		switch cmd {
		case tnDO, tnWILL, tnDONT, tnWONT:
			if i+2 >= len(data) {
				i = len(data)
				break
			}
			opt := data[i+2]
			if cmd == tnDO {
				conn.Write([]byte{tnIAC, tnWONT, opt})
			} else if cmd == tnWILL {
				conn.Write([]byte{tnIAC, tnDONT, opt})
			}
			i += 3
		case tnSB:
			// 跳到 IAC SE
			j := i + 2
			for j+1 < len(data) && !(data[j] == tnIAC && data[j+1] == tnSE) {
				j++
			}
			i = j + 2
		case tnIAC:
			out = append(out, tnIAC) // 转义的 0xFF
			i += 2
		default:
			i += 2
		}
	}
	return out
}
