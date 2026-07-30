import React, { useEffect, useState, useRef } from 'react';
import { Table, Button, Space, Modal, Form, Input, Badge, Popconfirm, message, Select, Spin, Tag, Checkbox } from 'antd';
import { PlusOutlined, PlayCircleOutlined, HistoryOutlined, EditOutlined, DeleteOutlined, CloseOutlined, RadarChartOutlined } from '@ant-design/icons';
import { getScanTasks, createScanTask, updateScanTask, deleteScanTask, runScanTask, stopScanTask, getScanLogs, getScanStreamUrl, type ScanTask, type ScanLog } from '../services/api';
import { TableToolbar, tablePanelStyle } from '../components/TableToolbar';
import { palette, pagePadding } from '../theme';
import { useI18n } from '../i18n';

type TextFn = (key: string, values?: Record<string, string | number>) => string;

// 定时表达式 -> 词条 key。daily:HH:MM 单独拼，时间部分不翻译。
const SCHEDULE_KEYS: Record<string, string> = {
  '@every 15m': 'scan.sched.every15m',
  '@every 30m': 'scan.sched.every30m',
  '@every 1h': 'scan.sched.every1h',
  '@every 6h': 'scan.sched.every6h',
  '@every 12h': 'scan.sched.every12h',
  '@every 24h': 'scan.sched.every24h',
};
const scheduleLabel = (s: string, text: TextFn) => {
  if (SCHEDULE_KEYS[s]) return text(SCHEDULE_KEYS[s]);
  if (s.startsWith('daily:')) return text('scan.sched.dailyAt', { time: s.slice('daily:'.length) });
  return s;
};

