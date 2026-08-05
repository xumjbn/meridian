package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"backend/internal/model"
	"backend/internal/store"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// ─────────────────────────────────────────────────────────────
// Pod exec 终端
//
// kube-apiserver 的 exec 端点原生支持 WebSocket 子协议 v4.channel.k8s.io：
// 每帧首字节是通道号，其余是负载。协议足够简单，用已有的 gorilla/websocket
// 作客户端即可，不必为此引入 client-go（依赖体量与本项目单二进制定位不符）。
//
//	0 → stdin    1 ← stdout    2 ← stderr    3 ← error(结束状态 JSON)    4 → resize
//
// 前端沿用现有终端协议（二进制=键盘输入，文本 JSON=resize/ping），
// 由本文件在两套协议之间转换，因此 TerminalPage 不需要为 K8s 单独写一套。
// ─────────────────────────────────────────────────────────────

const (
	k8sChanStdin  = 0
	k8sChanStdout = 1
	k8sChanStderr = 2
	k8sChanError  = 3
	k8sChanResize = 4
)

// k8sExecShellScript 交给容器执行的启动脚本。
//
// 用内联回退代替「先试 bash、失败再重连试 sh」的重试逻辑：
// 重试要靠解析 channel 3 的错误状态来判断，时序脆弱且容易误判；
// 而 /bin/sh 在能 exec 的镜像里基本都在，一条脚本就能可靠回退。
func k8sExecShellScript(preferred string) string {
	sh := strings.TrimSpace(preferred)
	if sh == "" {
		sh = "bash"
	}
	// 只允许简单的 shell 名，避免把用户输入原样拼进命令行
	if strings.ContainsAny(sh, " \t;|&$`'\"\\\n") {
		sh = "bash"
	}
	return fmt.Sprintf("if command -v %s >/dev/null 2>&1; then exec %s; else exec sh; fi", sh, sh)
}

// k8sTerminalSize 与 kube API 的 TerminalSize 对应（字段名大写开头）
type k8sTerminalSize struct {
	Width  uint16 `json:"Width"`
	Height uint16 `json:"Height"`
}

// dialK8sExec 与 apiserver 建立 exec WebSocket
func dialK8sExec(cl *model.K8sCluster, namespace, pod, container, shell string) (*websocket.Conn, error) {
	tlsCfg, err := kubeTLSConfig(cl)
	if err != nil {
		return nil, err
	}

	q := url.Values{}
	if container != "" {
		q.Set("container", container)
	}
	q.Set("stdin", "true")
	q.Set("stdout", "true")
	// tty 与 stderr 互斥：开了 TTY 就不能再单独要 stderr（会被 apiserver 拒绝），
	// 此时 stderr 本来就已并入 stdout。
	q.Set("tty", "true")
	q.Add("command", "/bin/sh")
	q.Add("command", "-c")
	q.Add("command", k8sExecShellScript(shell))

	u := fmt.Sprintf("wss://%s/api/v1/namespaces/%s/pods/%s/exec?%s",
		kubeAPIServer(cl), url.PathEscape(namespace), url.PathEscape(pod), q.Encode())

	header := http.Header{}
	if tok := kubeAuthHeader(cl); tok != "" {
		header.Set("Authorization", "Bearer "+tok)
	}
	dialer := &websocket.Dialer{
		TLSClientConfig:  tlsCfg,
		HandshakeTimeout: 10 * time.Second,
		Subprotocols:     []string{"v4.channel.k8s.io"},
	}
	conn, resp, err := dialer.Dial(u, header)
	if err != nil {
		if resp != nil {
			return nil, fmt.Errorf("apiserver 拒绝 exec（HTTP %d）：%v。常见原因是 ServiceAccount 缺少 pods/exec 权限", resp.StatusCode, err)
		}
		return nil, fmt.Errorf("连接 apiserver exec 失败: %v", err)
	}
	return conn, nil
}

