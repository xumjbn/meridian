package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// ─────────────────────────────────────────────────────────────
// 凭据密文存储
//
// SSH 密码与私钥此前明文入库，一旦库文件外泄（备份、误提交、被拖库）就是
// 直接可用的凭据。这里改为 AES-256-GCM 加密后再落库：
//   - 主密钥优先取环境变量 WJW_SECRET_KEY（生产/容器部署应显式设置）
//   - 未设置时在数据库同目录生成 .lynx_key（0600），保证桌面端开箱即用
//   - 密文带 "enc:v1:" 前缀，便于与历史明文共存并逐步迁移
//
// 注意：这解决的是「静态数据泄露」。密钥与库放在同一台机器上时，
// 拿到整机权限的攻击者仍可解密——那需要外部 KMS，超出当前范围。
// ─────────────────────────────────────────────────────────────

const secretPrefix = "enc:v1:"

// keyDir 由 store 在初始化数据库时注入（密钥文件与库文件同目录）
var keyDir = "."

// SetKeyDir 指定密钥文件存放目录，需在首次加解密前调用
func SetKeyDir(dir string) { keyDir = dir }

var (
	aeadOnce sync.Once
	aead     cipher.AEAD
	aeadErr  error
)

// keyMaterial 返回 32 字节主密钥：环境变量优先，其次本地密钥文件（不存在则生成）
func keyMaterial() ([]byte, error) {
	if v := strings.TrimSpace(os.Getenv("WJW_SECRET_KEY")); v != "" {
		// 任意长度口令统一派生成 32 字节
		sum := sha256.Sum256([]byte(v))
		return sum[:], nil
	}

	dir := keyDir
	if dir == "" || dir == "." {
		dir = "."
	}
	keyFile := filepath.Join(dir, ".wjw_key")

	// 更名前的密钥文件叫 .lynx_key。这里必须回退读取旧文件：
	// 主密钥一旦换掉，库里所有已加密的凭据密码和 K8s Token 立刻全部解不开，
	// 而且是静默的——界面上只会表现为「连不上、密码不对」。
	// 找到旧文件就原样沿用它（不改名、不重写），老库继续能解密。
	if _, err := os.Stat(keyFile); os.IsNotExist(err) {
		legacy := filepath.Join(dir, ".lynx_key")
		if _, lerr := os.Stat(legacy); lerr == nil {
			keyFile = legacy
		}
	}

	if b, err := os.ReadFile(keyFile); err == nil {
		raw, derr := base64.StdEncoding.DecodeString(strings.TrimSpace(string(b)))
		if derr == nil && len(raw) == 32 {
			return raw, nil
		}
		// 文件损坏：不静默重建，否则会把已有密文全部变成无法解密的垃圾
		return nil, fmt.Errorf("密钥文件 %s 内容无效，请修复或删除后重新录入凭据", keyFile)
	}

	key := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, err
	}
	enc := base64.StdEncoding.EncodeToString(key)
	if err := os.WriteFile(keyFile, []byte(enc), 0o600); err != nil {
		return nil, fmt.Errorf("写入密钥文件失败: %w", err)
	}
	return key, nil
}

func getAEAD() (cipher.AEAD, error) {
	aeadOnce.Do(func() {
		key, err := keyMaterial()
		if err != nil {
			aeadErr = err
			return
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			aeadErr = err
			return
		}
		aead, aeadErr = cipher.NewGCM(block)
	})
	return aead, aeadErr
}

// IsEncrypted 判断字段是否已是密文
func IsEncrypted(s string) bool { return strings.HasPrefix(s, secretPrefix) }

// EncryptSecret 加密敏感字段；空串原样返回，已加密的不重复加密
func EncryptSecret(plain string) (string, error) {
	if plain == "" || IsEncrypted(plain) {
		return plain, nil
	}
	a, err := getAEAD()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, a.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := a.Seal(nonce, nonce, []byte(plain), nil)
	return secretPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

// DecryptSecret 解密敏感字段。
// 没有密文前缀的一律按历史明文原样返回，保证升级后旧数据仍可用。
func DecryptSecret(stored string) (string, error) {
	if stored == "" || !IsEncrypted(stored) {
		return stored, nil
	}
	a, err := getAEAD()
	if err != nil {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(stored, secretPrefix))
	if err != nil {
		return "", fmt.Errorf("密文格式错误: %w", err)
	}
	if len(raw) < a.NonceSize() {
		return "", errors.New("密文长度异常")
	}
	nonce, body := raw[:a.NonceSize()], raw[a.NonceSize():]
	out, err := a.Open(nil, nonce, body, nil)
	if err != nil {
		return "", fmt.Errorf("解密失败（密钥不匹配或数据损坏）: %w", err)
	}
	return string(out), nil
}

// MustDecrypt 解密失败时返回空串——调用方随后会因凭据为空而报认证失败，
// 好过把密文当明文发给远端。
func MustDecrypt(stored string) string {
	v, err := DecryptSecret(stored)
	if err != nil {
		return ""
	}
	return v
}
