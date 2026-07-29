import React, { useEffect, useState } from 'react';
import {
  Button, Card, Modal, Form, Input, InputNumber, Select, message, Table, Tag, Space,
  Popconfirm, Drawer, Empty, Tooltip, Tabs, Statistic, Alert, Dropdown, Checkbox,
} from 'antd';
import {
  CloudServerOutlined, PlusOutlined, ReloadOutlined, LinkOutlined, EditOutlined,
  DeleteOutlined, CodeOutlined, ClusterOutlined, ApiOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import {
  getK8sClusters, createK8sCluster, updateK8sCluster, deleteK8sCluster, getK8sCluster,
  getUnassignedK8sNodes, assignK8sNodes, unassignK8sNode, getK8sConsole, getCredentials,
  getK8sOverview, getK8sLiveNodes, getK8sLivePods, autoClassifyK8s, detectK8sConsole, syncK8sNodes,
  bootstrapK8sTokenBySSH,
  type K8sCluster, type Asset, type Credential, type K8sLiveNode, type K8sLivePod, type K8sOverview,
  type K8sSSHBootstrapReq,
} from '../services/api';
import { PageHeader } from '../components/PageHeader';
import { TableToolbar, tablePanelStyle } from '../components/TableToolbar';
import { palette, cardStyle, pagePadding } from '../theme';
import { useTerminals } from '../terminalSessions';
import { useI18n } from '../i18n';

type TextFn = (key: string, values?: Record<string, string | number>) => string;

const roleTag = (role?: string) => {
  if (role === 'control-plane') return <Tag color="blue">control-plane</Tag>;
  if (role === 'worker') return <Tag>worker</Tag>;
  return <Tag>-</Tag>;
};

// 控制台类型→标签。专有名（Rancher 等）不翻译，只有描述性的走词条。
const CONSOLE_KIND_KEYS: Record<string, string> = {
  uc: 'k8s.console.uc',
  web: 'k8s.console.web',
};
const CONSOLE_KIND_FIXED: Record<string, string> = {
  'kubernetes-dashboard': 'K8s Dashboard',
  rancher: 'Rancher',
  kubesphere: 'KubeSphere',
};
const consoleKindLabel = (k: string | undefined, text: TextFn) => {
  if (!k) return text('k8s.console.unknown');
  if (CONSOLE_KIND_KEYS[k]) return text(CONSOLE_KIND_KEYS[k]);
  return CONSOLE_KIND_FIXED[k] || k;
};

const makeStatusDot = (text: TextFn) => (status?: string) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
    <span style={{ width: 7, height: 7, borderRadius: '50%', background: status === 'online' ? '#10b981' : '#ef4444' }} />
    {status === 'online' ? text('k8s.online') : text('k8s.offline')}
  </span>
);

