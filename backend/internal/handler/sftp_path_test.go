package handler

import "testing"

// TestUnsafeDeletePath 锁住「哪些路径不许删」这条边界。
//
// 这个接口对目录是递归删的，判错一个用例的代价是把远端整台机器的文件删掉，
// 所以这里把每一种绕过写法都写成用例钉住——原实现只比较 "" 和 "/" 两个字面量，
// 下面 unsafe 组里除这两个之外的每一条都能绕过它。
func TestUnsafeDeletePath(t *testing.T) {
	unsafe := []string{
		"",           // 空
		"   ",        // 只有空白
		"/",          // 根
		"//",         // POSIX 解析为根
		"///",        // 同上
		"/.",         // 归一为根
		"/..",        // 归一为根
		"/../",       // 归一为根
		"/etc/../",   // 归一为根
		"/a/b/../..", // 归一为根
		".",          // 相对路径，解析为家目录
		"..",         // 家目录上一级
		"./",         // 家目录
		"foo",        // 相对路径：家目录下的 foo，语义不明确，一律拒
		"foo/bar",    // 同上
		"~",          // SFTP 不展开 ~，当相对路径处理，拒
	}
	for _, p := range unsafe {
		if !unsafeDeletePath(p) {
			t.Errorf("unsafeDeletePath(%q) = false，应判为不安全", p)
		}
	}

	safe := []string{
		"/etc/nginx/nginx.conf",
		"/root/a.log",
		"/tmp",                  // 一级目录，允许——用户确实可能要删 /tmp 下的东西
		"/home/deploy/app",      //
		"/a/b/../c",             // 归一为 /a/c，仍是具体目标
		"/data/dir/",            // 末尾斜杠，归一为 /data/dir
		"//srv/x",               // 归一为 /srv/x，是具体目标
		"/带中文的目录/文件.txt", // 非 ASCII 路径不该被误拒
		"/with space/f.txt",
	}
	for _, p := range safe {
		if unsafeDeletePath(p) {
			t.Errorf("unsafeDeletePath(%q) = true，正常路径被误拒", p)
		}
	}
}