export const ScanTasks: React.FC = () => {
  const { text } = useI18n();
  const [tasks, setTasks] = useState<ScanTask[]>([]);
  const [loading, setLoading] = useState(false);
  const tasksRef = useRef<ScanTask[]>([]);
  tasksRef.current = tasks;

  // 扫描任务弹窗
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<ScanTask | null>(null);
  const [form] = Form.useForm();

  // 定时计划（独立于表单字段管理，提交时拼装成 schedule 字符串）
  const [schedMode, setSchedMode] = useState<'none' | 'interval' | 'daily'>('none');
  const [schedInterval, setSchedInterval] = useState('@every 1h');
  const [schedTime, setSchedTime] = useState('02:00');
  const computeSchedule = () => {
    if (schedMode === 'interval') return schedInterval;
    if (schedMode === 'daily' && schedTime) return `daily:${schedTime}`;
    return '';
  };

  // 历史日志弹窗
  const [logsVisible, setLogsVisible] = useState(false);
  const [selectedTask, setSelectedTask] = useState<ScanTask | null>(null);
  const [scanLogs, setScanLogs] = useState<ScanLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<ScanLog | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  // SSE 实时日志：当查看运行中任务时，用 EventSource 实时追加控制台行
  const [liveDetail, setLiveDetail] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const consoleRef = useRef<HTMLPreElement>(null);

  const fetchTasks = async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const data = await getScanTasks();
      setTasks(data);
    } catch {
      message.error(text('scan.loadFailed'));
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  // 同 Dashboard：切到终端标签时本页只是 display:none，组件还挂着。
  // 不判断可见性的话，有扫描在跑的时候会一直每 3 秒拉一次任务列表，
  // 而用户根本在看终端。切回来时下一拍（≤3 秒）就会刷新，不影响体验。
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchTasks(true);
    // 定时轮询扫描状态，保持任务列表状态更新
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (pageRef.current && !pageRef.current.offsetParent) return;
      const hasRunning = tasksRef.current.some((t) => t.status === 'running');
      if (hasRunning) {
        fetchTasks(false);
      }
    }, 3000);

    return () => clearInterval(timer);
  }, []);

  // 控制台日志滚动到底部
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [selectedLog?.detail, liveDetail]);

  const handleOpenAdd = () => {
    setEditingTask(null);
    form.resetFields();
    setSchedMode('none');
    setSchedInterval('@every 1h');
    setSchedTime('02:00');
    setModalVisible(true);
  };

  const handleOpenEdit = (record: ScanTask) => {
    setEditingTask(record);
    form.setFieldsValue(record);
    const s = record.schedule || '';
    if (s.startsWith('@every ')) {
      setSchedMode('interval');
      setSchedInterval(s);
    } else if (s.startsWith('daily:')) {
      setSchedMode('daily');
      setSchedTime(s.slice('daily:'.length));
    } else {
      setSchedMode('none');
    }
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteScanTask(id);
      message.success(text('scan.deleted'));
      fetchTasks();
    } catch {
      message.error(text('scan.deleteFailed'));
    }
  };

  const handleRunTask = async (id: number) => {
    try {
      message.loading({ content: text('scan.starting'), key: 'run_scan' });
      await runScanTask(id);
      message.success({ content: text('scan.started'), key: 'run_scan' });
      fetchTasks();
    } catch (e: any) {
      message.error({ content: e.message || text('scan.runFailed'), key: 'run_scan' });
    }
  };

  const handleStopTask = async (id: number) => {
    try {
      message.loading({ content: text('scan.stopping'), key: 'stop_scan' });
      await stopScanTask(id);
      message.success({ content: text('scan.stopSent'), key: 'stop_scan' });
      fetchTasks();
    } catch (e: any) {
      message.error({ content: e.message || text('scan.stopFailed'), key: 'stop_scan' });
    }
  };

  const handleShowLogs = (record: ScanTask) => {
    setSelectedTask(record);
    setSelectedLog(null);
    setScanLogs([]);
    setLiveDetail(null);
    setLogsVisible(true);
  };

  // 轮询更新运行中任务的详细日志
  useEffect(() => {
    if (!logsVisible || !selectedTask) return;

    const refreshLogs = async (showLoading = false) => {
      try {
        if (showLoading) setLogsLoading(true);
        const logs = await getScanLogs(selectedTask.id!);
        setScanLogs(logs);
        
        if (logs.length > 0) {
          // 如果没有选中的日志，或者更新当前正在查看的日志
          setSelectedLog((prev) => {
            if (!prev) return logs[0];
            const updated = logs.find(l => l.id === prev.id);
            return updated || logs[0];
          });
        }
      } catch (e) {
        console.error('获取扫描日志失败', e);
      } finally {
        if (showLoading) setLogsLoading(false);
      }
    };

    refreshLogs(true);

    const currentTask = tasks.find(t => t.id === selectedTask.id);
    const isRunning = currentTask ? currentTask.status === 'running' : selectedTask.status === 'running';

    if (!isRunning) return;

    const timer = setInterval(() => {
      const latestTask = tasksRef.current.find(t => t.id === selectedTask.id);
      const stillRunning = latestTask ? latestTask.status === 'running' : true;
      
      refreshLogs(false); // 轮询静默刷新

      if (!stillRunning) {
        clearInterval(timer);
        fetchTasks();
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [logsVisible, selectedTask]);

  // SSE 实时日志尾随：当弹窗打开、且当前查看的执行记录处于 running 时，
  // 用 EventSource 实时追加控制台输出（优先于 2s 轮询的展示）。
  // 历史日志（已完成/失败）不开启 SSE，仍由轮询/选择器展示其 detail。
  const selectedLogId = selectedLog?.id;
  const selectedLogRunning = selectedLog?.status === 'running';
  useEffect(() => {
    // 仅在弹窗打开、有任务、且正在查看的执行记录是运行中时开启实时流
    if (!logsVisible || !selectedTask?.id || !selectedLogRunning) {
      return;
    }

    // 以当前已有的 detail 作为实时尾随的初始内容，避免丢失前文
    setLiveDetail(selectedLog?.detail ?? '');

    const es = new EventSource(getScanStreamUrl(selectedTask.id));
    esRef.current = es;

    const appendLine = (line: string) => {
      setLiveDetail((prev) => {
        const base = prev ?? '';
        if (!line) return base;
        return base.length ? `${base}\n${line}` : line;
      });
    };

    // 标准 message 事件：每行控制台输出
    es.onmessage = (ev: MessageEvent) => {
      if (ev.data) appendLine(ev.data);
    };

    // 自定义 status 事件（如有）：作为系统提示追加
    es.addEventListener('status', (ev) => {
      const data = (ev as MessageEvent).data;
      if (data) appendLine(`[STATUS] ${data}`);
    });

    // 自定义 done 事件：扫描结束，关闭流并做一次最终的历史日志刷新
    es.addEventListener('done', (ev) => {
      const data = (ev as MessageEvent).data;
      if (data) appendLine(data);
      es.close();
      if (esRef.current === es) esRef.current = null;
      // 最终刷新：拉取完整历史日志与任务状态
      if (selectedTask?.id) {
        getScanLogs(selectedTask.id)
          .then((logs) => {
            setScanLogs(logs);
            setSelectedLog((prev) => {
              if (!prev) return logs[0] || null;
              return logs.find((l) => l.id === prev.id) || logs[0] || prev;
            });
          })
          .catch((e) => console.error('获取扫描日志失败', e));
      }
      fetchTasks();
    });

    es.onerror = () => {
      // 连接中断（多为扫描结束或代理断流）：关闭，回退到轮询展示
      es.close();
      if (esRef.current === es) esRef.current = null;
    };

    return () => {
      es.onmessage = null;
      es.onerror = null;
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
    // 仅在「打开/任务/所查看记录/记录是否运行中」变化时重建连接，
    // 避免 2s 轮询刷新 detail 时频繁重连导致丢失实时尾随内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logsVisible, selectedTask?.id, selectedLogId, selectedLogRunning]);

  const handleSubmit = async (values: any) => {
    try {
      const payload = { ...values, schedule: computeSchedule() };
      if (editingTask && editingTask.id) {
        await updateScanTask(editingTask.id, payload);
        message.success(text('scan.updated'));
      } else {
        await createScanTask(payload);
        message.success(text('scan.created'));
      }
      setModalVisible(false);
      fetchTasks();
    } catch {
      message.error(text('scan.submitFailed'));
    }
  };

  const getDurationText = (log: ScanLog) => {
    if (!log.started_at || !log.finished_at) return '-';
    
    const start = new Date(log.started_at).getTime();
    const finish = new Date(log.finished_at).getTime();
    
    const isStartZero = isNaN(start) || start < -60000000000000;
    const isFinishZero = isNaN(finish) || finish < -60000000000000;
    
    if (isStartZero) return '-';
    
    if (isFinishZero) {
      if (log.status === 'running') {
        const elapsed = Math.round((Date.now() - start) / 1000);
        return text('scan.elapsedSeconds', { n: elapsed > 0 ? elapsed : 0 });
      }
      return '-';
    }
    
    const seconds = Math.round((finish - start) / 1000);
    return text('scan.seconds', { n: seconds > 0 ? seconds : 0 });
  };

  const columns = [
    {
      title: text('scan.col.name'),
      dataIndex: 'name',
      key: 'name',
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: text('scan.col.kind'),
      dataIndex: 'kind',
      key: 'kind',
      render: (kind: string) =>
        kind === 'vuln' ? (
          <Tag color="purple" style={{ borderRadius: 4 }}>{text('scan.kind.vuln')}</Tag>
        ) : (
          <Tag color="blue" style={{ borderRadius: 4 }}>{text('scan.kind.discovery')}</Tag>
        ),
    },
    {
      title: text('scan.col.range'),
      dataIndex: 'target_range',
      key: 'target_range',
      render: (v: string) => <span style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{v}</span>,
    },
    {
      title: text('scan.col.ports'),
      dataIndex: 'ports',
      key: 'ports',
      render: (v: string) => <span>{v}</span>,
    },
    {
      title: text('scan.col.status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        if (status === 'running') return <Badge status="processing" text={text('scan.status.running')} />;
        if (status === 'completed') return <Badge status="success" text={text('scan.status.completed')} />;
        if (status === 'failed') return <Badge status="error" text={text('scan.status.failed')} />;
        return <Badge status="default" text={text('scan.status.idle')} />;
      },
    },
    {
      title: text('scan.col.lastRun'),
      dataIndex: 'last_run_at',
      key: 'last_run_at',
      render: (v: string) => {
        if (!v) return <span>{text('scan.neverRun')}</span>;
        const t = new Date(v).getTime();
        if (isNaN(t) || t < -60000000000000) return <span>{text('scan.neverRun')}</span>;
        return <span>{new Date(v).toLocaleString()}</span>;
      },
    },
    {
      title: text('scan.col.schedule'),
      dataIndex: 'schedule',
      key: 'schedule',
      render: (s: string) =>
        s ? (
          <Tag color="purple" style={{ borderRadius: 4 }}>⏱ {scheduleLabel(s, text)}</Tag>
        ) : (
          <span style={{ color: '#94a3b8' }}>{text('scan.manualOnly')}</span>
        ),
    },
    {
      title: text('users.col.action'),
      key: 'action',
      render: (_: any, record: ScanTask) => (
        <Space size="middle">
          {record.status === 'running' ? (
            <Button
              type="link"
              danger
              size="small"
              icon={<CloseOutlined />}
              onClick={() => handleStopTask(record.id!)}
              style={{ padding: 0 }}
            >
              {text('scan.stop')}
            </Button>
          ) : (
            <Button
              type="link"
              size="small"
              icon={<PlayCircleOutlined />}
              onClick={() => handleRunTask(record.id!)}
              style={{ color: '#10b981', padding: 0 }}
            >
              {text('scan.run')}
            </Button>
          )}
          <Button
            type="link"
            size="small"
            icon={<HistoryOutlined style={{ color: '#475569' }} />}
            onClick={() => handleShowLogs(record)}
            style={{ color: '#475569', padding: 0 }}
          >
            {text('scan.logs')}
          </Button>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined style={{ color: '#475569' }} />}
            onClick={() => handleOpenEdit(record)}
            disabled={record.status === 'running'}
            style={{ padding: 0 }}
          />
          <Popconfirm
            title={text('scan.deleteConfirm')}
            onConfirm={() => handleDelete(record.id!)}
            okText={text('common.yes')}
            cancelText={text('common.no')}
            okButtonProps={{ danger: true }}
            disabled={record.status === 'running'}
          >
            <Button type="text" danger icon={<DeleteOutlined />} disabled={record.status === 'running'} style={{ padding: 0 }} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div ref={pageRef} style={{ background: palette.bg, minHeight: '100%' }}>

      <div style={{ padding: pagePadding }} className="wjw-page-in">
        {/* 表格主体 */}
        <div style={tablePanelStyle}>
          <TableToolbar
            title={text('nav.discovery')}
            subtitle={text('scan.subtitle')}
            icon={<RadarChartOutlined />}
            onRefresh={() => fetchTasks(true)}
            loading={loading}
            left={
              <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenAdd}>
                {text('scan.create')}
              </Button>
            }
          />
          <Table
            className="wjw-table"
            columns={columns}
            dataSource={tasks}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 10, showSizeChanger: false, style: { padding: '0 16px' } }}
          />
        </div>

      {/* 创建/编辑扫描任务弹窗 */}
      <Modal
        title={editingTask ? text('scan.editTitle') : text('scan.create')}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ ports: '22,23,80,443', kind: 'discovery' }} style={{ marginTop: 16 }}>
          <Form.Item
            label={text('scan.col.name')}
            name="name"
            rules={[{ required: true, message: text('scan.form.nameRequired') }]}
          >
            <Input placeholder={text('scan.form.namePlaceholder')} />
          </Form.Item>

          <Form.Item label={text('scan.form.kind')} name="kind">
            <Select
              options={[
                { label: text('scan.form.kindDiscovery'), value: 'discovery' },
                { label: text('scan.form.kindVuln'), value: 'vuln' },
              ]}
            />
          </Form.Item>

          <Form.Item
            label={text('scan.col.range')}
            name="target_range"
            rules={[{ required: true, message: text('scan.form.rangeRequired') }]}
            help={text('scan.form.rangeHelp')}
          >
            <Input placeholder={text('scan.form.rangePlaceholder')} />
          </Form.Item>

          <Form.Item
            label={text('scan.form.ports')}
            name="ports"
            rules={[{ required: true, message: text('scan.form.portsRequired') }]}
            >
            <Input placeholder={text('scan.form.portsPlaceholder')} />
          </Form.Item>

          <Form.Item name="detect_k8s" valuePropName="checked" style={{ marginBottom: 8 }}>
            <Checkbox>{text('scan.form.detectK8s')}</Checkbox>
          </Form.Item>

          <Form.Item label={text('scan.col.schedule')} help={text('scan.form.scheduleHelp')}>
            <Space wrap>
              <Select
                value={schedMode}
                onChange={(v) => setSchedMode(v as 'none' | 'interval' | 'daily')}
                style={{ width: 120 }}
                options={[
                  { label: text('scan.sched.none'), value: 'none' },
                  { label: text('scan.sched.interval'), value: 'interval' },
                  { label: text('scan.sched.daily'), value: 'daily' },
                ]}
              />
              {schedMode === 'interval' && (
                <Select
                  value={schedInterval}
                  onChange={(v) => setSchedInterval(v)}
                  style={{ width: 150 }}
                  options={[
                    { label: text('scan.sched.every15m'), value: '@every 15m' },
                    { label: text('scan.sched.every30m'), value: '@every 30m' },
                    { label: text('scan.sched.every1h'), value: '@every 1h' },
                    { label: text('scan.sched.every6h'), value: '@every 6h' },
                    { label: text('scan.sched.every12h'), value: '@every 12h' },
                    { label: text('scan.sched.every24h'), value: '@every 24h' },
                  ]}
                />
              )}
              {schedMode === 'daily' && (
                <Input
                  type="time"
                  value={schedTime}
                  onChange={(e) => setSchedTime(e.target.value)}
                  style={{ width: 150 }}
                />
              )}
            </Space>
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 24, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setModalVisible(false)}>{text('common.cancel')}</Button>
              <Button type="primary" htmlType="submit">
                {text('common.confirm')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 历史日志弹窗 */}
      <Modal
        title={text('scan.logsTitle', { name: selectedTask?.name || '' })}
        open={logsVisible}
        onCancel={() => {
          // 关闭弹窗：停止实时流并清空实时尾随缓存
          if (esRef.current) {
            esRef.current.close();
            esRef.current = null;
          }
          setLiveDetail(null);
          setLogsVisible(false);
        }}
        footer={null}
        width={800}
        destroyOnHidden
      >
        {logsLoading && scanLogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px' }}><Spin size="large" /></div>
        ) : scanLogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#9CA3AF' }}>{text('scan.noLogs')}</div>
        ) : (
          <div style={{ marginTop: 16 }}>
            {/* 日志选择与状态 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Space>
                <span style={{ color: '#9CA3AF' }}>{text('scan.pickRun')}</span>
                <Select
                  value={selectedLog?.id}
                  onChange={(val) => {
                    const found = scanLogs.find(l => l.id === val);
                    if (found) setSelectedLog(found);
                  }}
                  style={{ width: 280 }}
                  options={scanLogs.map(l => ({
                    value: l.id,
                    label: `${new Date(l.started_at).toLocaleString()} (${l.status === 'running' ? text('scan.log.running') : l.status === 'completed' ? text('scan.status.completed') : text('scan.log.stopped')})`
                  }))}
                />
              </Space>
              
              {selectedLog && (
                <div style={{ fontSize: 13, color: '#9CA3AF' }}>
                  {text('scan.log.status')} <Badge status={selectedLog.status === 'running' ? 'processing' : selectedLog.status === 'completed' ? 'success' : 'error'} style={{ marginRight: 12 }} />
                  {text('scan.log.duration')} <span style={{ color: '#3B82F6', fontWeight: 500 }}>{getDurationText(selectedLog)}</span>
                </div>
              )}
            </div>

            {/* 控制台详细日志 */}
            <div style={{ position: 'relative' }}>
              <div style={{
                position: 'absolute', top: -10, left: 15, background: '#0c101b', padding: '0 8px',
                fontSize: 11, color: '#3b82f6', fontFamily: 'monospace', borderRadius: 4, border: '1px solid rgba(255,255,255,0.06)'
              }}>
                CONSOLE OUTPUT
              </div>
              <pre
                ref={consoleRef}
                style={{
                  background: '#0c101b',
                  color: '#34d399', 
                  padding: '24px 20px 20px 20px',
                  borderRadius: '8px',
                  height: '380px',
                  overflowY: 'auto',
                  fontFamily: 'Fira Code, Menlo, Monaco, Courier New, monospace',
                  fontSize: '12px',
                  lineHeight: '1.6',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all'
                }}
              >
                {/* 正在查看运行中的记录时，优先展示 SSE 实时尾随内容；否则展示历史 detail */}
                {(selectedLog?.status === 'running' && liveDetail !== null
                  ? liveDetail
                  : selectedLog?.detail) || text('scan.log.empty')}
              </pre>
            </div>
            
            {selectedLog && (
              <div style={{ marginTop: 12, fontSize: 13, background: '#f8fafc', padding: '12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <span style={{ fontWeight: 500, color: '#3b82f6' }}>{text('scan.log.summary')} </span>
                <span style={{ color: '#334155' }}>{selectedLog.summary}</span>
              </div>
            )}
          </div>
        )}
      </Modal>
      </div>
    </div>
  );
};
