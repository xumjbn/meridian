import React, { useEffect, useState } from 'react';
import { Drawer, Table, Button, Space, Upload, Input, Modal, Popconfirm, message, Tag, Tooltip } from 'antd';
import {
  FolderFilled,
  FileOutlined,
  DownloadOutlined,
  ReloadOutlined,
  ArrowUpOutlined,
  HomeOutlined,
  FolderAddOutlined,
  EditOutlined,
  DeleteOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import {
  sftpList,
  sftpUpload,
  sftpDownload,
  sftpMkdir,
  sftpRemove,
  sftpRename,
  type SftpEntry,
  type Asset,
} from '../services/api';
import { palette } from '../theme';

interface Props {
  asset: Asset | null;
  open: boolean;
  onClose: () => void;
}

const fmtSize = (n: number, isDir: boolean): string => {
  if (isDir) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const parentOf = (p: string): string => {
  const t = p.replace(/\/+$/, '');
  const idx = t.lastIndexOf('/');
  if (idx <= 0) return '/';
  return t.slice(0, idx);
};

const joinPath = (dir: string, name: string): string => {
  if (!dir || dir === '/') return '/' + name;
  return dir.replace(/\/+$/, '') + '/' + name;
};

export const SftpDrawer: React.FC<Props> = ({ asset, open, onClose }) => {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // 新建目录 / 重命名 弹窗
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState('');
  const [renameTarget, setRenameTarget] = useState<SftpEntry | null>(null);
  const [renameName, setRenameName] = useState('');

  const noCred = !asset?.credential_id;

  const load = async (p: string) => {
    if (!asset?.id) return;
    setLoading(true);
    try {
      const res = await sftpList(asset.id, p);
      setEntries(res.entries || []);
      setPath(res.path);
    } catch (e: any) {
      message.error(e?.message || '读取目录失败');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && asset?.id && !noCred) {
      load('');
    } else {
      setEntries([]);
      setPath('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, asset?.id]);

  const handleUpload = async (file: File) => {
    if (!asset?.id) return;
    setBusy(true);
    try {
      const res = await sftpUpload(asset.id, path || '.', file);
      message.success(`已上传 ${file.name}（${fmtSize(res.size, false)}）`);
      load(path);
    } catch (e: any) {
      message.error(e?.message || '上传失败');
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async (entry: SftpEntry) => {
    if (!asset?.id) return;
    message.loading({ content: `正在下载 ${entry.name}...`, key: 'dl', duration: 0 });
    try {
      await sftpDownload(asset.id, entry.path);
      message.success({ content: `已下载 ${entry.name}`, key: 'dl' });
    } catch (e: any) {
      message.error({ content: e?.message || '下载失败', key: 'dl' });
    }
  };

  const doMkdir = async () => {
    if (!asset?.id || !mkdirName.trim()) return;
    try {
      await sftpMkdir(asset.id, joinPath(path, mkdirName.trim()));
      message.success('目录已创建');
      setMkdirOpen(false);
      setMkdirName('');
      load(path);
    } catch (e: any) {
      message.error(e?.message || '创建目录失败');
    }
  };

  const doRename = async () => {
    if (!asset?.id || !renameTarget || !renameName.trim()) return;
    try {
      await sftpRename(asset.id, renameTarget.path, joinPath(parentOf(renameTarget.path), renameName.trim()));
      message.success('已重命名');
      setRenameTarget(null);
      setRenameName('');
      load(path);
    } catch (e: any) {
      message.error(e?.message || '重命名失败');
    }
  };

  const doRemove = async (entry: SftpEntry) => {
    if (!asset?.id) return;
    try {
      await sftpRemove(asset.id, entry.path);
      message.success(`已删除 ${entry.name}`);
      load(path);
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, r: SftpEntry) =>
        r.is_dir ? (
          <a onClick={() => load(r.path)} style={{ fontWeight: 500 }}>
            <FolderFilled style={{ color: '#f59e0b', marginRight: 8 }} />
            {name}
          </a>
        ) : (
          <span>
            <FileOutlined style={{ color: '#94a3b8', marginRight: 8 }} />
            {name}
          </span>
        ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 100,
      render: (s: number, r: SftpEntry) => <span style={{ color: '#64748b' }}>{fmtSize(s, r.is_dir)}</span>,
    },
    {
      title: '权限',
      dataIndex: 'mode',
      key: 'mode',
      width: 120,
      render: (m: string) => <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#94a3b8' }}>{m}</span>,
    },
    {
      title: '修改时间',
      dataIndex: 'mod_time',
      key: 'mod_time',
      width: 160,
      render: (t: number) => <span style={{ fontSize: 12 }}>{t ? new Date(t * 1000).toLocaleString() : '-'}</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 170,
      render: (_: unknown, r: SftpEntry) => (
        <Space size={4}>
          {!r.is_dir && (
            <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(r)} style={{ padding: '0 4px' }}>
              下载
            </Button>
          )}
          <Tooltip title="重命名">
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => { setRenameTarget(r); setRenameName(r.name); }}
              style={{ padding: '0 4px', color: '#475569' }}
            />
          </Tooltip>
          <Popconfirm
            title={r.is_dir ? `删除目录「${r.name}」及其全部内容？` : `删除文件「${r.name}」？`}
            onConfirm={() => doRemove(r)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="删除">
              <Button type="link" danger size="small" icon={<DeleteOutlined />} style={{ padding: '0 4px' }} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Drawer
      title={
        <Space>
          <span>文件管理</span>
          {asset && <Tag color="blue" style={{ borderRadius: 4 }}>{asset.name}（{asset.ip}）</Tag>}
        </Space>
      }
      width={780}
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      {noCred ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: palette.textSub }}>
          该资产未绑定 SSH 凭据，无法使用文件传输。<br />请先在「编辑资产」中绑定一个 SSH 密码或密钥凭据。
        </div>
      ) : (
        <>
          <Space style={{ marginBottom: 12, width: '100%' }} wrap>
            <Tooltip title="返回家目录">
              <Button icon={<HomeOutlined />} onClick={() => load('')} />
            </Tooltip>
            <Tooltip title="上一级">
              <Button icon={<ArrowUpOutlined />} onClick={() => load(parentOf(path))} disabled={path === '/'} />
            </Tooltip>
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onPressEnter={() => load(path)}
              style={{ width: 300 }}
              placeholder="远端路径，回车跳转"
            />
            <Button icon={<ReloadOutlined />} onClick={() => load(path)} loading={loading}>
              刷新
            </Button>
            <Button icon={<FolderAddOutlined />} onClick={() => { setMkdirName(''); setMkdirOpen(true); }}>
              新建文件夹
            </Button>
          </Space>

          <Upload.Dragger
            multiple
            accept="*"
            showUploadList={false}
            disabled={busy}
            beforeUpload={(file) => {
              handleUpload(file as File);
              return false;
            }}
            style={{ marginBottom: 12, padding: '4px 0' }}
          >
            <p style={{ margin: '6px 0', color: '#94a3b8', fontSize: 13 }}>
              <InboxOutlined style={{ marginRight: 8, color: palette.primary }} />
              点击或拖拽文件到此处，上传到当前目录
            </p>
          </Upload.Dragger>

          <Table
            columns={columns}
            dataSource={entries}
            rowKey="path"
            loading={loading}
            size="small"
            pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (t) => `共 ${t} 项` }}
          />
        </>
      )}

      {/* 新建文件夹 */}
      <Modal
        title="新建文件夹"
        open={mkdirOpen}
        onCancel={() => setMkdirOpen(false)}
        onOk={doMkdir}
        okText="创建"
        cancelText="取消"
        destroyOnHidden
      >
        <div style={{ marginBottom: 8, fontSize: 13, color: palette.textSub }}>在 <code>{path || '~'}</code> 下创建：</div>
        <Input
          value={mkdirName}
          onChange={(e) => setMkdirName(e.target.value)}
          onPressEnter={doMkdir}
          placeholder="文件夹名称"
          autoFocus
        />
      </Modal>

      {/* 重命名 */}
      <Modal
        title={`重命名「${renameTarget?.name ?? ''}」`}
        open={!!renameTarget}
        onCancel={() => setRenameTarget(null)}
        onOk={doRename}
        okText="确认"
        cancelText="取消"
        destroyOnHidden
      >
        <Input
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onPressEnter={doRename}
          placeholder="新名称"
          autoFocus
        />
      </Modal>
    </Drawer>
  );
};

export default SftpDrawer;