// ConnectK8sExec 打开某个 Pod 容器的交互终端
func ConnectK8sExec(c *gin.Context) {
	cl, ok := loadClusterWithToken(c)
	if !ok {
		return
	}
	namespace := strings.TrimSpace(c.Query("namespace"))
	pod := strings.TrimSpace(c.Query("pod"))
	container := strings.TrimSpace(c.Query("container"))
	shell := strings.TrimSpace(c.Query("shell"))
	if namespace == "" || pod == "" {
		c.String(http.StatusBadRequest, "namespace 与 pod 必填")
		return
	}

	ws, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("ConnectK8sExec: WebSocket Upgrade failed: %v", err)
		return
	}
	defer ws.Close()

	// 浏览器侧的写必须串行：输出泵和状态提示会来自不同协程
	var wsWriteMu sync.Mutex
	writeWS := func(mt int, data []byte) error {
		wsWriteMu.Lock()
		defer wsWriteMu.Unlock()
		return ws.WriteMessage(mt, data)
	}
	notify := func(kind, msg string) {
		b, _ := json.Marshal(gin.H{"type": kind, "message": msg})
		_ = writeWS(websocket.TextMessage, b)
	}

	started := time.Now()
	store.GlobalDB.Create(&model.AuditLog{
		Actor: currentUsername(c), Action: "K8S_EXEC",
		Path:   fmt.Sprintf("集群#%d exec %s/%s 容器=%s", cl.ID, namespace, pod, container),
		Status: 200, IP: c.ClientIP(),
	})

	kc, err := dialK8sExec(cl, namespace, pod, container, shell)
	if err != nil {
		notify("status", err.Error())
		return
	}
	defer kc.Close()

	var closeOnce sync.Once
	closeAll := func() {
		closeOnce.Do(func() {
			kc.Close()
			ws.Close()
			store.GlobalDB.Create(&model.AuditLog{
				Actor: currentUsername(c), Action: "K8S_EXEC_END",
				Path: fmt.Sprintf("集群#%d exec %s/%s 结束，时长 %s",
					cl.ID, namespace, pod, time.Since(started).Truncate(time.Second)),
				Status: 200, IP: c.ClientIP(),
			})
		})
	}
	defer closeAll()

	// apiserver 侧的写也要串行（键盘输入与 resize 来自同一读循环，
	// 但心跳/关闭可能并发触发）
	var kcWriteMu sync.Mutex
	writeKube := func(channel byte, payload []byte) error {
		frame := make([]byte, 0, len(payload)+1)
		frame = append(frame, channel)
		frame = append(frame, payload...)
		kcWriteMu.Lock()
		defer kcWriteMu.Unlock()
		return kc.WriteMessage(websocket.BinaryMessage, frame)
	}

	// apiserver → 浏览器
	go func() {
		defer closeAll()
		for {
			_, data, err := kc.ReadMessage()
			if err != nil {
				return
			}
			if len(data) == 0 {
				continue
			}
			channel, payload := data[0], data[1:]
			switch channel {
			case k8sChanStdout, k8sChanStderr:
				if len(payload) > 0 {
					if err := writeWS(websocket.BinaryMessage, payload); err != nil {
						return
					}
				}
			case k8sChanError:
				// 结束状态：成功时 status=Success，失败时带 message。
				// 不吞掉——容器退出/命令不存在/权限不足都靠这条告诉用户。
				var st struct {
					Status  string `json:"status"`
					Message string `json:"message"`
					Reason  string `json:"reason"`
				}
				if err := json.Unmarshal(payload, &st); err == nil && st.Status != "Success" {
					msg := st.Message
					if msg == "" {
						msg = st.Reason
					}
					if msg != "" {
						notify("status", "会话结束: "+msg)
					}
				}
				return
			}
		}
	}()

	// 浏览器 → apiserver
	for {
		_ = ws.SetReadDeadline(time.Now().Add(wsExecIdleTimeout))
		mt, message, err := ws.ReadMessage()
		if err != nil {
			return
		}
		switch mt {
		case websocket.BinaryMessage:
			if err := writeKube(k8sChanStdin, message); err != nil {
				return
			}
		case websocket.TextMessage:
			var msg struct {
				Type string `json:"type"`
				Cols int    `json:"cols"`
				Rows int    `json:"rows"`
			}
			if err := json.Unmarshal(message, &msg); err != nil {
				continue
			}
			switch msg.Type {
			case "resize":
				b, _ := json.Marshal(k8sTerminalSize{Width: uint16(msg.Cols), Height: uint16(msg.Rows)})
				if err := writeKube(k8sChanResize, b); err != nil {
					return
				}
			case "ping":
				// 前端心跳：回 pong 以重置读超时，避免半开连接把 exec 会话挂死
				pong, _ := json.Marshal(gin.H{"type": "pong", "message": "pong"})
				if err := writeWS(websocket.TextMessage, pong); err != nil {
					return
				}
			}
		}
	}
}

// wsExecIdleTimeout 读空闲超时。前端每 15s 一次心跳，这里给足余量；
// 超时即认为连接已半开，收掉会话与协程。
const wsExecIdleTimeout = 90 * time.Second
