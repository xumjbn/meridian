#!/usr/bin/env bash
# 从已构建的 .app 直接用 hdiutil 生成可安装 .dmg（拖入 Applications 安装）。
# 绕开 Tauri bundle_dmg.sh 的 AppleScript/Finder 步骤，避免「failed to run bundle_dmg.sh」。
# 用法: make-dmg.sh <App路径> <卷名> <输出dmg路径>
set -euo pipefail

APP="${1:?用法: make-dmg.sh <App路径> <卷名> <输出dmg路径>}"
VOL="${2:?缺少卷名}"
OUT="${3:?缺少输出 dmg 路径}"

if [ ! -d "$APP" ]; then
  echo "❌ 找不到 .app：$APP（请先 make desktop 构建）" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# 暂存 .app + 指向 /Applications 的软链，让 dmg 打开后可直接拖入安装
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"

# 卸载可能残留的同名卷，避免 hdiutil 占用报错
hdiutil detach "/Volumes/$VOL" -force >/dev/null 2>&1 || true

hdiutil create \
  -volname "$VOL" \
  -srcfolder "$STAGE" \
  -ov \
  -fs HFS+ \
  -format UDZO \
  "$OUT"

echo "✅ DMG: $OUT"
echo "   未签名：用户首次打开右键→打开，或拖入 Applications 后右键→打开"
