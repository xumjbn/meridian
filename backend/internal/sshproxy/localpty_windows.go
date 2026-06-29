//go:build windows

package sshproxy

import (
	"os"

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

// startLocalPty 优先以 PowerShell 启动本机终端，失败回退 cmd.exe。
func startLocalPty(cols, rows int) (localPty, string, error) {
	candidates := []string{"powershell.exe", "cmd.exe"}
	if cs := os.Getenv("COMSPEC"); cs != "" {
		candidates = append(candidates, cs)
	}

	var lastErr error
	for _, shell := range candidates {
		cpty, err := conpty.Start(shell, conpty.ConPtyDimensions(cols, rows))
		if err == nil {
			return &winPty{c: cpty}, shell, nil
		}
		lastErr = err
	}
	return nil, "", lastErr
}
