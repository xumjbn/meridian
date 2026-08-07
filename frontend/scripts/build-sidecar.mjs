// 打包前重新编译 Go 后端到 src-tauri/binaries/。
//
// 为什么必须有这一步：`tauri build` 只把 binaries/ 里已有的二进制原样打进安装包，
// 它不知道 Go 那边改没改。2026-08-07 就栽在这里——后端加了 /api/local/doc，前端
// 功能全绿，装出来的桌面端却一直 404，因为包里塞的还是前一天编的 sidecar。
// 靠「记得手动编」是靠不住的，接进 beforeBuildCommand 让它没法漏。
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');            // 仓库根
const backend = join(root, 'backend');
const outDir = join(root, 'frontend', 'src-tauri', 'binaries');

// externalBin 要求文件名带目标三元组后缀，否则 tauri 找不到
const TRIPLE = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
}[`${process.platform}-${process.arch}`];

if (!TRIPLE) {
  console.error(`[sidecar] 不认识的平台 ${process.platform}-${process.arch}，请手动编译 sidecar`);
  process.exit(1);
}
const out = join(outDir, `wjw-backend-${TRIPLE}${process.platform === 'win32' ? '.exe' : ''}`);

// 代理会让 Go 拉依赖时 TLS 握手失败，构建前清掉（与 cargo 那边同一个坑）
const env = { ...process.env, GOTOOLCHAIN: 'local', CGO_ENABLED: '0', GOFLAGS: '-mod=mod' };
for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY']) delete env[k];
if (!env.GOPROXY) env.GOPROXY = 'https://goproxy.cn,direct';

console.log(`[sidecar] 编译 Go 后端 -> ${out}`);
try {
  execFileSync('go', ['build', '-o', out, './cmd/server'], { cwd: backend, env, stdio: 'inherit' });
} catch (e) {
  console.error('[sidecar] 编译失败：', e.message);
  process.exit(1);
}
if (!existsSync(out)) {
  console.error('[sidecar] 编译命令返回成功但产物不存在，中止');
  process.exit(1);
}
console.log(`[sidecar] 完成，${(statSync(out).size / 1048576).toFixed(1)} MB`);