export const K8sClusters: React.FC = () => {
  const { text } = useI18n();
  const statusDot = makeStatusDot(text);
  const [clusters, setClusters] = useState<K8sCluster[]>([]);
  const [unassigned, setUnassigned] = useState<Asset[]>([]);
  const [creds, setCreds] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<K8sCluster | null>(null);
  const [form] = Form.useForm();

  const [drawerCluster, setDrawerCluster] = useState<K8sCluster | null>(null);
  const [drawerNodes, setDrawerNodes] = useState<Asset[]>([]);
  // Phase 3 实时看板
  const [overview, setOverview] = useState<K8sOverview | null>(null);
  const [liveNodes, setLiveNodes] = useState<K8sLiveNode[]>([]);
  const [livePods, setLivePods] = useState<K8sLivePod[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveErr, setLiveErr] = useState('');

  const [selectedNodeIds, setSelectedNodeIds] = useState<React.Key[]>([]);
  const [assignClusterId, setAssignClusterId] = useState<number | undefined>();

  const { open: openTerminal } = useTerminals();

  const load = async () => {
    setLoading(true);
    try {
      const [cl, un] = await Promise.all([getK8sClusters(), getUnassignedK8sNodes()]);
      setClusters(cl);
      setUnassigned(un);
    } catch (e: any) {
      message.error(e?.message || text('k8s.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    getCredentials().then(setCreds).catch(() => {});
  }, []);

  // 一键打开控制台：
  // - console_path 含 {username}/{password} 占位符 → 用绑定凭据替换，真·一键免登
  // - 否则复制绑定密码 + 新标签打开（浏览器不能跨域自动填表单）
  const openConsole = async (id: number) => {
    try {
      const { url, username, password } = await getK8sConsole(id);
      const hasTpl = url.includes('{username}') || url.includes('{password}');
      const finalUrl = url
        .replace(/\{username\}/g, encodeURIComponent(username || ''))
        .replace(/\{password\}/g, encodeURIComponent(password || ''));
      if (!hasTpl && password) await navigator.clipboard?.writeText(password).catch(() => {});
      window.open(finalUrl, '_blank', 'noopener');
      message.success(
        hasTpl
          ? text('k8s.consoleOpenedAuto')
          : password
          ? text('k8s.consoleOpenedCopy', { user: username || '-' })
          : text('k8s.consoleOpenedNoCred'),
      );
    } catch (e: any) {
      message.error(e?.message || text('k8s.consoleOpenFailed'));
    }
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ console_port: 443, console_path: '/' });
    setModalOpen(true);
  };
  const openEdit = (cl: K8sCluster) => {
    setEditing(cl);
    form.setFieldsValue(cl);
    setModalOpen(true);
  };
  const submit = async (values: K8sCluster) => {
    try {
      if (editing?.id) await updateK8sCluster(editing.id, values);
      else await createK8sCluster(values);
      message.success(text('k8s.saved'));
      setModalOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.message || text('set.saveFailed'));
    }
  };
  const remove = async (id: number) => {
    try {
      await deleteK8sCluster(id);
      message.success(text('k8s.clusterDeleted'));
      load();
    } catch (e: any) {
      message.error(e?.message || text('users.deleteFailed'));
    }
  };

  const openNodes = async (cl: K8sCluster) => {
    setOverview(null); setLiveNodes([]); setLivePods([]); setLiveErr('');
    try {
      const { cluster, nodes } = await getK8sCluster(cl.id!);
      setDrawerCluster(cluster);
      setDrawerNodes(nodes);
      if (cluster.has_token) loadLive(cluster.id!);
    } catch (e: any) {
      message.error(e?.message || text('k8s.loadNodesFailed'));
    }
  };

  // 拉取实时看板（kube API）
  const loadLive = async (id: number) => {
    setLiveLoading(true);
    setLiveErr('');
    try {
      const [ov, ns, pods] = await Promise.all([
        getK8sOverview(id),
        getK8sLiveNodes(id).catch(() => [] as K8sLiveNode[]),
        getK8sLivePods(id).catch(() => [] as K8sLivePod[]),
      ]);
      setOverview(ov);
      setLiveNodes(ns);
      setLivePods(pods);
    } catch (e: any) {
      setLiveErr(e?.message || text('k8s.liveFailed'));
    } finally {
      setLiveLoading(false);
    }
  };
  const unassign = async (assetId: number) => {
    if (!drawerCluster) return;
    await unassignK8sNode(drawerCluster.id!, assetId);
    message.success(text('k8s.removedFromCluster'));
    openNodes(drawerCluster);
    load();
  };

  const doAssign = async () => {
    if (!assignClusterId || selectedNodeIds.length === 0) {
      message.warning(text('k8s.pickNodesAndCluster'));
      return;
    }
    try {
      await assignK8sNodes(assignClusterId, selectedNodeIds as number[]);
      message.success(text('k8s.assignedN', { n: selectedNodeIds.length }));
      setSelectedNodeIds([]);
      load();
    } catch (e: any) {
      message.error(e?.message || text('k8s.assignFailed'));
    }
  };

  const [autoLoading, setAutoLoading] = useState(false);
  // 自动归类：读 K8s 节点 /etc/hosts 的 cluster-vip 标记 → 按 VIP 建/并集群
  const runAutoClassify = async () => {
    setAutoLoading(true);
    try {
      const r = await autoClassifyK8s();
      const failed = r.details.filter((d) => !d.ok);
      Modal.info({
        title: text('k8s.autoClassifyResult'),
        width: 560,
        content: (
          <div style={{ marginTop: 8 }}>
            <p>{text('k8s.autoClassifySummary', { processed: r.processed, assigned: r.assigned, created: r.clusters_created })}</p>
            {failed.length > 0 && (
              <div style={{ marginTop: 8, maxHeight: 240, overflowY: 'auto' }}>
                <div style={{ color: '#f59e0b', marginBottom: 4 }}>{text('k8s.autoClassifyFailed', { n: failed.length })}</div>
                {failed.map((d) => (
                  <div key={d.ip} style={{ fontSize: 12, fontFamily: 'monospace', color: '#64748b' }}>{d.ip} — {d.msg}</div>
                ))}
              </div>
            )}
          </div>
        ),
      });
      load();
    } catch (e: any) {
      message.error(e?.message || text('k8s.autoClassifyError'));
    } finally {
      setAutoLoading(false);
    }
  };

  // 探测控制台：找出 VIP 上真实的控制台入口路径，并识别类型与版本，结果写回集群
  const [detectingId, setDetectingId] = useState<number | null>(null);
  const runDetectConsole = async (cl: K8sCluster) => {
    setDetectingId(cl.id!);
    try {
      const { best, candidates } = await detectK8sConsole(cl.id!);
      Modal.info({
        title: text('k8s.detectResult', { name: cl.name }),
        width: 560,
        content: (
          <div style={{ marginTop: 8 }}>
            <p style={{ marginBottom: 8 }}>
              {text('k8s.detectEntry')}<b style={{ fontFamily: 'monospace' }}>{best.path}</b>
              　{text('k8s.detectKind')} <Tag color="blue">{consoleKindLabel(best.kind, text)}</Tag>
              {best.version && <>{text('k8s.detectVersion')} <Tag>{best.version}</Tag></>}
            </p>
            {best.title && <p style={{ color: '#64748b', fontSize: 12 }}>{text('k8s.detectPageTitle')}{best.title}</p>}
            <div style={{ marginTop: 10, maxHeight: 220, overflowY: 'auto' }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{text('k8s.detectCandidates')}</div>
              {candidates.map((p) => (
                <div key={p.path} style={{ fontSize: 12, fontFamily: 'monospace', color: '#64748b' }}>
                  {p.path} — HTTP {p.status} · {consoleKindLabel(p.kind, text)} · {text('k8s.detectScore')} {p.score}
                </div>
              ))}
            </div>
          </div>
        ),
      });
      load();
      if (drawerCluster?.id === cl.id) openNodes(cl);
    } catch (e: any) {
      message.error(e?.message || text('k8s.detectFailed'));
    } finally {
      setDetectingId(null);
    }
  };

  // 按 kube API 节点表同步归类：不依赖 SSH，也不依赖节点上的 /etc/hosts 标记，
  // 集群配了 Token 就能一次把整个集群的节点归位。
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const runSyncNodes = async (cl: K8sCluster, createMissing: boolean) => {
    setSyncingId(cl.id!);
    try {
      const r = await syncK8sNodes(cl.id!, createMissing);
      const skipped = r.details.filter((d) => d.action === 'skipped');
      Modal.info({
        title: text('k8s.syncResult', { name: cl.name }),
        width: 620,
        content: (
          <div style={{ marginTop: 8 }}>
            <p>
              {text('k8s.syncSummary', { total: r.total, assigned: r.assigned, updated: r.updated })}
              {createMissing && <>{text('k8s.syncCreated', { created: r.created })}</>}
            </p>
            {skipped.length > 0 && (
              <div style={{ marginTop: 8, maxHeight: 260, overflowY: 'auto' }}>
                <div style={{ color: palette.warning, marginBottom: 4 }}>{text('k8s.syncSkipped', { n: skipped.length })}</div>
                {skipped.map((d) => (
                  <div key={d.ip || d.name} style={{ fontSize: 12, fontFamily: 'monospace', color: palette.textMute }}>
                    {d.name} {d.ip} — {d.msg}
                  </div>
                ))}
              </div>
            )}
          </div>
        ),
      });
      load();
    } catch (e: any) {
      message.error(e?.message || text('k8s.syncFailed'));
    } finally {
      setSyncingId(null);
    }
  };

  // 用 SSH 凭据自动配置：后端 SSH 登到 master，自动建只读 SA 取 Token 并落库，顺带同步节点。
  // 用户不需要再去哪台机器上手敲 kubectl create token 再把 JWT 粘回来。
  const [bootCluster, setBootCluster] = useState<K8sCluster | null>(null);
  const [bootLoading, setBootLoading] = useState(false);
  const [bootForm] = Form.useForm<K8sSSHBootstrapReq>();

  const openBootstrap = (cl: K8sCluster) => {
    bootForm.setFieldsValue({
      host: cl.vip,
      ssh_port: 22,
      credential_id: cl.credential_id ?? null, // 显式置空，避免沿用上一个集群残留的选择
      namespace: 'kube-system',
      service_account: 'assetmanager',
      create_missing: true,
    });
    setBootCluster(cl);
  };

  const runBootstrap = async (values: K8sSSHBootstrapReq) => {
    if (!bootCluster) return;
    setBootLoading(true);
    try {
      const r = await bootstrapK8sTokenBySSH(bootCluster.id!, values);
      setBootCluster(null);
      Modal.success({
        title: text('k8s.bootDone', { name: bootCluster.name }),
        width: 640,
        content: (
          <div style={{ marginTop: 8 }}>
            <p style={{ marginBottom: 6 }}>
              ServiceAccount <b style={{ fontFamily: 'monospace' }}>{r.service_account}</b>
              　{text('k8s.bootMethod')} <Tag>{r.method}</Tag>
            </p>
            <p style={{ marginBottom: 6, fontSize: 12, color: palette.textSub }}>
              {text('k8s.bootKubectl')}<span style={{ fontFamily: 'monospace' }}>{r.kubectl || '-'}</span>
              　·　API Server <span style={{ fontFamily: 'monospace' }}>{r.api_server}</span>
            </p>
            {r.sync && (
              <p style={{ marginBottom: 6 }}>
                {text('k8s.bootSync', { total: r.sync.total, assigned: r.sync.assigned, updated: r.sync.updated, created: r.sync.created })}
              </p>
            )}
            {r.sync_error && (
              <Alert type="warning" showIcon style={{ marginBottom: 8 }}
                message={text('k8s.bootSyncErrTitle')}
                description={<>{r.sync_error}<br />{text('k8s.bootSyncErrDesc')}</>} />
            )}
            {r.log.length > 0 && (
              <div style={{ marginTop: 8, maxHeight: 200, overflowY: 'auto' }}>
                {r.log.map((l, i) => (
                  <div key={i} style={{ fontSize: 12, fontFamily: 'monospace', color: palette.textMute }}>{l}</div>
                ))}
              </div>
            )}
          </div>
        ),
      });
      load();
      if (drawerCluster?.id === bootCluster.id) openNodes(bootCluster);
    } catch (e: any) {
      // 后端把「试过哪些 kubectl、卡在哪一步」都写进了错误信息，别截断
      Modal.error({ title: text('k8s.bootFailed'), width: 640, content: <div style={{ marginTop: 8 }}>{e?.message || text('k8s.unknownError')}</div> });
    } finally {
      setBootLoading(false);
    }
  };

  const toTerminal = (a: Asset) => a.id && openTerminal({ assetId: a.id, name: a.name, ip: a.ip });

  const phaseColor = (p: string) =>
    p === 'Running' ? 'green' : p === 'Pending' ? 'gold' : p === 'Succeeded' ? 'blue' : p === 'Failed' ? 'red' : 'default';

  const liveNodeCols = [
    { title: text('k8s.col.name'), dataIndex: 'name', key: 'name', render: (v: string) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
    { title: text('k8s.col.ready'), dataIndex: 'ready', key: 'ready', width: 90, render: (v: string) => <Tag color={v === 'Ready' ? 'green' : 'red'}>{v}</Tag> },
    { title: text('k8s.col.role'), dataIndex: 'role', key: 'role', width: 130, render: roleTag },
    { title: text('k8s.col.internalIp'), dataIndex: 'ip', key: 'ip', render: (v: string) => <span style={{ fontFamily: 'monospace' }}>{v || '-'}</span> },
    { title: text('k8s.col.version'), dataIndex: 'version', key: 'ver', width: 110 },
  ];

  const livePodCols = [
    { title: text('k8s.col.namespace'), dataIndex: 'namespace', key: 'ns', width: 130 },
    { title: 'Pod', dataIndex: 'name', key: 'name', render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span> },
    { title: text('k8s.col.status'), dataIndex: 'phase', key: 'phase', width: 100, render: (v: string) => <Tag color={phaseColor(v)}>{v}</Tag> },
    { title: text('k8s.col.node'), dataIndex: 'node', key: 'node', width: 150, render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v || '-'}</span> },
    { title: text('k8s.col.restarts'), dataIndex: 'restarts', key: 're', width: 70 },
  ];

  const unassignedCols = [
    { title: 'IP', dataIndex: 'ip', key: 'ip', render: (ip: string) => <span style={{ fontFamily: 'monospace' }}>{ip}</span> },
    { title: text('k8s.col.role'), dataIndex: 'k8s_role', key: 'role', width: 130, render: roleTag },
    { title: text('k8s.col.k8sVersion'), dataIndex: 'os_version', key: 'ver', render: (v: string) => v || '-' },
    { title: text('k8s.col.status'), dataIndex: 'status', key: 'status', width: 90, render: statusDot },
    {
      title: text('users.col.action'), key: 'act', width: 90,
      render: (_: unknown, a: Asset) => (
        <Button type="link" size="small" icon={<CodeOutlined />} onClick={() => toTerminal(a)}>{text('k8s.terminal')}</Button>
      ),
    },
  ];

  const nodeCols = [
    { title: 'IP', dataIndex: 'ip', key: 'ip', render: (ip: string) => <span style={{ fontFamily: 'monospace' }}>{ip}</span> },
    { title: text('k8s.col.role'), dataIndex: 'k8s_role', key: 'role', width: 130, render: roleTag },
    { title: text('k8s.col.k8sVersion'), dataIndex: 'os_version', key: 'ver', render: (v: string) => v || '-' },
    { title: text('k8s.col.status'), dataIndex: 'status', key: 'status', width: 90, render: statusDot },
    {
      title: text('users.col.action'), key: 'act', width: 150,
      render: (_: unknown, a: Asset) => (
        <Space size={2}>
          <Button type="link" size="small" icon={<CodeOutlined />} onClick={() => toTerminal(a)}>{text('k8s.terminal')}</Button>
          <Popconfirm title={text('k8s.unassignConfirm')} onConfirm={() => unassign(a.id!)} okText={text('k8s.unassign')} cancelText={text('common.cancel')}>
            <Button type="link" size="small" danger>{text('k8s.unassign')}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ background: palette.bg, minHeight: '100%' }}>
      <PageHeader
        title={text('nav.k8s')}
        subtitle={text('k8s.subtitle')}
        icon={<CloudServerOutlined />}
        extra={
          <Space>
            <Tooltip title={text('k8s.autoClassifyTip')}>
              <Button icon={<ApiOutlined />} loading={autoLoading} onClick={runAutoClassify}>{text('k8s.autoClassify')}</Button>
            </Tooltip>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>{text('common.refresh')}</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{text('k8s.newCluster')}</Button>
          </Space>
        }
      />

      <div style={{ padding: pagePadding }} className="wjw-page-in">
        {/* 集群卡片 */}
        {clusters.length === 0 ? (
          <div style={{ ...cardStyle, padding: 40, textAlign: 'center', marginBottom: 16 }}>
            <Empty description={text('k8s.emptyClusters')} />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12, marginBottom: 16 }}>
            {clusters.map((cl) => (
              <Card key={cl.id} style={cardStyle} styles={{ body: { padding: 16 } }} className="wjw-hover-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <ClusterOutlined style={{ color: '#326ce5', fontSize: 18 }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: palette.text }}>{cl.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: palette.textSub }}>{statusDot(cl.online ? 'online' : 'offline')}</span>
                </div>
                <div style={{ fontSize: 13, color: palette.textSub, marginBottom: 4 }}>
                  <ApiOutlined /> VIP <span style={{ fontFamily: 'monospace' }}>{cl.vip}:{cl.console_port}</span>
                </div>
                <div style={{ fontSize: 13, color: palette.textSub, marginBottom: 4 }}>
                  {text('k8s.nodeCounts', { total: cl.node_count || 0, master: cl.master_count || 0, worker: (cl.node_count || 0) - (cl.master_count || 0) })}
                </div>
                {/* 控制台指纹：真实入口路径 + 类型 + 版本（由「探测控制台」写入） */}
                <div style={{ fontSize: 12, color: palette.textSub, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span>{text('k8s.console')}</span>
                  <span style={{ fontFamily: 'monospace' }}>{cl.console_path || '/'}</span>
                  {cl.console_kind ? (
                    <Tag color="blue" style={{ margin: 0 }}>{consoleKindLabel(cl.console_kind, text)}</Tag>
                  ) : (
                    <Tag style={{ margin: 0 }}>{text('k8s.notDetected')}</Tag>
                  )}
                  {cl.console_version && <Tag style={{ margin: 0 }}>{cl.console_version}</Tag>}
                </div>
                <div style={{ fontSize: 12, color: palette.textMute, marginBottom: 12 }}>
                  {text('k8s.credential')}{cl.cred_name || <span style={{ color: palette.warning }}>{text('k8s.unbound')}</span>}
                </div>
                <Space wrap>
                  <Tooltip title={text('k8s.openConsoleTip', { url: `https://${cl.vip}:${cl.console_port}${cl.console_path || '/'}` })}>
                    <Button type="primary" size="small" icon={<LinkOutlined />} onClick={() => openConsole(cl.id!)}>{text('k8s.openConsole')}</Button>
                  </Tooltip>
                  <Tooltip title={text('k8s.detectConsoleTip')}>
                    <Button size="small" icon={<ApiOutlined />} loading={detectingId === cl.id} onClick={() => runDetectConsole(cl)}>{text('k8s.detectConsole')}</Button>
                  </Tooltip>
                  <Tooltip title={text('k8s.bootTip')}>
                    <Button size="small" type={cl.has_token ? 'default' : 'primary'} ghost={!cl.has_token}
                      icon={<ThunderboltOutlined />} onClick={() => openBootstrap(cl)}>
                      {cl.has_token ? text('k8s.retoken') : text('k8s.bootstrap')}
                    </Button>
                  </Tooltip>
                  {cl.has_token && (
                    <Tooltip title={text('k8s.syncTip')}>
                      <Dropdown
                        menu={{
                          items: [
                            { key: 'match', label: text('k8s.syncMatchOnly') },
                            { key: 'create', label: text('k8s.syncCreateMissing') },
                          ],
                          onClick: ({ key }) => runSyncNodes(cl, key === 'create'),
                        }}
                      >
                        <Button size="small" icon={<CloudServerOutlined />} loading={syncingId === cl.id}>
                          {text('k8s.syncNodes')}
                        </Button>
                      </Dropdown>
                    </Tooltip>
                  )}
                  <Button size="small" onClick={() => openNodes(cl)}>{cl.has_token ? text('k8s.nodesAndBoard') : text('k8s.nodes')}</Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(cl)} />
                  <Popconfirm title={text('k8s.deleteClusterConfirm', { name: cl.name })} onConfirm={() => remove(cl.id!)} okText={text('k8s.delete')} cancelText={text('common.cancel')} okButtonProps={{ danger: true }}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              </Card>
            ))}
          </div>
        )}

        {/* 未归类 K8s 节点 */}
        <div style={tablePanelStyle}>
          <div style={{ padding: '12px 16px 0', fontSize: 14, fontWeight: 500, color: palette.text }}>
            {text('k8s.unassignedNodes', { n: unassigned.length })}
          </div>
          <TableToolbar
            onRefresh={load}
            loading={loading}
            selectedCount={selectedNodeIds.length}
            onClearSelection={() => setSelectedNodeIds([])}
            left={
              <>
                <Select
                  placeholder={text('k8s.assignToCluster')}
                  style={{ width: 220 }}
                  value={assignClusterId}
                  onChange={setAssignClusterId}
                  options={clusters.map((c) => ({ label: `${c.name} (${c.vip})`, value: c.id }))}
                  disabled={clusters.length === 0}
                />
                <Button type="primary" onClick={doAssign} disabled={selectedNodeIds.length === 0}>
                  {text('k8s.assignBtn')}
                </Button>
              </>
            }
          />
          <Table
            className="wjw-table"
            columns={unassignedCols}
            dataSource={unassigned}
            rowKey="id"
            size="small"
            loading={loading}
            rowSelection={{ selectedRowKeys: selectedNodeIds, onChange: setSelectedNodeIds }}
            pagination={{ pageSize: 10, showSizeChanger: false, style: { padding: '0 16px' } }}
            locale={{ emptyText: text('k8s.noUnassigned') }}
          />
        </div>
      </div>

      {/* 新建/编辑集群 */}
      <Modal
        open={modalOpen}
        title={editing ? text('k8s.editCluster') : text('k8s.newCluster')}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        okText={text('k8s.save')}
        cancelText={text('common.cancel')}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={submit} initialValues={{ console_port: 443, console_path: '/' }}>
          <Form.Item label={text('k8s.form.name')} name="name" rules={[{ required: true, message: text('k8s.form.nameRequired') }]}>
            <Input placeholder={text('k8s.form.namePlaceholder')} />
          </Form.Item>
          <Form.Item label={text('k8s.form.vip')} name="vip" rules={[{ required: true, message: text('k8s.form.vipRequired') }]}>
            <Input placeholder={text('k8s.form.vipPlaceholder')} />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item label={text('k8s.form.consolePort')} name="console_port" style={{ width: 140 }}>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label={text('k8s.form.consolePath')} name="console_path" style={{ flex: 1, minWidth: 260 }}
              tooltip={text('k8s.form.consolePathTip')}>
              <Input placeholder={text('k8s.form.consolePathPlaceholder')} />
            </Form.Item>
          </Space>
          <Form.Item label={text('k8s.form.bindCred')} name="credential_id" tooltip={text('k8s.form.bindCredTip')}>
            <Select allowClear placeholder={text('k8s.form.bindCredPlaceholder')}
              options={creds.map((c) => ({ label: `${c.name} (${c.username})`, value: c.id }))} />
          </Form.Item>
          <Form.Item label={text('k8s.form.apiServer')} name="api_server" tooltip={text('k8s.form.apiServerTip')}>
            <Input placeholder={text('k8s.form.apiServerPlaceholder')} />
          </Form.Item>
          <Form.Item label={text('k8s.form.apiToken')} name="api_token"
            tooltip={text('k8s.form.apiTokenTip')}>
            <Input.Password placeholder={editing?.has_token ? text('k8s.form.apiTokenSet') : 'kube-apiserver ServiceAccount Token'} autoComplete="new-password" />
          </Form.Item>
          <Form.Item label={text('k8s.form.description')} name="description">
            <Input.TextArea rows={2} placeholder={text('k8s.form.descriptionPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 用 SSH 凭据自动配置 Token */}
      <Modal
        open={!!bootCluster}
        title={text('k8s.bootTitle', { name: bootCluster?.name || '' })}
        onCancel={() => setBootCluster(null)}
        onOk={() => bootForm.submit()}
        okText={text('k8s.bootStart')}
        cancelText={text('common.cancel')}
        confirmLoading={bootLoading}
        destroyOnHidden
      >
        <Alert style={{ marginBottom: 12 }} type="info" showIcon
          message={text('k8s.bootAlertTitle')}
          description={text('k8s.bootAlertDesc')} />
        <Form form={bootForm} layout="vertical" onFinish={runBootstrap}>
          <Space style={{ width: '100%' }} size="middle" align="start">
            <Form.Item label={text('k8s.boot.host')} name="host" style={{ flex: 1, minWidth: 300 }}
              rules={[{ required: true, message: text('k8s.boot.hostRequired') }]}
              tooltip={text('k8s.boot.hostTip')}>
              <Input placeholder={text('k8s.boot.hostPlaceholder')} />
            </Form.Item>
            <Form.Item label={text('k8s.boot.sshPort')} name="ssh_port" style={{ width: 120 }}>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item label={text('k8s.boot.cred')} name="credential_id"
            rules={[{ required: true, message: text('k8s.boot.credRequired') }]}
            tooltip={text('k8s.boot.credTip')}>
            <Select placeholder={text('k8s.boot.credPlaceholder')}
              options={creds.filter((c) => c.type !== 'telnet').map((c) => ({ label: `${c.name} (${c.username})`, value: c.id }))} />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle" align="start">
            <Form.Item label={text('k8s.col.namespace')} name="namespace" style={{ width: 200 }}>
              <Input placeholder="kube-system" />
            </Form.Item>
            <Form.Item label={text('k8s.boot.saName')} name="service_account" style={{ flex: 1, minWidth: 220 }}
              tooltip={text('k8s.boot.saNameTip')}>
              <Input placeholder="assetmanager" />
            </Form.Item>
          </Space>
          <Form.Item name="create_missing" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Checkbox>{text('k8s.boot.createMissing')}</Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      {/* 集群节点 + 实时看板抽屉 */}
      <Drawer
        open={!!drawerCluster}
        onClose={() => setDrawerCluster(null)}
        width={760}
        title={drawerCluster ? `${drawerCluster.name}` : ''}
        extra={drawerCluster && (
          <Space>
            {drawerCluster.has_token && (
              <Button icon={<ReloadOutlined />} loading={liveLoading} onClick={() => loadLive(drawerCluster.id!)}>{text('k8s.refreshBoard')}</Button>
            )}
            <Button type="primary" icon={<LinkOutlined />} onClick={() => openConsole(drawerCluster.id!)}>{text('k8s.openConsole')}</Button>
          </Space>
        )}
      >
        {drawerCluster && (
          <div style={{ marginBottom: 12, fontSize: 13, color: palette.textSub, lineHeight: 1.9 }}>
            VIP <span style={{ fontFamily: 'monospace' }}>{drawerCluster.vip}:{drawerCluster.console_port}</span>
            　·　API <span style={{ fontFamily: 'monospace' }}>{drawerCluster.api_server || `${drawerCluster.vip}:6443`}</span>
            　·　{text('k8s.credential')}{drawerCluster.cred_name || text('k8s.unbound')}
            <br />
            {text('k8s.console')} <span style={{ fontFamily: 'monospace' }}>{drawerCluster.console_path || '/'}</span>
            　·　{text('k8s.detectKind')} {consoleKindLabel(drawerCluster.console_kind, text)}
            {drawerCluster.console_version && <>　·　{text('k8s.detectVersion')} {drawerCluster.console_version}</>}
            {drawerCluster.console_title && <>　·　{text('k8s.consoleTitle')} {drawerCluster.console_title}</>}
          </div>
        )}

        {/* 概览统计 */}
        {overview?.has_token && (
          <div style={{ display: 'flex', gap: 24, padding: '10px 4px 14px', borderBottom: '1px solid var(--wjw-border)' }}>
            <Statistic title={text('k8s.stat.nodes')} value={`${overview.nodes_ready ?? 0}/${overview.nodes_total ?? 0}`} valueStyle={{ fontSize: 20 }} />
            <Statistic title={text('k8s.stat.pods')} value={`${overview.pods_running ?? 0}/${overview.pods_total ?? 0}`} valueStyle={{ fontSize: 20 }} />
            <Statistic title={text('k8s.col.version')} value={overview.version || '-'} valueStyle={{ fontSize: 16 }} />
          </div>
        )}

        {drawerCluster && !drawerCluster.has_token && (
          <Alert style={{ marginBottom: 12 }} type="info" showIcon
            message={text('k8s.noTokenTitle')}
            description={text('k8s.noTokenDesc')}
            action={
              <Button size="small" type="primary" icon={<ThunderboltOutlined />} onClick={() => openBootstrap(drawerCluster)}>
                {text('k8s.bootstrap')}
              </Button>
            } />
        )}
        {liveErr && <Alert style={{ marginBottom: 12 }} type="error" showIcon message={liveErr} />}

        <Tabs
          defaultActiveKey={drawerCluster?.has_token ? 'nodes' : 'assigned'}
          items={[
            ...(drawerCluster?.has_token ? [
              {
                key: 'nodes', label: text('k8s.tab.liveNodes', { n: liveNodes.length }),
                children: <Table size="small" rowKey="name" loading={liveLoading} dataSource={liveNodes} pagination={false} columns={liveNodeCols} scroll={{ y: 420 }} />,
              },
              {
                key: 'pods', label: `Pod (${livePods.length})`,
                children: <Table size="small" rowKey={(r: K8sLivePod) => `${r.namespace}/${r.name}`} loading={liveLoading} dataSource={livePods} pagination={{ pageSize: 15, showSizeChanger: false }} columns={livePodCols} scroll={{ y: 420 }} />,
              },
            ] : []),
            {
              key: 'assigned', label: text('k8s.tab.assigned', { n: drawerNodes.length }),
              children: <Table columns={nodeCols} dataSource={drawerNodes} rowKey="id" size="small" pagination={false}
                locale={{ emptyText: text('k8s.noAssignedNodes') }} />,
            },
          ]}
        />
      </Drawer>
    </div>
  );
};

export default K8sClusters;
