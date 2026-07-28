import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dropdown, Input, Tooltip, Upload, message } from 'antd';
import type { MenuProps } from 'antd';
import {
  FolderFilled,
  FileOutlined,
  ArrowUpOutlined,
  HomeOutlined,
  ReloadOutlined,
  UploadOutlined,
  FolderAddOutlined,
  PushpinOutlined,
  PushpinFilled,
  CloseOutlined,
  BorderOuterOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import { sftpList, sftpUpload, sftpDownload, sftpMkdir, sftpRemove, sftpRename, type SftpEntry } from '../services/api';

// ─────────────────────────────────────────────────────────────
// 终端内常驻的文件面板（对标 FinalShell）：贴在终端窗格左侧，
// 默认跟随 shell 的当前工作目录——在终端里 cd 到哪，这里就跳到哪，
// 不用点按钮、也不用再开一个抽屉。宽度可拖。
// ─────────────────────────────────────────────────────────────

interface Props {
  assetId: number;
  /** shell 当前工作目录（由终端的 OSC7 / 标题解析得到） */
  cwd: string;
  /** 该资产是否绑定了 SSH 凭据；未绑定时 SFTP 不可用 */
  hasCred: boolean;
  onClose: () => void;
}

const MIN_W = 200;
const MAX_W = 560;
const DEFAULT_W = 280;
const WIDTH_KEY = 'term_files_w';

// 停靠位置：贴右 / 贴左 / 贴下。
// 竖着放适合看目录树，横着放（贴下）适合文件名很长或者想同时看多列的场景，
// 所以高度和宽度分开记——从右切到下再切回来，两边的尺寸都还是上次调好的。
export type SftpDock = 'right' | 'left' | 'bottom';
const DOCK_KEY = 'term_files_dock';
const HEIGHT_KEY = 'term_files_h';
const MIN_H = 140;
const MAX_H = 560;
const DEFAULT_H = 240;

export const SFTP_DOCK_OPTIONS: { value: SftpDock; label: string }[] = [
  { value: 'right', label: '停靠右侧' },
  { value: 'left', label: '停靠左侧' },
  { value: 'bottom', label: '停靠下方' },
];

export const currentSftpDock = (): SftpDock => {
  const v = localStorage.getItem(DOCK_KEY);
  return v === 'left' || v === 'bottom' ? v : 'right';
};
export const setSftpDock = (d: SftpDock) => {
  localStorage.setItem(DOCK_KEY, d);
  window.dispatchEvent(new CustomEvent<SftpDock>('lynx-sftp-dock', { detail: d }));
};
export const useSftpDock = (): SftpDock => {
  const [d, setD] = useState<SftpDock>(currentSftpDock);
  useEffect(() => {
    const h = (e: Event) => setD((e as CustomEvent<SftpDock>).detail);
    window.addEventListener('lynx-sftp-dock', h);
    return () => window.removeEventListener('lynx-sftp-dock', h);
  }, []);
  return d;
};

const fmtSize = (n: number, isDir: boolean): string => {
  if (isDir) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}K`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}M`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)}G`;
};

const parentOf = (p: string): string => {
  const t = p.replace(/\/+$/, '');
  const idx = t.lastIndexOf('/');
  return idx <= 0 ? '/' : t.slice(0, idx);
};

export const SftpPanel: React.FC<Props> = ({ assetId, cwd, hasCred, onClose }) => {
  const [path, setPath] = useState('');
  const [editPath, setEditPath] = useState('');
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [follow, setFollow] = useState(true);
  const dock = useSftpDock();
  const [width, setWidth] = useState(() => {
    const v = parseInt(localStorage.getItem(WIDTH_KEY) || '', 10);
    return Number.isFinite(v) && v >= MIN_W && v <= MAX_W ? v : DEFAULT_W;
  });
  const [height, setHeight] = useState(() => {
    const v = parseInt(localStorage.getItem(HEIGHT_KEY) || '', 10);
    return Number.isFinite(v) && v >= MIN_H && v <= MAX_H ? v : DEFAULT_H;
  });
  const [renaming, setRenaming] = useState<SftpEntry | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [mkdirOn, setMkdirOn] = useState(false);
  const [mkdirVal, setMkdirVal] = useState('');

  // 连续快速进目录时响应可能乱序返回，只认最后一次请求的结果，
  // 否则界面会退回上一层，而后续上传/新建目录又都作用在错误路径上。
  const reqSeq = useRef(0);
  const load = useCallback(async (p: string) => {
    if (!assetId || !hasCred) return;
    const seq = ++reqSeq.current;
    setLoading(true);
    setErr('');
    try {
      const res = await sftpList(assetId, p);
      if (seq !== reqSeq.current) return;
      setEntries(res.entries || []);
      setPath(res.path);
      setEditPath(res.path);
    } catch (e: any) {
      if (seq !== reqSeq.current) return;
      setErr(e?.message || '读取目录失败');
      setEntries([]);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [assetId, hasCred]);

  // 首次打开：落到 shell 当前目录（拿不到就用家目录）
  useEffect(() => { load(cwd || ''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [assetId]);

  // 跟随 cd：终端里换目录时同步过来。关掉「跟随」后各走各的。
  useEffect(() => {
    if (!follow || !cwd || cwd === path) return;
    load(cwd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, follow]);

  // ── 拖拽调尺寸 ────────────────────────────────────────────
  // 三种停靠共用一套拖拽：贴右时把手在左缘（左移变宽），贴左时在右缘（右移变宽），
  // 贴下时在上缘（上移变高）。方向靠 sign 统一处理，不为每种停靠各写一份。
  const dragRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (dock === 'bottom') {
        setHeight(Math.min(MAX_H, Math.max(MIN_H, d.h - (e.clientY - d.y))));
      } else {
        const sign = dock === 'right' ? -1 : 1;
        setWidth(Math.min(MAX_W, Math.max(MIN_W, d.w + sign * (e.clientX - d.x))));
      }
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dock]);
  useEffect(() => { localStorage.setItem(WIDTH_KEY, String(width)); }, [width]);
  useEffect(() => { localStorage.setItem(HEIGHT_KEY, String(height)); }, [height]);

  const beginDrag = (e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, w: width, h: height };
    document.body.style.cursor = dock === 'bottom' ? 'row-resize' : 'col-resize';
  };

  // sftpDownload 内部已走统一保存入口（桌面端弹系统对话框选目录）
  const download = async (r: SftpEntry) => {
    try {
      await sftpDownload(assetId, r.path);
    } catch (e: any) {
      message.error(e?.message || '下载失败');
    }
  };

  const upload = async (file: File) => {
    try {
      await sftpUpload(assetId, path || '.', file);
      message.success(`已上传 ${file.name}`);
      load(path);
    } catch (e: any) {
      message.error(e?.message || '上传失败');
    }
  };

  const doRemove = async (r: SftpEntry) => {
    try {
      await sftpRemove(assetId, r.path);
      load(path);
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  const doRename = async () => {
    if (!renaming || !renameVal.trim()) return;
    try {
      await sftpRename(assetId, renaming.path, parentOf(renaming.path) + '/' + renameVal.trim());
      setRenaming(null);
      load(path);
    } catch (e: any) {
      message.error(e?.message || '重命名失败');
    }
  };

  const doMkdir = async () => {
    if (!mkdirVal.trim()) return;
    try {
      await sftpMkdir(assetId, (path === '/' ? '' : path) + '/' + mkdirVal.trim());
      setMkdirOn(false);
      setMkdirVal('');
      load(path);
    } catch (e: any) {
      message.error(e?.message || '新建目录失败');
    }
  };

  const rowMenu = (r: SftpEntry): MenuProps['items'] => [
    ...(r.is_dir ? [] : [{ key: 'dl', icon: <DownloadOutlined />, label: '下载' }]),
    { key: 'rn', label: '重命名' },
    { key: 'rm', danger: true, label: '删除' },
  ];

  const onRowMenu = (key: string, r: SftpEntry) => {
    if (key === 'dl') download(r);
    else if (key === 'rn') { setRenaming(r); setRenameVal(r.name); }
    else if (key === 'rm') doRemove(r);
  };

  const iconBtn: React.CSSProperties = {
    width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 4, cursor: 'pointer', color: '#94a3b8', flexShrink: 0,
  };

  const isBottom = dock === 'bottom';
  // 外层容器：贴左右时是一列（横向排把手 + 内容），贴下时改成一行（把手在上）
  const outer: React.CSSProperties = isBottom
    ? { height, width: '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#111827' }
    : { width, flexShrink: 0, display: 'flex', height: '100%', background: '#111827' };
  // 把手永远在「靠终端的那一侧」
  const handle: React.CSSProperties = isBottom
    ? { height: 4, flexShrink: 0, cursor: 'row-resize', background: 'transparent' }
    : { width: 4, flexShrink: 0, cursor: 'col-resize', background: 'transparent' };
  const innerBorder = isBottom ? { borderTop: '1px solid #1f2937' } : dock === 'right'
    ? { borderLeft: '1px solid #1f2937' } : { borderRight: '1px solid #1f2937' };

  const dragHandle = <div onMouseDown={beginDrag} style={handle} />;

  return (
    <div style={outer}>
      {/* 把手放在贴着终端的那一边：贴右在左缘、贴下在上缘、贴左在右缘。
          贴左那一份在内容之后渲染（见本组件末尾），别忘了它——漏掉的话
          停到左侧后宽度就锁死了，只能切回右侧才能调。 */}
      {dock !== 'left' && dragHandle}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', ...innerBorder }}>
        {/* 标题行 */}
        <div style={{
          height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2,
          padding: '0 4px 0 8px', background: '#1e293b', borderBottom: '1px solid #334155',
        }}>
          <span style={{ fontSize: 13, color: '#cbd5e1', flex: 1, minWidth: 0 }}>文件</span>
          <Tooltip title="切换停靠位置（右 / 左 / 下）">
            <span
              style={iconBtn}
              onClick={() => {
                const order: SftpDock[] = ['right', 'bottom', 'left'];
                setSftpDock(order[(order.indexOf(dock) + 1) % order.length]);
              }}
            >
              <BorderOuterOutlined style={{ fontSize: 12 }} />
            </span>
          </Tooltip>
          <Tooltip title={follow ? '已跟随终端当前目录，点击固定' : '已固定，点击恢复跟随'}>
            <span style={{ ...iconBtn, color: follow ? '#38bdf8' : '#64748b' }} onClick={() => setFollow((f) => !f)}>
              {follow ? <PushpinOutlined style={{ fontSize: 12 }} /> : <PushpinFilled style={{ fontSize: 12 }} />}
            </span>
          </Tooltip>
          <Tooltip title="关闭文件面板">
            <span style={iconBtn} onClick={onClose}><CloseOutlined style={{ fontSize: 13 }} /></span>
          </Tooltip>
        </div>

        {/* 工具行 */}
        <div style={{
          height: 26, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2,
          padding: '0 4px', borderBottom: '1px solid #1f2937',
        }}>
          <Tooltip title="家目录"><span style={iconBtn} onClick={() => load('')}><HomeOutlined style={{ fontSize: 12 }} /></span></Tooltip>
          <Tooltip title="上一级"><span style={iconBtn} onClick={() => load(parentOf(path))}><ArrowUpOutlined style={{ fontSize: 12 }} /></span></Tooltip>
          <Tooltip title="刷新"><span style={iconBtn} onClick={() => load(path)}><ReloadOutlined style={{ fontSize: 12 }} spin={loading} /></span></Tooltip>
          <Tooltip title="新建文件夹"><span style={iconBtn} onClick={() => { setMkdirVal(''); setMkdirOn(true); }}><FolderAddOutlined style={{ fontSize: 12 }} /></span></Tooltip>
          <Upload showUploadList={false} multiple beforeUpload={(f) => { upload(f as File); return false; }}>
            <Tooltip title="上传到当前目录"><span style={iconBtn}><UploadOutlined style={{ fontSize: 12 }} /></span></Tooltip>
          </Upload>
        </div>

        {/* 路径 */}
        <Input
          size="small"
          value={editPath}
          onChange={(e) => setEditPath(e.target.value)}
          onPressEnter={() => load(editPath)}
          variant="borderless"
          style={{ fontSize: 13, color: '#94a3b8', background: '#0f172a', borderRadius: 0, height: 24, flexShrink: 0 }}
        />

        {/* 列表 */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', fontSize: 13 }}>
          {!hasCred && (
            <div style={{ padding: 12, color: '#64748b', fontSize: 13, lineHeight: 1.7 }}>
              该资产未绑定 SSH 凭据，无法使用文件传输。请先在「编辑资产」里绑定凭据。
            </div>
          )}
          {hasCred && err && <div style={{ padding: 12, color: '#f87171', fontSize: 13 }}>{err}</div>}
          {hasCred && !err && entries.map((r) => (
            <Dropdown key={r.path} trigger={['contextMenu']} menu={{ items: rowMenu(r), onClick: ({ key }) => onRowMenu(key, r) }}>
              <div
                onDoubleClick={() => (r.is_dir ? load(r.path) : download(r))}
                title={`${r.name}${r.is_dir ? '' : ` · ${fmtSize(r.size, false)}`}\n双击${r.is_dir ? '进入' : '下载'}，右键更多`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, padding: '4px 8px',
                  cursor: 'pointer', color: '#cbd5e1', whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#1e293b'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {r.is_dir
                  ? <FolderFilled style={{ color: '#f59e0b', fontSize: 14, flexShrink: 0 }} />
                  : <FileOutlined style={{ color: '#64748b', fontSize: 14, flexShrink: 0 }} />}
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                <span style={{ fontSize: 11, color: '#64748b', flexShrink: 0 }}>{fmtSize(r.size, r.is_dir)}</span>
              </div>
            </Dropdown>
          ))}
          {hasCred && !err && !loading && entries.length === 0 && (
            <div style={{ padding: 12, color: '#475569', fontSize: 13 }}>空目录</div>
          )}
        </div>

        {/* 新建目录 / 重命名：就地一行输入，不再弹窗打断 */}
        {mkdirOn && (
          <Input
            size="small"
            autoFocus
            value={mkdirVal}
            placeholder="新目录名，回车创建"
            onChange={(e) => setMkdirVal(e.target.value)}
            onPressEnter={doMkdir}
            onBlur={() => setMkdirOn(false)}
            style={{ fontSize: 13, borderRadius: 0, flexShrink: 0 }}
          />
        )}
        {renaming && (
          <Input
            size="small"
            autoFocus
            value={renameVal}
            placeholder="新名称，回车确认"
            onChange={(e) => setRenameVal(e.target.value)}
            onPressEnter={doRename}
            onBlur={() => setRenaming(null)}
            style={{ fontSize: 13, borderRadius: 0, flexShrink: 0 }}
          />
        )}
      </div>
      {/* 贴左时把手在右缘（靠终端那一侧），所以排在内容之后 */}
      {dock === 'left' && dragHandle}
    </div>
  );
};
