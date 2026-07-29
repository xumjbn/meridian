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
// Windows 默认走 cmd：它启动快、没有 PowerShell 的执行策略与配置文件加载开销，
// 也不会在首屏刷一段版本横幅。要 PowerShell 的话在侧栏「本地终端」右边选。
func defaultShellCandidates() []string {
	c := []string{"cmd.exe", "powershell.exe"}
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
	// 必须显式告诉子进程「这是个支持真彩的终端」。
	//
	// 之前这里一个环境变量都没传，实测在本地终端里跑
	//   node -e "console.log(process.stdout.getColorDepth())"
	// 得到 depth=1（单色）——于是 Claude Code 这类用 supports-color 探测能力的
	// TUI 会整个降级成无格式白字，边框、配色、面板全没了。
	// PowerShell 自己的输出有颜色是因为它直接吐 ANSI，不做能力探测，所以
	// 光看 shell 提示符是发现不了这个问题的。
	// ConPtyEnv 会整体替换环境，所以要从 os.Environ() 开始加。
	opts = append(opts, conpty.ConPtyEnv(termEnv(os.Environ())))

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
