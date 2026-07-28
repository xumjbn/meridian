// ─────────────────────────────────────────────────────────────
// 统一的「保存文件」入口
//
// 此前所有导出/下载都是造一个 <a download> 直接点掉，文件无声无息落进浏览器
// 默认下载目录，用户既选不了位置也不知道存哪了。这里优先用 File System Access
// API 弹出系统保存对话框（Chrome / Edge / Tauri 的 WebView2 都支持），
// 不支持的环境（Safari / macOS WKWebView）自动回落到原来的直接下载。
// ─────────────────────────────────────────────────────────────

// 注意：不从 services/api 引入 isTauri —— api.ts 反过来要 import saveBlob，
// 会形成循环依赖。这里就地判断，和 api.ts 里的判据保持一致。
const isTauri = typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

interface SavePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}
type SavePicker = (opts: SavePickerOptions) => Promise<{
  createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }>;
}>;

/** 当前环境是否支持「选择保存位置」 */
export const canPickSaveLocation = (): boolean =>
  isTauri ||
  (typeof window !== 'undefined' && typeof (window as { showSaveFilePicker?: SavePicker }).showSaveFilePicker === 'function');

/** 桌面端（Tauri）：调系统原生保存对话框 + 写文件。WebView2 里没有 showSaveFilePicker，必须走这条。 */
const saveViaTauri = async (blob: Blob, filename: string): Promise<boolean | null> => {
  try {
    const [dialog, fs] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const ext = (filename.split('.').pop() || '').toLowerCase();
    const path = await dialog.save({
      defaultPath: filename,
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
    });
    if (!path) return false;                       // 用户取消
    await fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return true;
  } catch {
    return null;                                   // 插件不可用 → 交给后续兜底
  }
};

/** 按扩展名给出保存对话框的文件类型过滤 */
const typesFor = (filename: string): SavePickerOptions['types'] => {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map: Record<string, { description: string; mime: string }> = {
    csv: { description: 'CSV 文件', mime: 'text/csv' },
    log: { description: '日志文件', mime: 'text/plain' },
    txt: { description: '文本文件', mime: 'text/plain' },
    json: { description: 'JSON 文件', mime: 'application/json' },
  };
  const hit = map[ext];
  if (!hit) return undefined;
  return [{ description: hit.description, accept: { [hit.mime]: [`.${ext}`] } }];
};

/**
 * 保存 Blob 到本地：优先弹出系统保存对话框让用户选目录与文件名。
 * @returns true 表示已写入；false 表示用户取消
 */
export const saveBlob = async (blob: Blob, filename: string): Promise<boolean> => {
  if (isTauri) {
    const r = await saveViaTauri(blob, filename);
    if (r !== null) return r;                      // 成功或用户取消，都不再兜底下载
  }
  const picker = (window as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: filename, types: typesFor(filename) });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return true;
    } catch (e) {
      // 用户点了「取消」：不算失败，也不要再偷偷下载一份
      if ((e as { name?: string })?.name === 'AbortError') return false;
      // 其它异常（如权限被策略禁用）走下面的兜底
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
};
