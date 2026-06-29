//go:build !windows

package sshproxy

import (
	"os"
	"os/exec"
	"path/filepath"

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
		_ = u.cmd.Process.Kill()
	}
	return u.f.Close()
}

// startLocalPty 在本机启动用户默认 Shell 并分配 PTY。
func startLocalPty(cols, rows int) (localPty, string, error) {
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

	// bash/zsh 以登录 shell 启动，确保加载 profile（macOS 下 PATH 才正确）
	var args []string
	switch filepath.Base(shell) {
	case "bash", "zsh", "-bash", "-zsh":
		args = []string{"-l"}
	}

	cmd := exec.Command(shell, args...)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "LANG=en_US.UTF-8", "LC_ALL=en_US.UTF-8")

	f, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: uint16(rows), Cols: uint16(cols)})
	if err != nil {
		return nil, "", err
	}
	return &unixPty{f: f, cmd: cmd}, shell, nil
}
