import React, { useEffect, useState } from 'react';
import { Drawer, Table, Button, Space, Upload, Input, message, Tag, Tooltip } from 'antd';
import {
  FolderFilled,
  FileOutlined,
  DownloadOutlined,
  UploadOutlined,
  ReloadOutlined,
  ArrowUpOutlined,
  HomeOutlined,
} from '@ant-design/icons';
import { sftpList, sftpUpload, sftpDownload, type SftpEntry, type Asset } from '../services/api';
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

export const SftpDrawer: React.FC<Props> = ({ asset, open, onClose }) => {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

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
      load(''); // 空路径 → 后端解析到家目录
    } else {
      setEntries([]);
      setPath('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, asset?.id]);

  const handleUpload = async (file: File) => {
    if (!asset?.id) return;
    setUploading(true);
    try {
      const res = await sftpUpload(asset.id, path || '.', file);
      message.success(`已上传 ${file.name}（${fmtSize(res.size, false)}）`);
      load(path);
    } catch (e: any) {
      message.error(e?.message || '上传失败');
    } finally {
      setUploading(false);
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
      width: 110,
      render: (s: number, r: SftpEntry) => <span style={{ color: '#64748b' }}>{fmtSize(s, r.is_dir)}</span>,
    },
    {
      title: '权限',
      dataIndex: 'mode',
      key: 'mode',
      width: 130,
      render: (m: string) => <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#94a3b8' }}>{m}</span>,
    },
    {
      title: '修改时间',
      dataIndex: 'mod_time',
      key: 'mod_time',
      width: 170,
      render: (t: number) => <span style={{ fontSize: 12 }}>{t ? new Date(t * 1000).toLocaleString() : '-'}</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      render: (_: unknown, r: SftpEntry) =>
        r.is_dir ? null : (
          <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(r)} style={{ padding: 0 }}>
            下载
          </Button>
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
      width={760}
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
              style={{ width: 320 }}
              placeholder="远端路径，回车跳转"
            />
            <Button icon={<ReloadOutlined />} onClick={() => load(path)} loading={loading}>
              刷新
            </Button>
            <Upload
              accept="*"
              showUploadList={false}
              beforeUpload={(file) => {
                handleUpload(file as File);
                return false;
              }}
            >
              <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
                上传到当前目录
              </Button>
            </Upload>
          </Space>

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
    </Drawer>
  );
};

export default SftpDrawer;
