//go:build windows

package sshproxy

import (
	"os"
	"strings"

	"github.com/UserExistsError/conpty"
)

// winPty 基于 Windows ConPTY 的本机 PTY 实现（需 Windows 10 1809+）。
type winPty struct {
	c *conpty.ConPty
}

func (w *winPty) Read(p []byte) (int, error)  { return w.c.Read(p) }
func (w *winPty) Write(p []byte) (int, error) { return w.c.Write(p) }

// ConPty.Resize 入参为 (width=列, height=行)
func (w *winPty) Resize(cols, rows int) error { return w.c.Resize(cols, rows) }
func (w *winPty) Close() error                { return w.c.Close() }

// allowedShells 是本地终端唯一允许拉起的程序白名单。
// 这个端点等价于「在本机执行任意程序」，所以绝不能把前端传来的字符串直接交给
// conpty.Start——只认下面这几个固定标识符，非法值一律退回默认。
//
// 注意这里没有也不能有 wt.exe：Windows Terminal 是 GUI 终端宿主而非控制台程序，
// 它不会附着到 ConPTY 上，塞进来只会得到一个空白网页终端 + 一个弹出的独立窗口。
var allowedShells = map[string][]string{
	"cmd":        {"cmd.exe"},
	"powershell": {"powershell.exe"},
	"pwsh":       {"pwsh.exe"}, // PowerShell 7+，未安装时由下面的默认候选兜底
}

// defaultShellCandidates 未指定 Shell（或指定了非法值）时的回退顺序。
func defaultShellCandidates() []string {
	c := []string{"powershell.exe", "cmd.exe"}
	if cs := os.Getenv("COMSPEC"); cs != "" {
		c = append(c, cs)
	}
	return c
}

// startLocalPty 按 shell 指定的类型启动本机终端；shell 为空或不在白名单内时用默认候选。
func startLocalPty(cols, rows int, shell string) (localPty, string, error) {
	var candidates []string
	if exes, ok := allowedShells[strings.ToLower(strings.TrimSpace(shell))]; ok {
		candidates = append(candidates, exes...)
	}
	// 用户选的 Shell 可能压根没装（典型如没装 PowerShell 7 却选了 pwsh），
	// 后面接上默认候选，保证终端至少能开起来而不是直接报错
	candidates = append(candidates, defaultShellCandidates()...)

	// 默认工作目录为用户家目录（%USERPROFILE%），而非后端进程的启动目录
	opts := []conpty.ConPtyOption{conpty.ConPtyDimensions(cols, rows)}
	if home, herr := os.UserHomeDir(); herr == nil && home != "" {
		opts = append(opts, conpty.ConPtyWorkDir(home))
	}

	var lastErr error
	for _, exe := range candidates {
		cpty, err := conpty.Start(exe, opts...)
		if err == nil {
			return &winPty{c: cpty}, exe, nil
		}
		lastErr = err
	}
	return nil, "", lastErr
}
