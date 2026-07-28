//go:build !windows

package sshproxy

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/creack/pty"
)

// unixPty 基于 creack/pty（纯 Go，免 cgo）的 Unix/macOS/Linux 本机 PTY 实现。
type unixPty struct {
	f   *os.File
	cmd *exec.Cmd
}

func (u *unixPty) Read(p []byte) (int, error)  { return u.f.Read(p) }
func (u *unixPty) Write(p []byte) (int, error) { return u.f.Write(p) }

func (u *unixPty) Resize(cols, rows int) error {
	return pty.Setsize(u.f, &pty.Winsize{Rows: uint16(rows), Cols: uint16(cols)})
}

func (u *unixPty) Close() error {
	if u.cmd != nil && u.cmd.Process != nil {
		pid := u.cmd.Process.Pid
		// creack/pty 以 Setsid 启动子进程，其为新会话/进程组组长（pgid==pid）。
		// 向负 pid 发信号可终止整个进程组，连同 shell 派生的子进程一并清理，避免遗留孤儿进程。
		if err := syscall.Kill(-pid, syscall.SIGKILL); err != nil {
			_ = u.cmd.Process.Kill() // 回退：至少结束直接子进程
		}
		// 异步 Wait 回收，避免留下僵尸进程
		go func() { _ = u.cmd.Wait() }()
	}
	return u.f.Close()
}

// allowedShells 是本地终端唯一允许拉起的程序白名单。
// 这个端点等价于「在本机执行任意程序」，所以绝不能把前端传来的字符串当成路径直接
// exec——只认下面这几个固定名字，再由本机自行定位可执行文件；非法值一律退回默认。
var allowedShells = []string{"bash", "zsh", "sh", "fish"}

// resolveShell 把白名单标识符解析成本机上的绝对路径；不在白名单或本机没装时返回空串。
func resolveShell(name string) string {
	n := strings.ToLower(strings.TrimSpace(name))
	if n == "" {
		return ""
	}
	ok := false
	for _, s := range allowedShells {
		if n == s {
			ok = true
			break
		}
	}
	if !ok {
		return ""
	}
	if p, err := exec.LookPath(n); err == nil {
		return p
	}
	// 后端可能由 GUI 启动（PATH 很窄，LookPath 找不到 brew 装的 fish/zsh），再探常见目录
	for _, dir := range []string{"/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"} {
		p := filepath.Join(dir, n)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// defaultShell 未指定 Shell（或指定了本机没有的 Shell）时用的默认值。
func defaultShell() string {
	shell := os.Getenv("SHELL")
	if shell == "" {
		for _, s := range []string{"/bin/bash", "/bin/zsh", "/bin/sh"} {
			if _, err := os.Stat(s); err == nil {
				shell = s
				break
			}
		}
	}
	if shell == "" {
		shell = "/bin/sh"
	}
	return shell
}

// startLocalPty 按 shell 指定的类型启动本机 Shell 并分配 PTY；shell 为空或非法时用默认 Shell。
func startLocalPty(cols, rows int, shell string) (localPty, string, error) {
	resolved := resolveShell(shell)
	if resolved == "" {
		resolved = defaultShell()
	}
	shell = resolved

	// bash/zsh/fish 以登录 shell 启动，确保加载 profile（macOS 下 PATH 才正确）
	var args []string
	switch filepath.Base(shell) {
	case "bash", "zsh", "fish", "-bash", "-zsh":
		args = []string{"-l"}
	}

	cmd := exec.Command(shell, args...)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "LANG=en_US.UTF-8", "LC_ALL=en_US.UTF-8")
	// 默认工作目录为用户家目录（~），而非后端进程的启动目录
	if home, herr := os.UserHomeDir(); herr == nil && home != "" {
		cmd.Dir = home
	}

	f, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: uint16(rows), Cols: uint16(cols)})
	if err != nil {
		return nil, "", err
	}
	return &unixPty{f: f, cmd: cmd}, shell, nil
}
