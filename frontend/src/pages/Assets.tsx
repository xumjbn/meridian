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
  Upload
} from 'antd';
import {
  SearchOutlined,
  PlusOutlined,
  CodeOutlined,
  EditOutlined,
  DeleteOutlined,
  CompassOutlined,
  InfoCircleOutlined,
  SyncOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  CloudDownloadOutlined,
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
  collectAsset,
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
import { PageHeader } from '../components/PageHeader';
import { SftpDrawer } from '../components/SftpDrawer';
import { palette, cardStyle } from '../theme';
import { useTerminals } from '../terminalSessions';

const { Text, Title, Paragraph } = Typography;
const { Option } = Select;

export const Assets: React.FC = () => {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchKey, setSearchKey] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');

  // 正在探测的资产ID映射
  const [pingingIds, setPingingIds] = useState<Record<number, boolean>>({});
  // 正在认证采集的资产ID映射
  const [collectingIds, setCollectingIds] = useState<Record<number, boolean>>({});

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
  const isAdmin = (localStorage.getItem('mrd-role') || 'admin') === 'admin';
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
    name: '显示名称',
    ip: '管理 IP',
    type: '设备类型',
    status: '在线状态',
    vendor: '设备厂商',
    os_version: '系统/固件版本',
    arch: 'CPU架构',
    virtualization: '虚拟化环境',
    ports: '开放端口',
    tags: '资产标签',
    description: '描述备注',
    credential_id: '管理凭证',
  };

  const translateHistoryValue = (field: string, val: string) => {
    if (!val || val === 'null' || val === '[]') return '无';
    if (field === 'credential_id') {
      const credId = Number(val);
      const cred = credentials.find(c => c.id === credId);
      return cred ? `${cred.name} (${cred.username})` : `凭证 ID: ${val}`;
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
      message.error('标签名字不能为空');
      return;
    }
    if (globalTags.some(t => t.name === name)) {
      message.error('该标签已存在');
      return;
    }
    try {
      await createTag({ name, color: newTagColor });
      message.success('标签创建成功');
      setNewTagName('');
      fetchGlobalTags();
      fetchAssets();
    } catch (e: any) {
      message.error(e.message || '创建标签失败');
    }
  };

  const handleSaveTag = async (id: number) => {
    const name = editingTagName.trim();
    if (!name) {
      message.error('标签名字不能为空');
      return;
    }
    if (globalTags.some(t => t.name === name && t.id !== id)) {
      message.error('标签名字已存在');
      return;
    }
    try {
      await updateTag(id, { name, color: editingTagColor });
      message.success('标签修改成功');
      setEditingTagId(null);
      fetchGlobalTags();
      fetchAssets();
    } catch (e: any) {
      message.error(e.message || '更新标签失败');
    }
  };

  const handleDeleteTag = async (id: number) => {
    try {
      await deleteTag(id);
      message.success('标签删除成功');
      fetchGlobalTags();
      fetchAssets();
    } catch (e: any) {
      message.error(e.message || '删除标签失败');
    }
  };

  const tagColumns = [
    {
      title: '标签名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: GlobalTag) => {
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
        return <Tag color={record.color} style={{ borderRadius: '4px', fontWeight: 500 }}>{text}</Tag>;
      }
    },
    {
      title: '颜色值',
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
      title: '操作',
      key: 'action',
      render: (_: any, record: GlobalTag) => {
        if (editingTagId === record.id) {
          return (
            <Space size="middle">
              <Button type="link" size="small" onClick={() => handleSaveTag(record.id!)}>保存</Button>
              <Button type="link" size="small" onClick={() => setEditingTagId(null)}>取消</Button>
            </Space>
          );
        }
        return (
          <Space size="middle">
            <Button type="link" size="small" onClick={() => {
              setEditingTagId(record.id!);
              setEditingTagName(record.name);
              setEditingTagColor(record.color);
            }}>编辑</Button>
            <Popconfirm
              title="确定删除此标签？这会自动将其从所有关联的资产中移除！"
              onConfirm={() => handleDeleteTag(record.id!)}
              okText="是" cancelText="否" okButtonProps={{ danger: true }}
            >
              <Button type="link" danger size="small">删除</Button>
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
      message.error('获取资产列表失败');
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

  const handleDelete = async (id: number) => {
    try {
      await deleteAsset(id);
      message.success('资产已成功删除');
      fetchAssets();
    } catch (e) {
      message.error('删除资产失败');
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
        message.success('资产信息更新成功');
      } else {
        await createAsset(payload);
        message.success('资产添加成功');
      }
      setModalVisible(false);
      fetchAssets();
    } catch (e) {
      message.error('操作失败，IP地址不可重复或格式错误');
    }
  };

  const handleConnectConsole = (record: Asset) => {
    if (record.id == null) return;
    openTerminal({ id: record.id, name: record.name, ip: record.ip });
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
        message.success(`探测完成：资产 ${res.ip} 在线`);
      } else {
        message.warning(`探测完成：资产 ${res.ip} 离线/不可达`);
      }
      fetchAssets();
      // 如果抽屉正打开且是当前资产，同步更新抽屉内状态
      if (drawerAsset && drawerAsset.id === id) {
        setDrawerAsset((prev) => prev ? { ...prev, status: res.status } : null);
      }
    } catch (e: any) {
      message.error(`探测失败: ${e.message || '网络连接超时'}`);
    } finally {
      setPingingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  // 单资产认证采集（采集 CPU 架构 / 系统等信息）
  const handleCollect = async (id: number) => {
    setCollectingIds((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await collectAsset(id);
      if (res.ok) {
        message.success(res.message);
      } else {
        message.warning(res.message);
      }
      fetchAssets();
    } catch (e: any) {
      message.error(`采集失败: ${e.message || '网络连接超时'}`);
    } finally {
      setCollectingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  // ── 常用功能：批量探测 / 批量删除 / 导出 CSV ──────────────
  const handleBatchPing = async () => {
    const ids = selectedRowKeys.map(Number);
    if (ids.length === 0) return;
    message.loading({ content: `正在批量探测 ${ids.length} 台资产...`, key: 'batch_ping', duration: 0 });
    try {
      await batchPingAssets(ids);
      message.success({ content: `已完成 ${ids.length} 台资产探测`, key: 'batch_ping' });
    } catch (e: any) {
      message.error({ content: `批量探测失败: ${e.message || '网络连接超时'}`, key: 'batch_ping' });
    }
    setSelectedRowKeys([]);
    fetchAssets();
  };


  const handleBatchDelete = async () => {
    const ids = selectedRowKeys.map(Number);
    if (ids.length === 0) return;
    await Promise.allSettled(ids.map((id) => deleteAsset(id)));
    message.success(`已删除 ${ids.length} 台资产`);
    setSelectedRowKeys([]);
    fetchAssets();
  };

  const handleExportCSV = () => {
    const header = ['名称', 'IP', '类型', '状态', '厂商', '系统', '架构', '虚拟化', '端口', '标签', '描述'];
    const rows = assets.map((a) => [
      a.name, a.ip, a.type, a.status || '', a.vendor || '', a.os_version || '', a.arch || '', a.virtualization || '',
      a.ports || '', a.tags || '', (a.description || '').replace(/\n/g, ' '),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `meridian-assets-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    message.success(`已导出 ${assets.length} 台资产`);
  };

  const handleImportCSV = async (file: File) => {
    message.loading({ content: '正在导入资产...', key: 'import', duration: 0 });
    try {
      const res = await importAssets(file);
      message.success({
        content: `导入完成：新增 ${res.created}，更新 ${res.updated}，失败 ${res.failed}`,
        key: 'import',
      });
      if (res.failed > 0 && res.errors?.length) {
        Modal.warning({
          title: `${res.failed} 行未导入`,
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
      message.error({ content: e?.message || '导入失败', key: 'import' });
    }
  };

  const typeLabelMap: Record<string, string> = {
    server: 'PC 服务器', switch: '以太网交换机', router: '核心路由器', other: '其他硬件',
  };
  const statusLabelMap: Record<string, string> = { online: '在线', offline: '离线', unknown: '未知' };

  // 按 groupBy 把资产分组 -> [组名, 资产[]][]
  const groupedAssets = (): [string, Asset[]][] => {
    const map = new Map<string, Asset[]>();
    assets.forEach((a) => {
      let keys: string[] = ['其他'];
      if (groupBy === 'type') keys = [typeLabelMap[a.type] || a.type];
      else if (groupBy === 'status') keys = [statusLabelMap[a.status || 'unknown'] || '未知'];
      else if (groupBy === 'tag') {
        let tags: string[] = [];
        try {
          const parsed = a.tags ? JSON.parse(a.tags) : [];
          tags = Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          tags = [];
        }
        keys = tags.length ? tags : ['未打标签'];
      }
      keys.forEach((k) => {
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(a);
      });
    });
    return Array.from(map.entries());
  };

  const renderPorts = (portsStr?: string) => {
    if (!portsStr) return <Text type="secondary">无开放端口</Text>;
    try {
      const ports: number[] = JSON.parse(portsStr);
      if (!Array.isArray(ports) || ports.length === 0) return <Text type="secondary">无开放端口</Text>;
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
    physical: { label: '实体机', color: 'green' },
    vmware: { label: 'VMware', color: 'blue' },
    kvm: { label: 'KVM', color: 'geekblue' },
    'hyper-v': { label: 'Hyper-V', color: 'purple' },
    virtualbox: { label: 'VirtualBox', color: 'orange' },
    xen: { label: 'Xen', color: 'cyan' },
    qemu: { label: 'QEMU', color: 'geekblue' },
    aws: { label: 'AWS', color: 'gold' },
    gcp: { label: 'GCP', color: 'gold' },
    aliyun: { label: '阿里云', color: 'gold' },
    openstack: { label: 'OpenStack', color: 'gold' },
    parallels: { label: 'Parallels', color: 'magenta' },
  };
  const CLOUD_VIRT = new Set(['aws', 'gcp', 'aliyun', 'openstack']);
  const renderVirtTag = (v?: string) => {
    if (!v) return null;
    const base: React.CSSProperties = { borderRadius: 4, margin: 0 };
    if (v === 'physical') return <Tag color="green" style={base}>🖥 实体机</Tag>;
    if (v.startsWith('container:'))
      return <Tag color="magenta" style={base}>📦 容器·{v.slice('container:'.length)}</Tag>;
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
        <Space size={[0, 4]} wrap>
          {tags.map((tag) => {
            const hexColor = getTagColor(tag);
            return (
              <Tag 
                key={tag} 
                color={hexColor} 
                style={{ borderRadius: '4px', fontWeight: 500 }}
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
      title: '资产名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Asset) => {
        // 仅展示「系统(厂商) · 架构」与标签：用简洁的 vendor 作为系统，
        // 原始 SSH/Telnet banner（os_version）过于冗长，仅在详情抽屉展示
        const info = [record.vendor, record.arch].filter(Boolean).join(' · ');
        return (
          <Space direction="vertical" size={2}>
            <a onClick={() => handleShowDetail(record)} style={{ fontWeight: 600, color: palette.text }}>
              {text}
            </a>
            <Space size="small" align="center" style={{ flexWrap: 'wrap' }}>
              {info && <Text type="secondary" style={{ fontSize: '11px' }}>{info}</Text>}
              {renderVirtTag(record.virtualization)}
              {renderTags(record.tags)}
            </Space>
          </Space>
        );
      },
    },
    {
      title: 'IP 地址',
      dataIndex: 'ip',
      key: 'ip',
      render: (text: string) => <span style={{ fontFamily: 'monospace', fontWeight: 500, color: '#334155' }}>{text}</span>,
    },
    {
      title: '设备类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => {
        const typeMap: Record<string, { label: string; color: string }> = {
          server: { label: 'PC 服务器', color: 'blue' },
          switch: { label: '以太网交换机', color: 'green' },
          router: { label: '核心路由器', color: 'orange' },
          other: { label: '其他硬件', color: 'default' },
        };
        const info = typeMap[type] || { label: type, color: 'default' };
        return <Tag color={info.color} style={{ borderRadius: '4px' }}>{info.label}</Tag>;
      },
    },
    {
      title: '当前状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        if (status === 'online') return <Badge status="success" text="在线" />;
        if (status === 'offline') return <Badge status="error" text="离线" />;
        return <Badge status="default" text="未知" />;
      },
    },
    {
      title: '开放端口',
      dataIndex: 'ports',
      key: 'ports',
      render: (text: string) => renderPorts(text),
    },
    {
      title: '操作',
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
            连接终端
          </Button>
          <Button
            type="link"
            size="small"
            icon={<FolderOpenOutlined />}
            onClick={() => { setSftpAsset(record); setSftpOpen(true); }}
            style={{ padding: 0, fontWeight: 500, color: '#f59e0b' }}
          >
            文件
          </Button>
          <Button
            type="link"
            size="small"
            icon={pingingIds[record.id!] ? <SyncOutlined spin /> : <CompassOutlined />}
            loading={pingingIds[record.id!]}
            onClick={() => handlePing(record.id!)}
            style={{ padding: 0, fontWeight: 500, color: '#0ea5e9' }}
          >
            在线探测
          </Button>
          <Button
            type="link"
            size="small"
            icon={collectingIds[record.id!] ? <SyncOutlined spin /> : <CloudDownloadOutlined />}
            loading={collectingIds[record.id!]}
            onClick={() => handleCollect(record.id!)}
            style={{ padding: 0, fontWeight: 500, color: '#8b5cf6' }}
          >
            采集
          </Button>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined style={{ color: '#475569' }} />}
            onClick={() => handleOpenEdit(record)}
            style={{ padding: 0 }}
          />
          <Popconfirm
            title="确定要删除该资产吗？"
            onConfirm={() => handleDelete(record.id!)}
            okText="是"
            cancelText="否"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" danger icon={<DeleteOutlined />} style={{ padding: 0 }} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ background: palette.bg, minHeight: '100vh' }}>
      <PageHeader
        title="资产清单 (CMDB)"
        subtitle="登记并维护物理主机与网络设备，支持端口探测与一键交互式 SSH 会话"
        icon={<DatabaseOutlined />}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenAdd}>
            手动录入资产
          </Button>
        }
      />

      <div style={{ padding: '24px 32px 32px 32px' }} className="mrd-fade-up">
        {/* 检索 / 过滤 / 分组 / 常用功能 */}
        <div style={{ ...cardStyle, padding: '16px 20px', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Space wrap size="middle">
              <Input
                placeholder="搜索 IP、设备名称..."
                prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                style={{ width: 220, borderRadius: 6 }}
                allowClear
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <Select placeholder="过滤设备类型" style={{ width: 150 }} allowClear onChange={(val) => setFilterType(val || '')}>
                <Option value="server">PC 服务器</Option>
                <Option value="switch">以太网交换机</Option>
                <Option value="router">核心路由器</Option>
                <Option value="other">其他硬件</Option>
              </Select>
              <Select placeholder="过滤在线状态" style={{ width: 150 }} allowClear onChange={(val) => setFilterStatus(val || '')}>
                <Option value="online">在线</Option>
                <Option value="offline">离线</Option>
                <Option value="unknown">未知</Option>
              </Select>
            </Space>
            <Space wrap size="small">
              <span style={{ fontSize: 12, color: palette.textSub }}>分组</span>
              <Segmented
                value={groupBy}
                onChange={(v) => setGroupBy(v as 'none' | 'type' | 'status' | 'tag')}
                options={[
                  { label: '不分组', value: 'none' },
                  { label: '类型', value: 'type' },
                  { label: '状态', value: 'status' },
                  { label: '标签', value: 'tag' },
                ]}
              />
              <Button icon={<TagOutlined />} onClick={() => setIsTagModalOpen(true)}>标签管理</Button>
              <Upload
                accept=".csv"
                showUploadList={false}
                beforeUpload={(file) => {
                  handleImportCSV(file as File);
                  return false; // 阻止 antd 自动上传，改由我们手动调用接口
                }}
              >
                <Button icon={<UploadOutlined />}>导入 CSV</Button>
              </Upload>
              <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>导出 CSV</Button>
            </Space>
          </div>

          {/* 批量操作条（选中后出现，未分组视图） */}
          {groupBy === 'none' && selectedRowKeys.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${palette.border}`, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: palette.text, fontWeight: 600 }}>已选 {selectedRowKeys.length} 项</span>
              <Button size="small" icon={<CompassOutlined />} onClick={handleBatchPing}>批量探测</Button>
              <Popconfirm
                title={`确认删除选中的 ${selectedRowKeys.length} 台资产？`}
                onConfirm={handleBatchDelete}
                okText="是" cancelText="否" okButtonProps={{ danger: true }}
              >
                <Button size="small" danger icon={<DeleteOutlined />}>批量删除</Button>
              </Popconfirm>
              <Button size="small" type="text" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
            </div>
          )}
        </div>

        {/* 表格主体 / 分组视图 */}
        {groupBy === 'none' ? (
          <div style={{ ...cardStyle, padding: 4 }}>
            <Table
              columns={columns}
              dataSource={assets}
              rowKey="id"
              loading={loading}
              rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys) }}
              pagination={{ pageSize: 8, showSizeChanger: false }}
              style={{ borderRadius: 8, overflow: 'hidden' }}
            />
          </div>
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

      {/* 手动录入/编辑资产弹窗 */}
      <Modal
        title={editingAsset ? '编辑资产信息' : '手动录入新资产'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        destroyOnHidden
        width={500}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ ssh_port: 22 }} style={{ marginTop: 16 }}>
          <Form.Item
            label="资产显示名称"
            name="name"
            rules={[{ required: true, message: '请输入资产显示名称' }]}
          >
            <Input placeholder="例如: 腾讯云测试机, 汇聚交换机" />
          </Form.Item>

          <Form.Item
            label="管理 IP 地址"
            name="ip"
            rules={[
              { required: true, message: '请输入有效的 IP 地址或范围' }
            ]}
          >
            <Input placeholder="例如: 192.168.1.100" disabled={!!editingAsset} />
          </Form.Item>

          <Form.Item
            label="资产类型"
            name="type"
            rules={[{ required: true, message: '请选择资产类型' }]}
          >
            <Select placeholder="选择资产硬件类别">
              <Option value="server">PC 服务器</Option>
              <Option value="switch">以太网交换机</Option>
              <Option value="router">核心路由器</Option>
              <Option value="other">其他硬件</Option>
            </Select>
          </Form.Item>

          <Form.Item
            label="资产标签"
            name="tags"
          >
            <Select
              mode="tags"
              style={{ width: '100%' }}
              placeholder="输入或选择标签，按回车键新增"
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

          <Form.Item
            label="关联扫描及登录凭证"
            name="credential_id"
          >
            <Select placeholder="选择自动登录凭证 (可留空，连接时手动输入)" allowClear>
              {credentials.map((c) => (
                <Option value={c.id} key={c.id}>
                  {c.name} ({c.username})
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            label="SSH 端口"
            name="ssh_port"
            tooltip="终端连接、SFTP 文件传输与认证采集使用的 SSH 端口，支持非标端口，默认 22"
          >
            <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="默认 22" />
          </Form.Item>

          <Form.Item
            label="开放端口"
            name="ports"
            tooltip="手动登记该资产对外开放的端口，逗号分隔；自动发现/在线探测也会回填此项"
          >
            <Input placeholder="如 22, 80, 443（逗号分隔，可留空）" />
          </Form.Item>

          {isAdmin && (
            <Form.Item
              label="归属用户"
              name="owner_id"
              tooltip="将该资产分配给指定用户；该用户将拥有此资产的查看与操作权限"
            >
              <Select placeholder="选择归属用户 (默认归创建者)" allowClear showSearch optionFilterProp="children">
                {users.map((u) => (
                  <Option value={u.id} key={u.id}>
                    {u.username}（{u.role === 'admin' ? '管理员' : '普通用户'}）
                  </Option>
                ))}
              </Select>
            </Form.Item>
          )}

          <Form.Item
            label="描述与备忘"
            name="description"
          >
            <Input.TextArea rows={3} placeholder="备注用途、位置、负责人等..." />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 24, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit">
                保存
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
            <span>设备资产详情</span>
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
                      <Tag color="green" style={{ borderRadius: '4px', margin: 0 }}>在线</Tag>
                    ) : drawerAsset.status === 'offline' ? (
                      <Tag color="red" style={{ borderRadius: '4px', margin: 0 }}>离线</Tag>
                    ) : (
                      <Tag color="default" style={{ borderRadius: '4px', margin: 0 }}>未知</Tag>
                    )}
                  </div>
                  <div>
                    <span style={{ fontSize: '13px', color: '#64748b', marginRight: '8px' }}>管理IP:</span>
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
              <Descriptions title="基本属性" column={1} bordered size="small" styles={{ label: { width: '120px', background: '#f8fafc', color: '#475569' }, content: { color: '#1e293b' } }}>
                <Descriptions.Item label="硬件类型">
                  {drawerAsset.type === 'server' && 'PC 服务器'}
                  {drawerAsset.type === 'switch' && '以太网交换机'}
                  {drawerAsset.type === 'router' && '核心路由器'}
                  {drawerAsset.type === 'other' && '其他硬件'}
                </Descriptions.Item>
                <Descriptions.Item label="厂商识别">
                  {drawerAsset.vendor || <Text type="secondary">暂无厂商数据 (待扫描)</Text>}
                </Descriptions.Item>
                <Descriptions.Item label="系统版本">
                  <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                    {drawerAsset.os_version || <Text type="secondary">暂无系统信息 (待扫描)</Text>}
                  </span>
                </Descriptions.Item>
                <Descriptions.Item label="CPU 架构">
                  {drawerAsset.arch ? (
                    <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{drawerAsset.arch}</span>
                  ) : (
                    <Text type="secondary">未采集</Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="虚拟化">
                  {drawerAsset.virtualization ? renderVirtTag(drawerAsset.virtualization) : <Text type="secondary">未采集（点「采集」探测）</Text>}
                </Descriptions.Item>
                <Descriptions.Item label="最后扫描时间">
                  {drawerAsset.last_scanned_at ? (
                    new Date(drawerAsset.last_scanned_at).toLocaleString('zh-CN')
                  ) : (
                    <Text type="secondary">从未扫描</Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="负责人">
                  {drawerAsset.owner_name
                    ? <Tag color="blue" style={{ borderRadius: 4 }}>{drawerAsset.owner_name}</Tag>
                    : <Text type="secondary">未归属</Text>}
                </Descriptions.Item>
                <Descriptions.Item label="SSH 端口">
                  <span style={{ fontFamily: 'monospace' }}>{drawerAsset.ssh_port || 22}</span>
                </Descriptions.Item>
              </Descriptions>

              {/* 开放端口 */}
              <div>
                <Title level={5} style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#475569' }}>探测到开放端口</Title>
                <div style={{ background: '#f8fafc', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  {renderPorts(drawerAsset.ports)}
                </div>
              </div>

              {/* 关联凭证和备注 */}
              <Descriptions title="访问凭据与备注" column={1} bordered size="small" styles={{ label: { width: '120px', background: '#f8fafc', color: '#475569' }, content: { color: '#1e293b' } }}>
                <Descriptions.Item label="关联登录凭证">
                  {drawerAsset.credential_id
                    ? credentials.find((c) => c.id === drawerAsset.credential_id)?.name || `凭证 ID: ${drawerAsset.credential_id}`
                    : <Text type="secondary">无绑定 (发起连接时手动输入密码)</Text>}
                </Descriptions.Item>
                <Descriptions.Item label="资产备注说明">
                  <Paragraph style={{ margin: 0, fontStyle: drawerAsset.description ? 'normal' : 'italic', color: drawerAsset.description ? '#1e293b' : '#94a3b8' }}>
                    {drawerAsset.description || '无备注说明信息'}
                  </Paragraph>
                </Descriptions.Item>
              </Descriptions>

              {/* 可用性（近 24h） */}
              <div>
                <Title level={5} style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#475569' }}>可用性（近 24 小时）</Title>
                <div style={{ background: '#f8fafc', padding: '16px', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  {!uptime || uptime.total === 0 ? (
                    <Text type="secondary">暂无监控数据（请在「系统设置 → 可用性监控」开启定时探测）</Text>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{
                          fontSize: 26, fontWeight: 700,
                          color: uptime.uptime_percent >= 99 ? '#16a34a' : uptime.uptime_percent >= 90 ? '#d97706' : '#dc2626',
                        }}>
                          {uptime.uptime_percent.toFixed(1)}%
                        </div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>在线率</div>
                      </div>
                      <div style={{ fontSize: 13, color: '#475569' }}>
                        共探测 <b>{uptime.total}</b> 次，在线 <b style={{ color: '#16a34a' }}>{uptime.online}</b> 次，
                        离线 <b style={{ color: '#dc2626' }}>{uptime.total - uptime.online}</b> 次
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 变更历史 */}
              <div>
                <Title level={5} style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#475569' }}>变更历史</Title>
                <div style={{ background: '#f8fafc', padding: '16px', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  {historyLoading ? (
                    <div style={{ textAlign: 'center', padding: '12px' }}><Spin /></div>
                  ) : history.length === 0 ? (
                    <Text type="secondary">暂无变更记录</Text>
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
                  在线探测(Ping)
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
                发起 SSH / Telnet 终端会话
              </Button>
            </div>

          </div>
        )}
      </Drawer>

      <Modal
        title={
          <Space>
            <TagOutlined style={{ color: palette.primary }} />
            <span style={{ fontWeight: 600 }}>全局标签管理</span>
          </Space>
        }
        open={isTagModalOpen}
        onCancel={() => setIsTagModalOpen(false)}
        footer={null}
        width={600}
        destroyOnClose
      >
        <div style={{ marginBottom: 20, padding: '16px 20px', backgroundColor: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
          <Title level={5} style={{ marginTop: 0, marginBottom: 12, fontSize: 14, color: '#1e293b' }}>新建标签</Title>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Space style={{ width: '100%' }}>
              <Input 
                placeholder="标签名称，如：生产环境" 
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                style={{ width: 220, borderRadius: 6 }}
              />
              <Button type="primary" onClick={handleCreateTag} style={{ borderRadius: 6 }}>创建标签</Button>
            </Space>
            <Space align="center" size="small" wrap>
              <span style={{ fontSize: 13, color: '#64748b' }}>选择颜色：</span>
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
