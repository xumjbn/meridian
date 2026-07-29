import React, { useEffect, useState, useRef } from 'react';
import {
  Table,
  Button,
  Space,
  Input,
  InputNumber,
  Select,
  Drawer,
  Form,
  Badge,
  Tag,
  Popconfirm,
  Typography,
  message,
  Modal,
  Descriptions,
  Card,
  Segmented,
  Collapse,
  Timeline,
  Spin,
  Tooltip,
  Upload,
  Row,
  Col
} from 'antd';
import {
  SearchOutlined,
  PlusOutlined,
  CodeOutlined,
  EditOutlined,
  DeleteOutlined,
  CompassOutlined,
  CopyOutlined,
  InfoCircleOutlined,
  SyncOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  UploadOutlined,
  FolderOpenOutlined,
  TagOutlined
} from '@ant-design/icons';
import {
  getAssets,
  createAsset,
  updateAsset,
  deleteAsset,
  getCredentials,
  pingAsset,
  batchPingAssets,
  getTags,
  createTag,
  updateTag,
  deleteTag,
  getAssetHistory,
  importAssets,
  getAssetUptime,
  getUsers,
  type Asset,
  type Credential,
  type AssetHistory,
  type AssetUptime,
  type User,
  type Tag as GlobalTag
} from '../services/api';
import { SftpDrawer } from '../components/SftpDrawer';
import { TableToolbar, tablePanelStyle } from '../components/TableToolbar';
import { palette, pagePadding } from '../theme';
import { useI18n } from '../i18n';
import { saveBlob } from '../saveFile';
import { useTerminals } from '../terminalSessions';

const { Text, Title, Paragraph } = Typography;
const { Option } = Select;

