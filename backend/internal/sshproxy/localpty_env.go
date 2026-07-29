package sshproxy

import "strings"

// termEnv 把后端自身的环境整理成「一个正常终端应该给出的环境」，两个平台共用。
//
// 做两件事：
//  1. 剥掉抑制颜色的变量。NO_COLOR / NODE_DISABLE_COLORS 是给「继承它的那个进程」
//     看的指令，不该被转嫁给用户在终端里手敲的命令——后端可能是从某个设了
//     NO_COLOR 的 shell、CI 或上层工具里被拉起来的，用户不该因此在自己的终端里
//     失去所有颜色。
//     实测（Windows 本地终端）：后端进程带 NO_COLOR=1 时，终端里跑
//     `node -e "process.stdout.getColorDepth()"` 返回 1（单色），
//     Claude Code 这类靠 supports-color 探测能力的 TUI 于是整个降级成
//     无边框、无配色的白字——用户报的「执行 claude 后所有配置消失，只显示白色」。
//  2. 补齐 TERM / COLORTERM，明确告诉子进程这是支持真彩的终端。
//     已有同名变量时不覆盖——上层若刻意设过就尊重它。
func termEnv(env []string) []string {
	drop := map[string]bool{
		"NO_COLOR":            true,
		"NODE_DISABLE_COLORS": true,
	}
	out := make([]string, 0, len(env)+2)
	present := map[string]bool{}
	for _, e := range env {
		i := strings.IndexByte(e, '=')
		if i <= 0 {
			out = append(out, e)
			continue
		}
		k := strings.ToUpper(e[:i])
		if drop[k] {
			continue
		}
		present[k] = true
		out = append(out, e)
	}
	for _, kv := range [][2]string{
		{"TERM", "xterm-256color"},
		{"COLORTERM", "truecolor"},
	} {
		if !present[kv[0]] {
			out = append(out, kv[0]+"="+kv[1])
		}
	}
	return out
}
