package handler

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"backend/internal/model"
	"backend/internal/store"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// ─────────────────────────────────────────────────────────────
// Pod 实时日志流
//
// 前端复用同一套 xterm 渲染，因此这里也走 WebSocket 而不是 SSE：
// 复用之后 Ctrl+F 屏幕搜索、滚动回看、ANSI 配色、字号缩放全部白拿，
// 而这几样恰好是看日志最需要的能力。
//
// 与 exec 不同，日志是单向流：浏览器只发心跳，不发键盘输入。
// ─────────────────────────────────────────────────────────────

// ConnectK8sLogs 打开某个 Pod 容器的日志流
func ConnectK8sLogs(c *gin.Context) {
	cl, ok := loadClusterWithToken(c)
	if !ok {
		return
	}
	namespace := strings.TrimSpace(c.Query("namespace"))
	pod := strings.TrimSpace(c.Query("pod"))
	container := strings.TrimSpace(c.Query("container"))
	if namespace == "" || pod == "" {
		c.String(http.StatusBadRequest, "namespace 与 pod 必填")
		return
	}

	tail := 500
	if v, err := strconv.Atoi(c.Query("tail")); err == nil && v > 0 && v <= 10000 {
		tail = v
	}
	follow := c.Query("follow") != "0"
	previous := c.Query("previous") == "1"
	timestamps := c.Query("timestamps") == "1"

	ws, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("ConnectK8sLogs: WebSocket Upgrade failed: %v", err)
		return
	}
	defer ws.Close()

	var wsWriteMu sync.Mutex
	writeWS := func(mt int, data []byte) error {
		wsWriteMu.Lock()
		defer wsWriteMu.Unlock()
		return ws.WriteMessage(mt, data)
	}
	notify := func(msg string) {
		b, _ := json.Marshal(gin.H{"type": "status", "message": msg})
		_ = writeWS(websocket.TextMessage, b)
	}

	store.GlobalDB.Create(&model.AuditLog{
		Actor: currentUsername(c), Action: "K8S_LOGS",
		Path: fmt.Sprintf("集群#%d 日志 %s/%s 容器=%s tail=%d follow=%v previous=%v",
			cl.ID, namespace, pod, container, tail, follow, previous),
		Status: 200, IP: c.ClientIP(),
	})

	q := url.Values{}
	if container != "" {
		q.Set("container", container)
	}
	q.Set("tailLines", strconv.Itoa(tail))
	if follow {
		q.Set("follow", "true")
	}
	if previous {
		q.Set("previous", "true")
	}
	if timestamps {
		q.Set("timestamps", "true")
	}
	logURL := fmt.Sprintf("https://%s/api/v1/namespaces/%s/pods/%s/log?%s",
		kubeAPIServer(cl), url.PathEscape(namespace), url.PathEscape(pod), q.Encode())

	req, err := http.NewRequest(http.MethodGet, logURL, nil)
	if err != nil {
		notify("构造日志请求失败: " + err.Error())
		return
	}
	if tok := kubeAuthHeader(cl); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	tlsCfg, err := kubeTLSConfig(cl)
	if err != nil {
		notify(err.Error())
		return
	}
	// follow 模式是长连接，不能设整体 Timeout（会把正常的跟随读腰斩），
	// 只限制握手与响应头阶段。
	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig:       tlsCfg,
			ResponseHeaderTimeout: 15 * time.Second,
		},
	}

	// 浏览器断开时要能把这条长连接一并收掉，否则 apiserver 侧的 follow 会一直挂着
	ctx, cancel := contextWithWSClose(ws)
	defer cancel()
	resp, err := client.Do(req.WithContext(ctx))
	if err != nil {
		notify("连接 kube-apiserver 失败: " + err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		buf := make([]byte, 2048)
		n, _ := resp.Body.Read(buf)
		notify(fmt.Sprintf("kube API 返回 %d: %s", resp.StatusCode, truncateStr(string(buf[:n]), 300)))
		return
	}

	// 逐行推送：日志行本身可能很长，Scanner 默认 64KB 上限对容器日志偏小
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		// 终端按 CRLF 换行，否则 xterm 里每行会阶梯式右移
		if err := writeWS(websocket.BinaryMessage, append(scanner.Bytes(), '\r', '\n')); err != nil {
			return
		}
	}
	if err := scanner.Err(); err != nil {
		notify("日志流中断: " + err.Error())
		return
	}
	if !follow {
		notify("日志读取完毕")
	}
}

// contextWithWSClose 返回一个在 WebSocket 断开时自动取消的 context。
// 顺带消费浏览器发来的心跳/控制帧——不读的话 gorilla 发现不了对端已关闭，
// follow 模式的长连接就会在 apiserver 侧一直挂着。
func contextWithWSClose(ws *websocket.Conn) (context.Context, func()) {
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		defer cancel()
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				return
			}
		}
	}()
	return ctx, cancel
}