export const Assets: React.FC = () => {
  const { text } = useI18n();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchKey, setSearchKey] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');

  // 正在探测的资产ID映射
  const [pingingIds, setPingingIds] = useState<Record<number, boolean>>({});

  // 在 App 内部打开终端会话（不再新开浏览器标签页）
  const { open: openTerminal } = useTerminals();

  // 弹窗状态
  const [modalVisible, setModalVisible] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [form] = Form.useForm();

  // 资产详情抽屉
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerAsset, setDrawerAsset] = useState<Asset | null>(null);
  // 抽屉内的变更历史
  const [history, setHistory] = useState<AssetHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // 抽屉内的可用性（近 24h）
  const [uptime, setUptime] = useState<AssetUptime | null>(null);
  // SFTP 文件管理抽屉
  const [sftpAsset, setSftpAsset] = useState<Asset | null>(null);
  const [sftpOpen, setSftpOpen] = useState(false);
  // 管理员可分配资产归属用户
  const isAdmin = (localStorage.getItem('wjw-role') || 'admin') === 'admin';
  const [users, setUsers] = useState<User[]>([]);

  // 常用功能：批量选择 / 分组
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [groupBy, setGroupBy] = useState<'none' | 'type' | 'status' | 'tag'>('none');
  const [activeCollapseKeys, setActiveCollapseKeys] = useState<string[]>([]);
  // 按分组维度分别记忆：该维度已展开的面板键、已知的分组键（用于识别新分组）
  const expandedByGroupRef = useRef<Record<string, string[]>>({});
  const knownKeysByGroupRef = useRef<Record<string, string[]>>({});

  // 全局标签列表与管理 Modal 状态
  const [globalTags, setGlobalTags] = useState<GlobalTag[]>([]);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);

  const fetchGlobalTags = async () => {
    try {
      const data = await getTags();
      setGlobalTags(data || []);
    } catch (e) {
      console.error('获取标签列表失败:', e);
    }
  };

  // 标签管理内部状态与处理方法
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editingTagName, setEditingTagName] = useState('');
  const [editingTagColor, setEditingTagColor] = useState('#1890ff');

  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#1890ff');

  const presetColors = ['#1890ff', '#52c41a', '#f5222d', '#fa8c16', '#722ed1', '#13c2c2', '#eb2f96', '#2f54eb', '#faad14', '#3f51b5', '#607d8b'];

  const getTagColor = (tagName: string) => {
    if (!globalTags) return '#1890ff';
    const found = globalTags.find(t => t.name === tagName);
    return found ? found.color : '#1890ff';
  };

  const fieldLabelMap: Record<string, string> = {
    name: text('asset.f.name'),
    ip: text('asset.f.ip'),
    type: text('asset.f.type'),
    status: text('asset.f.status'),
    vendor: text('asset.f.vendor'),
    os_version: text('asset.f.osVersion'),
    arch: text('asset.f.arch'),
    virtualization: text('asset.f.virt'),
    ports: text('asset.f.ports'),
    tags: text('asset.f.tags'),
    description: text('asset.f.description'),
    credential_id: text('asset.f.credential'),
  };

  const translateHistoryValue = (field: string, val: string) => {
    if (!val || val === 'null' || val === '[]') return text('asset.none');
    if (field === 'credential_id') {
      const credId = Number(val);
      const cred = credentials.find(c => c.id === credId);
      return cred ? `${cred.name} (${cred.username})` : text('asset.credId', { id: val });
    }
    if (field === 'type') {
      return typeLabelMap[val] || val;
    }
    if (field === 'status') {
      return statusLabelMap[val] || val;
    }
    return val;
  };

  const handleCreateTag = async () => {
    const name = newTagName.trim();
    if (!name) {
      message.error(text('tag.nameEmpty'));
      return;
    }
    if (globalTags.some(t => t.name === name)) {
      message.error(text('tag.exists'));
      return;
    }
    try {
      await createTag({ name, color: newTagColor });
      message.success(text('tag.created'));
      setNewTagName('');
      fetchGlobalTags();
      fetchAssets();
    } catch (e: any) {
      message.error(e.message || text('tag.createFailed'));
    }
  };

  const handleSaveTag = async (id: number) => {
    const name = editingTagName.trim();
    if (!name) {
      message.error(text('tag.nameEmpty'));
      return;
    }
    if (globalTags.some(t => t.name === name && t.id !== id)) {
      message.error(text('tag.nameExists'));
      return;
    }
    try {
      await updateTag(id, { name, color: editingTagColor });
      message.success(text('tag.updated'));
      setEditingTagId(null);
      fetchGlobalTags();
      fetchAssets();
    } catch (e: any) {
      message.error(e.message || text('tag.updateFailed'));
    }
  };

  const handleDeleteTag = async (id: number) => {
    try {
      await deleteTag(id);
      message.success(text('tag.deleted'));
      fetchGlobalTags();
      fetchAssets();
    } catch (e: any) {
      message.error(e.message || text('tag.deleteFailed'));
    }
  };

  const tagColumns = [
    {
      title: text('tag.col.name'),
      dataIndex: 'name',
      key: 'name',
      // 入参原名 text，会遮蔽 i18n 的 text()，统一改名 v
      render: (v: string, record: GlobalTag) => {
        if (editingTagId === record.id) {
          return (
            <Input 
              value={editingTagName} 
              onChange={e => setEditingTagName(e.target.value)} 
              size="small" 
              style={{ width: 120 }}
            />
          );
        }
        return <Tag color={record.color} style={{ borderRadius: '4px', fontWeight: 500 }}>{v}</Tag>;
      }
    },
    {
      title: text('tag.col.color'),
      dataIndex: 'color',
      key: 'color',
      render: (color: string, record: GlobalTag) => {
        if (editingTagId === record.id) {
          return (
            <Space wrap size={4}>
              {presetColors.map(c => (
                <div 
                  key={c}
                  onClick={() => setEditingTagColor(c)}
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    backgroundColor: c,
                    cursor: 'pointer',
                    border: editingTagColor === c ? '2px solid #000' : '1px solid #ddd',
                    boxShadow: editingTagColor === c ? '0 0 2px rgba(0,0,0,0.5)' : 'none'
                  }}
                />
              ))}
            </Space>
          );
        }
        return (
          <Space>
            <span style={{ 
              display: 'inline-block', 
              width: 12, 
              height: 12, 
              borderRadius: '50%', 
              backgroundColor: color 
            }} />
            <Text code>{color}</Text>
          </Space>
        );
      }
    },
    {
      title: text('users.col.action'),
      key: 'action',
      render: (_: any, record: GlobalTag) => {
        if (editingTagId === record.id) {
          return (
            <Space size="middle">
              <Button type="link" size="small" onClick={() => handleSaveTag(record.id!)}>{text('asset.save')}</Button>
              <Button type="link" size="small" onClick={() => setEditingTagId(null)}>{text('common.cancel')}</Button>
            </Space>
          );
        }
        return (
          <Space size="middle">
            <Button type="link" size="small" onClick={() => {
              setEditingTagId(record.id!);
              setEditingTagName(record.name);
              setEditingTagColor(record.color);
            }}>{text('asset.edit')}</Button>
            <Popconfirm
              title={text('tag.deleteConfirm')}
              onConfirm={() => handleDeleteTag(record.id!)}
              okText={text('common.yes')} cancelText={text('common.no')} okButtonProps={{ danger: true }}
            >
              <Button type="link" danger size="small">{text('k8s.delete')}</Button>
            </Popconfirm>
          </Space>
        );
      }
    }
  ];


  const fetchAssets = async () => {
    try {
      setLoading(true);
      const data = await getAssets({
        q: searchKey,
        type: filterType,
        status: filterStatus,
      });
      setAssets(data);
    } catch (e) {
      message.error(text('asset.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const fetchCredentials = async () => {
    try {
      const data = await getCredentials();
      setCredentials(data);
    } catch (e) {
      // ignore
    }
  };

  // 管理员加载用户列表，用于资产归属分配
  useEffect(() => {
    if (!isAdmin) return;
    getUsers().then(setUsers).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 搜索输入防抖：停止输入 350ms 后再发起查询，避免逐字符打接口
  useEffect(() => {
    const t = setTimeout(() => setSearchKey(searchInput), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    fetchAssets();
    fetchCredentials();
    fetchGlobalTags();
  }, [searchKey, filterType, filterStatus]);

  // 监听分组方式或资产变动，按「分组维度」分别维护展开/折叠状态：
  // 切换维度时恢复该维度上次的折叠状态；仅对该维度真正新增的分组默认展开。
  useEffect(() => {
    if (groupBy === 'none') return;
    const currentKeys = groupedAssets().map(([k]) => k);
    const known = knownKeysByGroupRef.current[groupBy];
    const saved = expandedByGroupRef.current[groupBy];

    let nextExpanded: string[];
    if (saved === undefined) {
      // 该维度首次启用：全部展开
      nextExpanded = currentKeys;
    } else {
      // 保留该维度记忆的展开项（仅限仍存在的分组）+ 该维度新出现的分组（默认展开）
      const newKeys = currentKeys.filter((k) => !(known || []).includes(k));
      nextExpanded = Array.from(new Set([...saved.filter((k) => currentKeys.includes(k)), ...newKeys]));
    }

    expandedByGroupRef.current[groupBy] = nextExpanded;
    knownKeysByGroupRef.current[groupBy] = currentKeys;
    setActiveCollapseKeys(nextExpanded);
  }, [groupBy, assets]);

  // 抽屉打开时拉取该资产的变更历史与可用性
  useEffect(() => {
    if (!drawerVisible || !drawerAsset?.id) {
      setHistory([]);
      setUptime(null);
      return;
    }
    let cancelled = false;
    const id = drawerAsset.id;
    setHistoryLoading(true);
    getAssetHistory(id)
      .then((data) => {
        if (!cancelled) setHistory(data);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    getAssetUptime(id, 24)
      .then((data) => {
        if (!cancelled) setUptime(data);
      })
      .catch(() => {
        if (!cancelled) setUptime(null);
      });
    return () => {
      cancelled = true;
    };
  }, [drawerVisible, drawerAsset?.id]);

  const handleOpenAdd = () => {
    setEditingAsset(null);
    form.resetFields();
    setModalVisible(true);
  };

  // 开放端口在 ports 字段以 JSON 数组字符串存储；表单里用逗号分隔文本编辑
  const portsJsonToText = (json?: string): string => {
    if (!json) return '';
    try {
      const arr = JSON.parse(json);
      return Array.isArray(arr) ? arr.join(', ') : String(json);
    } catch {
      return json;
    }
  };
  const portsTextToJson = (text?: string): string => {
    if (!text || !String(text).trim()) return '';
    const nums = String(text)
      .split(/[,，\s]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0 && n <= 65535);
    return JSON.stringify(Array.from(new Set(nums)).sort((a, b) => a - b));
  };

  const handleOpenEdit = (record: Asset) => {
    let formValues = { ...record } as any;
    if (record.tags) {
      try {
        formValues.tags = JSON.parse(record.tags);
      } catch (e) {
        formValues.tags = [];
      }
    } else {
      formValues.tags = [];
    }
    formValues.ports = portsJsonToText(record.ports); // JSON → 逗号文本
    setEditingAsset(record);
    form.setFieldsValue(formValues);
    setModalVisible(true);
  };

  // 复制资产：以现有资产为模板新建一台。同网段批量录入时最省事——
  // 类型/端口/凭据/标签/备注全带过来，只有 IP 留空强制填新的（IP 唯一）。
  const handleCopy = (record: Asset) => {
    let tags: string[] = [];
    if (record.tags) {
      try {
        tags = JSON.parse(record.tags) || [];
      } catch {
        tags = [];
      }
    }
    setEditingAsset(null); // 走「新建」流程而非更新
    form.setFieldsValue({
      ...record,
      id: undefined,
      ip: '',                       // IP 唯一，必须手填新的
      name: text('asset.copySuffix', { name: record.name }),
      status: undefined,            // 在线状态由探测决定，不继承
      tags,
      ports: portsJsonToText(record.ports),
    });
    setModalVisible(true);
    message.info(text('asset.copyPrefilled'));
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteAsset(id);
      message.success(text('asset.deleted'));
      fetchAssets();
    } catch (e) {
      message.error(text('asset.deleteFailed'));
    }
  };

  const handleSubmit = async (values: any) => {
    try {
      const payload = { ...values };
      if (Array.isArray(values.tags)) {
        payload.tags = JSON.stringify(values.tags);
      } else {
        payload.tags = JSON.stringify([]);
      }
      // 逗号文本 → JSON 数组字符串
      payload.ports = portsTextToJson(values.ports);

      // 自动注册未在 globalTags 中保存的新添加标签
      if (Array.isArray(values.tags)) {
        const newTags = values.tags.filter((t: string) => !globalTags.some(gt => gt.name === t));
        for (const nt of newTags) {
          try {
            await createTag({ name: nt, color: '#1890ff' });
          } catch (e) {
            console.error('自动创建标签失败:', e);
          }
        }
        if (newTags.length > 0) {
          fetchGlobalTags();
        }
      }

      if (editingAsset && editingAsset.id) {
        await updateAsset(editingAsset.id, payload);
        message.success(text('asset.updated'));
      } else {
        await createAsset(payload);
        message.success(text('asset.created'));
      }
      setModalVisible(false);
      fetchAssets();
    } catch (e) {
      message.error(text('asset.submitFailed'));
    }
  };

  const handleConnectConsole = (record: Asset) => {
    if (record.id == null) return;
    openTerminal({ assetId: record.id, name: record.name, ip: record.ip });
  };

  const handleShowDetail = (record: Asset) => {
    setDrawerAsset(record);
    setDrawerVisible(true);
  };

  // 单资产在线探测
  const handlePing = async (id: number) => {
    setPingingIds((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await pingAsset(id);
      if (res.status === 'online') {
        message.success(text('asset.pingOnline', { ip: res.ip }));
      } else {
        message.warning(text('asset.pingOffline', { ip: res.ip }));
      }
      fetchAssets();
      // 如果抽屉正打开且是当前资产，同步更新抽屉内状态
      if (drawerAsset && drawerAsset.id === id) {
        setDrawerAsset((prev) => prev ? { ...prev, status: res.status } : null);
      }
    } catch (e: any) {
      message.error(text('asset.pingFailed', { msg: e.message || text('asset.netTimeout') }));
    } finally {
      setPingingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  // 这里原先有「单资产采集」和「批量采集资源用量」：一次性抓 CPU/内存存库，
  // 再在列表里显示。列表看到的永远是上次采集那一刻的快照，没有意义。
  // 资源用量改为只在终端会话里实时看（LiveMetricsBar / WebSocket），两个动作删除。

  // ── 常用功能：批量探测 / 批量删除 / 导出 CSV ──────────────
  const handleBatchPing = async () => {
    const ids = selectedRowKeys.map(Number);
    if (ids.length === 0) return;
    message.loading({ content: text('asset.batchPinging', { n: ids.length }), key: 'batch_ping', duration: 0 });
    try {
      await batchPingAssets(ids);
      message.success({ content: text('asset.batchPingDone', { n: ids.length }), key: 'batch_ping' });
    } catch (e: any) {
      message.error({ content: text('asset.batchPingFailed', { msg: e.message || text('asset.netTimeout') }), key: 'batch_ping' });
    }
    setSelectedRowKeys([]);
    fetchAssets();
  };


  const handleBatchDelete = async () => {
    const ids = selectedRowKeys.map(Number);
    if (ids.length === 0) return;
    await Promise.allSettled(ids.map((id) => deleteAsset(id)));
    message.success(text('asset.batchDeleted', { n: ids.length }));
    setSelectedRowKeys([]);
    fetchAssets();
  };

  const handleExportCSV = async () => {
    const header = [text('asset.csv.name'), 'IP', text('asset.csv.type'), text('asset.csv.status'), text('asset.csv.vendor'), text('asset.csv.os'), text('asset.csv.arch'), text('asset.csv.virt'), text('asset.csv.ports'), text('asset.csv.tags'), text('asset.csv.description')];
    const rows = assets.map((a) => [
      a.name, a.ip, a.type, a.status || '', a.vendor || '', a.os_version || '', a.arch || '', a.virtualization || '',
      a.ports || '', a.tags || '', (a.description || '').replace(/\n/g, ' '),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const ok = await saveBlob(blob, `wjw-assets-${ts}.csv`);
    if (ok) message.success(text('asset.exported', { n: assets.length }));
  };

  const handleImportCSV = async (file: File) => {
    message.loading({ content: text('asset.importing'), key: 'import', duration: 0 });
    try {
      const res = await importAssets(file);
      message.success({
        content: text('asset.importDone', { created: res.created, updated: res.updated, failed: res.failed }),
        key: 'import',
      });
      if (res.failed > 0 && res.errors?.length) {
        Modal.warning({
          title: text('asset.importFailedRows', { n: res.failed }),
          width: 520,
          content: (
            <div style={{ maxHeight: 320, overflowY: 'auto', fontSize: 13 }}>
              {res.errors.map((e, i) => (
                <div key={i} style={{ padding: '2px 0', color: '#b45309' }}>{e}</div>
              ))}
            </div>
          ),
        });
      }
      fetchAssets();
    } catch (e: any) {
      message.error({ content: e?.message || text('asset.importFailed'), key: 'import' });
    }
  };

  const typeLabelMap: Record<string, string> = {
    server: text('asset.type.server'), switch: text('asset.type.switch'), router: text('asset.type.router'), other: text('asset.type.other'),
  };
  const statusLabelMap: Record<string, string> = { online: text('k8s.online'), offline: text('k8s.offline'), unknown: text('asset.unknown') };

  // 按 groupBy 把资产分组 -> [组名, 资产[]][]
  const groupedAssets = (): [string, Asset[]][] => {
    const map = new Map<string, Asset[]>();
    assets.forEach((a) => {
      let keys: string[] = [text('asset.group.other')];
      if (groupBy === 'type') keys = [typeLabelMap[a.type] || a.type];
      else if (groupBy === 'status') keys = [statusLabelMap[a.status || 'unknown'] || text('asset.unknown')];
      else if (groupBy === 'tag') {
        let tags: string[] = [];
        try {
          const parsed = a.tags ? JSON.parse(a.tags) : [];
          tags = Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          tags = [];
        }
        keys = tags.length ? tags : [text('asset.group.untagged')];
      }
      keys.forEach((k) => {
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(a);
      });
    });
    return Array.from(map.entries());
  };

  const renderPorts = (portsStr?: string) => {
    if (!portsStr) return <Text type="secondary">{text('asset.noPorts')}</Text>;
    try {
      const ports: number[] = JSON.parse(portsStr);
      if (!Array.isArray(ports) || ports.length === 0) return <Text type="secondary">{text('asset.noPorts')}</Text>;
      return (
        <Space size={[0, 4]} wrap>
          {ports.map((port) => {
            let color = 'blue';
            if (port === 22) color = 'green';
            if (port === 23) color = 'red';
            if (port === 80 || port === 443) color = 'cyan';
            if (port === 3306 || port === 5432) color = 'purple';
            return (
              <Tag color={color} key={port} style={{ margin: 0, borderRadius: '4px' }}>
                {port}
              </Tag>
            );
          })}
        </Space>
      );
    } catch (e) {
      return <span style={{ fontFamily: 'monospace' }}>{portsStr}</span>;
    }
  };

  // 虚拟化标签：绿色=实体机，其它颜色=虚拟机/云/容器，一眼区分是否为虚拟机
  const virtTagMap: Record<string, { label: string; color: string }> = {
    physical: { label: text('asset.virt.physical'), color: 'green' },
    vmware: { label: 'VMware', color: 'blue' },
    kvm: { label: 'KVM', color: 'geekblue' },
    'hyper-v': { label: 'Hyper-V', color: 'purple' },
    virtualbox: { label: 'VirtualBox', color: 'orange' },
    xen: { label: 'Xen', color: 'cyan' },
    qemu: { label: 'QEMU', color: 'geekblue' },
    aws: { label: 'AWS', color: 'gold' },
    gcp: { label: 'GCP', color: 'gold' },
    aliyun: { label: text('asset.virt.aliyun'), color: 'gold' },
    openstack: { label: 'OpenStack', color: 'gold' },
    parallels: { label: 'Parallels', color: 'magenta' },
  };
  const CLOUD_VIRT = new Set(['aws', 'gcp', 'aliyun', 'openstack']);
  const renderVirtTag = (v?: string) => {
    if (!v) return null;
    const base: React.CSSProperties = { borderRadius: 4, margin: 0 };
    if (v === 'physical') return <Tag color="green" style={base}>🖥 {text('asset.virt.physical')}</Tag>;
    if (v.startsWith('container:'))
      return <Tag color="magenta" style={base}>📦 {text('asset.virt.container')}·{v.slice('container:'.length)}</Tag>;
    const info = virtTagMap[v] || { label: v, color: 'geekblue' };
    const prefix = CLOUD_VIRT.has(v) ? '☁ ' : '💻 ';
    return <Tag color={info.color} style={base}>{prefix}{info.label}</Tag>;
  };


  const renderTags = (tagsStr?: string) => {
    if (!tagsStr) return null;
    try {
      const tags: string[] = JSON.parse(tagsStr);
      if (!Array.isArray(tags) || tags.length === 0) return null;
      return (
        <Space size={[4, 2]} wrap>
          {tags.map((tag) => {
            const hexColor = getTagColor(tag);
            return (
              <Tag
                key={tag}
                color={hexColor}
                // 紧凑：与名称同行显示，收窄内边距、去掉右外边距
                style={{ borderRadius: 3, fontWeight: 500, margin: 0, padding: '0 6px', lineHeight: '18px' }}
              >
                {tag}
              </Tag>
            );
          })}
        </Space>
      );
    } catch (e) {
      return null;
    }
  };

  const columns = [
    {
      title: text('asset.col.name'),
      dataIndex: 'name',
      key: 'name',
      render: (v: string, record: Asset) => {
        // 紧凑单行：名称 → 标签 → 虚拟化 → 「系统(厂商) · 架构」，不再另起一行，
        // 每行少占一行高度。原始 SSH/Telnet banner（os_version）过长，仅在详情抽屉展示。
        const info = [record.vendor, record.arch].filter(Boolean).join(' · ');
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
            <a onClick={() => handleShowDetail(record)} style={{ fontWeight: 600, color: palette.text, whiteSpace: 'nowrap' }}>
              {v}
            </a>
            {renderTags(record.tags)}
            {renderVirtTag(record.virtualization)}
            {info && <Text type="secondary" style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>{info}</Text>}
          </div>
        );
      },
    },
    {
      title: text('asset.col.ip'),
      dataIndex: 'ip',
      key: 'ip',
      render: (v: string) => <span style={{ fontFamily: 'monospace', fontWeight: 500, color: '#334155' }}>{v}</span>,
    },
    {
      title: text('asset.f.type'),
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => {
        const typeMap: Record<string, { label: string; color: string }> = {
          server: { label: text('asset.type.server'), color: 'blue' },
          switch: { label: text('asset.type.switch'), color: 'green' },
          router: { label: text('asset.type.router'), color: 'orange' },
          other: { label: text('asset.type.other'), color: 'default' },
        };
        const info = typeMap[type] || { label: type, color: 'default' };
        return <Tag color={info.color} style={{ borderRadius: '4px' }}>{info.label}</Tag>;
      },
    },
    {
      title: text('asset.col.status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        if (status === 'online') return <Badge status="success" text={text('k8s.online')} />;
        if (status === 'offline') return <Badge status="error" text={text('k8s.offline')} />;
        return <Badge status="default" text={text('asset.unknown')} />;
      },
    },
    {
      title: text('asset.f.ports'),
      dataIndex: 'ports',
      key: 'ports',
      render: (v: string) => renderPorts(v),
    },
    // 原先这里有一列「CPU / 内存」，显示的是点「采集」才更新的一次性快照，
    // 列表里看到的永远是上次采集那一刻的数字，越看越假。资源用量只在终端
    // 会话里看实时的（LiveMetricsBar，走 WebSocket 持续推送）。
    {
      title: text('users.col.action'),
      key: 'action',
      render: (_: any, record: Asset) => (
        <Space size="middle">
          <Button
            type="link"
            size="small"
            icon={<CodeOutlined />}
            onClick={() => handleConnectConsole(record)}
            style={{ padding: 0, fontWeight: 500 }}
          >
            {text('asset.connectTerminal')}
          </Button>
          <Button
            type="link"
            size="small"
            icon={<FolderOpenOutlined />}
            onClick={() => { setSftpAsset(record); setSftpOpen(true); }}
            style={{ padding: 0, fontWeight: 500, color: '#f59e0b' }}
          >
            {text('asset.files')}
          </Button>
          <Button
            type="link"
            size="small"
            icon={pingingIds[record.id!] ? <SyncOutlined spin /> : <CompassOutlined />}
            loading={pingingIds[record.id!]}
            onClick={() => handlePing(record.id!)}
            style={{ padding: 0, fontWeight: 500, color: '#0ea5e9' }}
          >
            {text('asset.ping')}
          </Button>
          <Tooltip title={text('asset.copyTip')}>
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined style={{ color: '#475569' }} />}
              onClick={() => handleCopy(record)}
              style={{ padding: 0 }}
            />
          </Tooltip>
          <Tooltip title={text('asset.edit')}>
            <Button
              type="text"
              size="small"
              icon={<EditOutlined style={{ color: '#475569' }} />}
              onClick={() => handleOpenEdit(record)}
              style={{ padding: 0 }}
            />
          </Tooltip>
          <Popconfirm
            title={text('asset.deleteConfirm')}
            onConfirm={() => handleDelete(record.id!)}
            okText={text('common.yes')}
            cancelText={text('common.no')}
            okButtonProps={{ danger: true }}
          >
            <Button type="text" danger icon={<DeleteOutlined />} style={{ padding: 0 }} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ background: palette.bg, minHeight: '100%' }}>

      <div style={{ padding: pagePadding }} className="wjw-page-in">
        <div style={groupBy === 'none' ? tablePanelStyle : { ...tablePanelStyle, background: 'transparent', border: 'none' }}>
          {/* 工具栏：左=新建/批量操作，右=检索/过滤/分组 */}
          <TableToolbar
            title={text('nav.assets')}
            subtitle={text('asset.subtitle')}
            icon={<DatabaseOutlined />}
            onRefresh={fetchAssets}
            loading={loading}
            selectedCount={groupBy === 'none' ? selectedRowKeys.length : 0}
            onClearSelection={() => setSelectedRowKeys([])}
            left={
              <>
                <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenAdd}>
                  {text('asset.addManual')}
                </Button>
                {groupBy === 'none' && selectedRowKeys.length > 0 && (
                  <>
                    <Button icon={<CompassOutlined />} onClick={handleBatchPing}>{text('asset.batchPing')}</Button>
                    <Popconfirm
                      title={text('asset.batchDeleteConfirm', { n: selectedRowKeys.length })}
                      onConfirm={handleBatchDelete}
                      okText={text('common.yes')} cancelText={text('common.no')} okButtonProps={{ danger: true }}
                    >
                      <Button danger icon={<DeleteOutlined />}>{text('asset.batchDelete')}</Button>
                    </Popconfirm>
                  </>
                )}
                <Button icon={<TagOutlined />} onClick={() => setIsTagModalOpen(true)}>{text('asset.tagManage')}</Button>
                <Upload
                  accept=".csv"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    handleImportCSV(file as File);
                    return false; // 阻止 antd 自动上传，改由我们手动调用接口
                  }}
                >
                  <Button icon={<UploadOutlined />}>{text('asset.importCsv')}</Button>
                </Upload>
                <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>{text('asset.exportCsv')}</Button>
              </>
            }
            right={
              <>
                <Input
                  placeholder={text('asset.searchPlaceholder')}
                  prefix={<SearchOutlined style={{ color: palette.textMute }} />}
                  style={{ width: 210 }}
                  allowClear
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
                <Select placeholder={text('asset.f.type')} style={{ width: 130 }} allowClear onChange={(val) => setFilterType(val || '')}>
                  <Option value="server">{text('asset.type.server')}</Option>
                  <Option value="switch">{text('asset.type.switch')}</Option>
                  <Option value="router">{text('asset.type.router')}</Option>
                  <Option value="other">{text('asset.type.other')}</Option>
                </Select>
                <Select placeholder={text('asset.f.status')} style={{ width: 120 }} allowClear onChange={(val) => setFilterStatus(val || '')}>
                  <Option value="online">{text('k8s.online')}</Option>
                  <Option value="offline">{text('k8s.offline')}</Option>
                  <Option value="unknown">{text('asset.unknown')}</Option>
                </Select>
                <Segmented
                  value={groupBy}
                  onChange={(v) => setGroupBy(v as 'none' | 'type' | 'status' | 'tag')}
                  options={[
                    { label: text('asset.group.none'), value: 'none' },
                    { label: text('asset.csv.type'), value: 'type' },
                    { label: text('asset.csv.status'), value: 'status' },
                    { label: text('asset.csv.tags'), value: 'tag' },
                  ]}
                />
              </>
            }
          />

          {/* 表格主体 / 分组视图 */}
          {groupBy === 'none' ? (
            <Table
              className="wjw-table"
              columns={columns}
              dataSource={assets}
              rowKey="id"
              loading={loading}
              rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys) }}
              pagination={{ pageSize: 10, showSizeChanger: false, style: { padding: '0 16px' } }}
            />
          ) : (
          (() => {
            const groups = groupedAssets();
            return (
              <Collapse
                activeKey={activeCollapseKeys}
                onChange={(keys) => {
                  const next = keys as string[];
                  setActiveCollapseKeys(next);
                  // 记忆当前维度的展开/折叠状态，切换维度再切回时恢复
                  expandedByGroupRef.current[groupBy] = next;
                }}
                items={groups.map(([k, rows]) => ({
                  key: k,
                  label: (
                    <span style={{ fontWeight: 600, color: palette.text }}>
                      {k} <Tag style={{ marginLeft: 6 }}>{rows.length}</Tag>
                    </span>
                  ),
                  children: (
                    <Table columns={columns} dataSource={rows} rowKey="id" size="small" pagination={false} />
                  ),
                }))}
              />
            );
          })()
          )}
        </div>

      {/* 手动录入/编辑资产弹窗 */}
      <Modal
        title={editingAsset ? text('asset.editTitle') : text('asset.createTitle')}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        destroyOnHidden
        width={640}
      >
        {/* 9 个字段原先单列铺开，弹窗高得要滚动。短字段两两并排，整体矮一半左右。 */}
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{ ssh_port: 22 }}
          style={{ marginTop: 12 }}
          size="small"
        >
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                label={text('asset.form.name')}
                name="name"
                rules={[{ required: true, message: text('asset.form.nameRequired') }]}
                style={{ marginBottom: 12 }}
              >
                <Input placeholder={text('asset.form.namePlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label={text('asset.form.ip')}
                name="ip"
                rules={[{ required: true, message: text('asset.form.ipRequired') }]}
                style={{ marginBottom: 12 }}
              >
                {/* IP 可改：换网段/迁机器时不必删了重建，后端会查重并记入变更历史 */}
                <Input placeholder={text('asset.form.ipPlaceholder')} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                label={text('asset.form.kind')}
                name="type"
                rules={[{ required: true, message: text('asset.form.kindRequired') }]}
                style={{ marginBottom: 12 }}
              >
                <Select placeholder={text('asset.form.kindPlaceholder')}>
                  <Option value="server">{text('asset.type.server')}</Option>
                  <Option value="switch">{text('asset.type.switch')}</Option>
                  <Option value="router">{text('asset.type.router')}</Option>
                  <Option value="other">{text('asset.type.other')}</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label={text('asset.form.sshPort')}
                name="ssh_port"
                tooltip={text('asset.form.sshPortTip')}
                style={{ marginBottom: 12 }}
              >
                <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder={text('asset.form.sshPortPlaceholder')} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            label={text('asset.f.tags')}
            name="tags"
            style={{ marginBottom: 12 }}
          >
            <Select
              mode="tags"
              style={{ width: '100%' }}
              placeholder={text('asset.form.tagsPlaceholder')}
              tokenSeparators={[',', ' ']}
            >
              {(globalTags || []).map(gt => (
                <Option value={gt.name} key={gt.id || gt.name}>
                  <Space>
                    <span style={{ 
                      display: 'inline-block', 
                      width: 8, 
                      height: 8, 
                      borderRadius: '50%', 
                      backgroundColor: gt.color 
                    }} />
                    {gt.name}
                  </Space>
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                label={text('asset.form.credential')}
                name="credential_id"
                style={{ marginBottom: 12 }}
              >
                <Select placeholder={text('asset.form.credentialPlaceholder')} allowClear>
                  {credentials.map((c) => (
                    <Option value={c.id} key={c.id}>
                      {c.name} ({c.username})
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label={text('asset.f.ports')}
                name="ports"
                tooltip={text('asset.form.portsTip')}
                style={{ marginBottom: 12 }}
              >
                <Input placeholder={text('asset.form.portsPlaceholder')} />
              </Form.Item>
            </Col>
          </Row>

          {isAdmin && (
            <Form.Item
              label={text('asset.form.owner')}
              name="owner_id"
              tooltip={text('asset.form.ownerTip')}
              style={{ marginBottom: 12 }}
            >
              <Select placeholder={text('asset.form.ownerPlaceholder')} allowClear showSearch optionFilterProp="children">
                {users.map((u) => (
                  <Option value={u.id} key={u.id}>
                    {u.username}（{u.role === 'admin' ? text('users.role.admin') : text('users.role.user')}）
                  </Option>
                ))}
              </Select>
            </Form.Item>
          )}

          <Form.Item
            label={text('asset.form.description')}
            name="description"
            style={{ marginBottom: 12 }}
          >
            <Input.TextArea rows={2} placeholder={text('asset.form.descriptionPlaceholder')} />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 8, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setModalVisible(false)}>{text('common.cancel')}</Button>
              <Button type="primary" htmlType="submit">
                {text('asset.save')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 资产详情抽屉 */}
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <InfoCircleOutlined style={{ color: '#0284c7' }} />
            <span>{text('asset.detailTitle')}</span>
          </div>
        }
        placement="right"
        width={520}
        onClose={() => setDrawerVisible(false)}
        open={drawerVisible}
        styles={{ body: { padding: '24px' } }}
      >
        {drawerAsset && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', paddingBottom: '24px' }}>
              
              {/* 头部摘要卡片 */}
              <Card style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }} styles={{ body: { padding: '16px' } }}>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Title level={4} style={{ margin: 0, color: '#0f172a' }}>{drawerAsset.name}</Title>
                    {drawerAsset.status === 'online' ? (
                      <Tag color="green" style={{ borderRadius: '4px', margin: 0 }}>{text('k8s.online')}</Tag>
                    ) : drawerAsset.status === 'offline' ? (
                      <Tag color="red" style={{ borderRadius: '4px', margin: 0 }}>{text('k8s.offline')}</Tag>
                    ) : (
                      <Tag color="default" style={{ borderRadius: '4px', margin: 0 }}>{text('asset.unknown')}</Tag>
                    )}
                  </div>
                  <div>
                    <span style={{ fontSize: '13px', color: '#64748b', marginRight: '8px' }}>{text('asset.mgmtIp')}</span>
                    <Text copyable={{ text: drawerAsset.ip }} style={{ fontFamily: 'monospace', fontWeight: 600, color: '#334155', fontSize: '14px' }}>
                      {drawerAsset.ip}
                    </Text>
                  </div>
                  {drawerAsset.tags && (
                    <div style={{ marginTop: '4px' }}>
                      {renderTags(drawerAsset.tags)}
                    </div>
                  )}
                </Space>
              </Card>

              {/* 基础配置项目 */}
              <Descriptions title={text('asset.basicProps')} column={1} bordered size="small" styles={{ label: { width: '120px', background: '#f8fafc', color: '#475569' }, content: { color: '#1e293b' } }}>
                <Descriptions.Item label={text('asset.hwType')}>
                  {drawerAsset.type === 'server' && text('asset.type.server')}
                  {drawerAsset.type === 'switch' && text('asset.type.switch')}
                  {drawerAsset.type === 'router' && text('asset.type.router')}
                  {drawerAsset.type === 'other' && text('asset.type.other')}
                </Descriptions.Item>
                <Descriptions.Item label={text('asset.vendorId')}>
                  {drawerAsset.vendor || <Text type="secondary">{text('asset.noVendor')}</Text>}
                </Descriptions.Item>
                <Descriptions.Item label={text('asset.osVersion')}>
                  <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                    {drawerAsset.os_version || <Text type="secondary">{text('asset.noOsInfo')}</Text>}
                  </span>
                </Descriptions.Item>
                <Descriptions.Item label={text('asset.cpuArch')}>
                  {drawerAsset.arch ? (
                    <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{drawerAsset.arch}</span>
                  ) : (
                    <Text type="secondary">{text('asset.notCollected')}</Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label={text('asset.f.virt')}>
                  {drawerAsset.virtualization ? renderVirtTag(drawerAsset.virtualization) : <Text type="secondary">{text('asset.notCollected')}</Text>}
                </Descriptions.Item>
                <Descriptions.Item label={text('asset.lastScan')}>
                  {drawerAsset.last_scanned_at ? (
                    new Date(drawerAsset.last_scanned_at).toLocaleString('zh-CN')
                  ) : (
                    <Text type="secondary">{text('asset.neverScanned')}</Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label={text('asset.owner')}>
                  {drawerAsset.owner_name
                    ? <Tag color="blue" style={{ borderRadius: 4 }}>{drawerAsset.owner_name}</Tag>
                    : <Text type="secondary">{text('asset.noOwner')}</Text>}
                </Descriptions.Item>
                <Descriptions.Item label={text('asset.form.sshPort')}>
                  <span style={{ fontFamily: 'monospace' }}>{drawerAsset.ssh_port || 22}</span>
                </Descriptions.Item>
              </Descriptions>

              {/* 开放端口 */}
              <div>
                <Title level={5} style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#475569' }}>{text('asset.detectedPorts')}</Title>
                <div style={{ background: '#f8fafc', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  {renderPorts(drawerAsset.ports)}
                </div>
              </div>

              {/* 关联凭证和备注 */}
              <Descriptions title={text('asset.credAndNotes')} column={1} bordered size="small" styles={{ label: { width: '120px', background: '#f8fafc', color: '#475569' }, content: { color: '#1e293b' } }}>
                <Descriptions.Item label={text('asset.boundCred')}>
                  {drawerAsset.credential_id
                    ? credentials.find((c) => c.id === drawerAsset.credential_id)?.name || text('asset.credId', { id: drawerAsset.credential_id })
                    : <Text type="secondary">{text('asset.noBoundCred')}</Text>}
                </Descriptions.Item>
                <Descriptions.Item label={text('asset.notes')}>
                  <Paragraph style={{ margin: 0, fontStyle: drawerAsset.description ? 'normal' : 'italic', color: drawerAsset.description ? '#1e293b' : '#94a3b8' }}>
                    {drawerAsset.description || text('asset.noNotes')}
                  </Paragraph>
                </Descriptions.Item>
              </Descriptions>

              {/* 可用性（近 24h） */}
              <div>
                <Title level={5} style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#475569' }}>{text('asset.uptime24h')}</Title>
                <div style={{ background: '#f8fafc', padding: '16px', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  {!uptime || uptime.total === 0 ? (
                    <Text type="secondary">{text('asset.noUptimeData')}</Text>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{
                          fontSize: 26, fontWeight: 700,
                          color: uptime.uptime_percent >= 99 ? '#16a34a' : uptime.uptime_percent >= 90 ? '#d97706' : '#dc2626',
                        }}>
                          {uptime.uptime_percent.toFixed(1)}%
                        </div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>{text('asset.uptimeRate')}</div>
                      </div>
                      <div style={{ fontSize: 13, color: '#475569' }}>
                        {text('asset.uptimeProbes')} <b>{uptime.total}</b>　{text('k8s.online')} <b style={{ color: '#16a34a' }}>{uptime.online}</b>　
                        {text('k8s.offline')} <b style={{ color: '#dc2626' }}>{uptime.total - uptime.online}</b>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 变更历史 */}
              <div>
                <Title level={5} style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#475569' }}>{text('asset.changeHistory')}</Title>
                <div style={{ background: '#f8fafc', padding: '16px', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  {historyLoading ? (
                    <div style={{ textAlign: 'center', padding: '12px' }}><Spin /></div>
                  ) : history.length === 0 ? (
                    <Text type="secondary">{text('asset.noChanges')}</Text>
                  ) : (
                    <Timeline
                      items={history.map((h) => ({
                        key: h.id,
                        color: 'blue',
                        children: (
                          <div style={{ fontSize: '12px' }}>
                            <div style={{ fontWeight: 600, color: '#334155' }}>{fieldLabelMap[h.field] || h.field}</div>
                            <div style={{ color: '#475569', margin: '2px 0' }}>
                              <Text delete type="secondary" style={{ fontSize: '12px', marginRight: 4 }}>
                                {translateHistoryValue(h.field, h.old_value)}
                              </Text>
                              <span style={{ color: '#94a3b8', margin: '0 4px' }}>→</span>
                              <Text style={{ fontSize: '12px', color: '#0f172a' }}>
                                {translateHistoryValue(h.field, h.new_value)}
                              </Text>
                            </div>
                            <div style={{ color: '#94a3b8' }}>
                              {h.created_at ? new Date(h.created_at).toLocaleString('zh-CN') : '-'}
                            </div>
                          </div>
                        ),
                      }))}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* 抽屉底部动作栏 */}
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  style={{ flex: 1, height: '40px', borderColor: '#0ea5e9', color: '#0ea5e9', fontWeight: 500 }}
                  icon={pingingIds[drawerAsset.id!] ? <SyncOutlined spin /> : <CompassOutlined />}
                  loading={pingingIds[drawerAsset.id!]}
                  onClick={() => handlePing(drawerAsset.id!)}
                >
                  {text('asset.pingBtn')}
                </Button>
                <Button
                  style={{ height: '40px', width: '45px', padding: 0 }}
                  icon={<EditOutlined />}
                  onClick={() => {
                    handleOpenEdit(drawerAsset);
                  }}
                />
              </div>
              <Button
                type="primary"
                icon={<CodeOutlined />}
                onClick={() => {
                  setDrawerVisible(false);
                  handleConnectConsole(drawerAsset);
                }}
                style={{ width: '100%', height: '42px', fontWeight: 600, background: '#0f172a' }}
              >
                {text('asset.openSession')}
              </Button>
            </div>

          </div>
        )}
      </Drawer>

      <Modal
        title={
          <Space>
            <TagOutlined style={{ color: palette.primary }} />
            <span style={{ fontWeight: 600 }}>{text('tag.globalTitle')}</span>
          </Space>
        }
        open={isTagModalOpen}
        onCancel={() => setIsTagModalOpen(false)}
        footer={null}
        width={600}
        destroyOnClose
      >
        <div style={{ marginBottom: 20, padding: '16px 20px', backgroundColor: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
          <Title level={5} style={{ marginTop: 0, marginBottom: 12, fontSize: 14, color: '#1e293b' }}>{text('tag.newTag')}</Title>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Space style={{ width: '100%' }}>
              <Input 
                placeholder={text('tag.namePlaceholder')} 
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                style={{ width: 220, borderRadius: 6 }}
              />
              <Button type="primary" onClick={handleCreateTag} style={{ borderRadius: 6 }}>{text('tag.createBtn')}</Button>
            </Space>
            <Space align="center" size="small" wrap>
              <span style={{ fontSize: 13, color: '#64748b' }}>{text('tag.pickColor')}</span>
              {presetColors.map(c => (
                <div 
                  key={c}
                  onClick={() => setNewTagColor(c)}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    backgroundColor: c,
                    cursor: 'pointer',
                    border: newTagColor === c ? '2.5px solid #0f172a' : '1px solid #cbd5e1',
                    boxShadow: newTagColor === c ? '0 0 3px rgba(0,0,0,0.3)' : 'none',
                    transform: newTagColor === c ? 'scale(1.15)' : 'none',
                    transition: 'all 0.15s'
                  }}
                />
              ))}
            </Space>
          </Space>
        </div>

        <Table 
          dataSource={globalTags || []} 
          columns={tagColumns} 
          rowKey="id" 
          pagination={{ pageSize: 5 }} 
          size="small"
        />
      </Modal>

      {/* SFTP 文件管理抽屉 */}
      <SftpDrawer asset={sftpAsset} open={sftpOpen} onClose={() => setSftpOpen(false)} />
      </div>
    </div>
  );
};
