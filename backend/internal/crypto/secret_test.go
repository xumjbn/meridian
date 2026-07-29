package crypto

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func onceReset() sync.Once { return sync.Once{} }

// 更名 lynx → wjw 时，密钥文件从 .lynx_key 改成了 .wjw_key。
// 主密钥一旦换掉，库里所有已加密的凭据密码和 K8s Token 会立刻全部解不开，
// 而且是静默的——界面上只表现为「连不上、密码不对」，极难定位。
// 这几个用例把「必须能读旧密钥」这件事钉死。

// resetAEAD 让每个用例都重新走一遍密钥加载（aeadOnce 是包级的）
func resetAEAD(t *testing.T, dir string) {
	t.Helper()
	aeadOnce = onceReset()
	aead = nil
	aeadErr = nil
	SetKeyDir(dir)
	t.Setenv("WJW_SECRET_KEY", "") // 确保走文件而不是环境变量
}

func TestLegacyLynxKeyStillDecrypts(t *testing.T) {
	dir := t.TempDir()

	// 先用「旧文件名」造出一份密钥并加密一段数据，模拟更名前就存在的库
	resetAEAD(t, dir)
	legacy := filepath.Join(dir, ".lynx_key")
	// 借一次正常流程生成密钥，再把它改名成旧名字
	if _, err := EncryptSecret("warmup"); err != nil {
		t.Fatalf("预热加密失败: %v", err)
	}
	newFile := filepath.Join(dir, ".wjw_key")
	if err := os.Rename(newFile, legacy); err != nil {
		t.Fatalf("改名成旧密钥文件失败: %v", err)
	}

	// 重新加载：此时只有 .lynx_key
	resetAEAD(t, dir)
	const plain = "hunter2-super-secret"
	enc, err := EncryptSecret(plain)
	if err != nil {
		t.Fatalf("用旧密钥加密失败: %v", err)
	}
	if enc == plain {
		t.Fatal("没有真正加密")
	}

	// 再次重载，确认解得开——也就是没有偷偷新建一把密钥
	resetAEAD(t, dir)
	got, err := DecryptSecret(enc)
	if err != nil {
		t.Fatalf("用旧密钥解密失败: %v", err)
	}
	if got != plain {
		t.Fatalf("解出来不对: %q != %q", got, plain)
	}

	if _, err := os.Stat(newFile); err == nil {
		t.Fatal("不应该在存在旧密钥时又生成新密钥文件（会导致下次启动用错密钥）")
	}
}

func TestPrefersNewKeyWhenBothExist(t *testing.T) {
	dir := t.TempDir()

	// 造一把新密钥并加密
	resetAEAD(t, dir)
	const plain = "new-key-payload"
	enc, err := EncryptSecret(plain)
	if err != nil {
		t.Fatalf("加密失败: %v", err)
	}

	// 再放一把内容不同的旧密钥进去
	if err := os.WriteFile(filepath.Join(dir, ".lynx_key"),
		[]byte("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="), 0o600); err != nil {
		t.Fatalf("写旧密钥失败: %v", err)
	}

	// 重载后应仍用新密钥，能解开刚才的密文
	resetAEAD(t, dir)
	got, err := DecryptSecret(enc)
	if err != nil {
		t.Fatalf("两把密钥并存时解密失败（说明选错了密钥）: %v", err)
	}
	if got != plain {
		t.Fatalf("解出来不对: %q != %q", got, plain)
	}
}

func TestPlaintextPassesThrough(t *testing.T) {
	dir := t.TempDir()
	resetAEAD(t, dir)
	// 历史明文没有 enc:v1: 前缀，必须原样返回，否则升级后旧凭据全废
	got, err := DecryptSecret("legacy-plaintext")
	if err != nil {
		t.Fatalf("明文兼容失败: %v", err)
	}
	if got != "legacy-plaintext" {
		t.Fatalf("明文被改动了: %q", got)
	}
}
