package sshproxy

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

// localPty 抽象本机伪终端：Unix 用 creack/pty，Windows 用 ConPTY，
// 各平台在 localpty_unix.go / localpty_windows.go 中实现 startLocalPty。
type localPty interface {
	Read(p []byte) (int, error)
	Write(p []byte) (int, error)
	Resize(cols, rows int) error
	Close() error
}

// ProxyLocal 把 WebSocket 桥接到运行后端的本机 Shell（本地终端）。
// 协议与 ProxyTerminal 完全一致：服务端→前端用 BinaryMessage 传输输出、
// TextMessage 传 status（message=="connected" 表示就绪）；前端→服务端用
// BinaryMessage 传键入、TextMessage 传 {type:"resize"|"ping"}。
func ProxyLocal(ws *websocket.Conn) {
	defer ws.Close()

	var writeMu sync.Mutex
	writeMessage := func(messageType int, data []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return ws.WriteMessage(messageType, data)
	}
	status := func(msg string) {
		b, _ := json.Marshal(WSMessage{Type: "status", Message: msg})
		_ = writeMessage(websocket.TextMessage, b)
	}

	status("正在启动本地终端...")

	lp, desc, err := startLocalPty(80, 24)
	if err != nil {
		status(fmt.Sprintf("启动本地终端失败: %v", err))
		return
	}

	var once sync.Once
	closeAll := func() {
		once.Do(func() {
			_ = lp.Close()
			ws.Close()
			log.Printf("LocalProxy: session closed (%s)", desc)
		})
	}
	defer closeAll()

	status(fmt.Sprintf("本地 Shell: %s", desc))
	status("connected")

	// 协程：PTY 输出 → WebSocket
	go func() {
		buf := make([]byte, 8192)
		for {
			n, err := lp.Read(buf)
			if n > 0 {
				if werr := writeMessage(websocket.BinaryMessage, buf[:n]); werr != nil {
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

	// 主协程：WebSocket → PTY（含 resize / ping 控制信令）
	for {
		mt, message, err := ws.ReadMessage()
		if err != nil {
			closeAll()
			return
		}
		if mt == websocket.BinaryMessage {
			if _, err := lp.Write(message); err != nil {
				closeAll()
				return
			}
		} else if mt == websocket.TextMessage {
			var msg WSMessage
			if err := json.Unmarshal(message, &msg); err == nil {
				if msg.Type == "resize" {
					_ = lp.Resize(msg.Cols, msg.Rows)
				} else if msg.Type == "ping" {
					pongMsg, _ := json.Marshal(WSMessage{Type: "pong", Message: "pong"})
					_ = writeMessage(websocket.TextMessage, pongMsg)
				}
			}
		}
	}
}
