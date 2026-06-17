import React, { useEffect, useState, useRef } from 'react';
import { Table, Button, Space, Modal, Form, Input, Badge, Popconfirm, message, Select, Spin } from 'antd';
import { PlusOutlined, PlayCircleOutlined, HistoryOutlined, EditOutlined, DeleteOutlined, CloseOutlined } from '@ant-design/icons';
import { getScanTasks, createScanTask, updateScanTask, deleteScanTask, runScanTask, stopScanTask, getScanLogs, type ScanTask, type ScanLog } from '../services/api';

export const ScanTasks: React.FC = () => {
  const [tasks, setTasks] = useState<ScanTask[]>([]);
  const [loading, setLoading] = useState(false);
  const tasksRef = useRef<ScanTask[]>([]);
  tasksRef.current = tasks;

  // 扫描任务弹窗
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<ScanTask | null>(null);
  const [form] = Form.useForm();

  // 历史日志弹窗
  const [logsVisible, setLogsVisible] = useState(false);
  const [selectedTask, setSelectedTask] = useState<ScanTask | null>(null);
  const [scanLogs, setScanLogs] = useState<ScanLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<ScanLog | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);

  const consoleRef = useRef<HTMLPreElement>(null);

  const fetchTasks = async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const data = await getScanTasks();
      setTasks(data);
    } catch (e) {
      message.error('获取扫描任务失败');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks(true);
    // 定时轮询扫描状态，保持任务列表状态更新
    const timer = setInterval(() => {
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
  }, [selectedLog?.detail]);

  const handleOpenAdd = () => {
    setEditingTask(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleOpenEdit = (record: ScanTask) => {
    setEditingTask(record);
    form.setFieldsValue(record);
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteScanTask(id);
      message.success('任务已删除');
      fetchTasks();
    } catch (e) {
      message.error('删除任务失败');
    }
  };

  const handleRunTask = async (id: number) => {
    try {
      message.loading({ content: '正在启动扫描任务...', key: 'run_scan' });
      await runScanTask(id);
      message.success({ content: '扫描已在后台启动！', key: 'run_scan' });
      fetchTasks();
    } catch (e: any) {
      message.error({ content: e.message || '运行任务失败', key: 'run_scan' });
    }
  };

  const handleStopTask = async (id: number) => {
    try {
      message.loading({ content: '正在停止扫描任务...', key: 'stop_scan' });
      await stopScanTask(id);
      message.success({ content: '扫描强制停止命令发送成功！', key: 'stop_scan' });
      fetchTasks();
    } catch (e: any) {
      message.error({ content: e.message || '停止任务失败', key: 'stop_scan' });
    }
  };

  const handleShowLogs = (record: ScanTask) => {
    setSelectedTask(record);
    setSelectedLog(null);
    setScanLogs([]);
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

  const handleSubmit = async (values: any) => {
    try {
      if (editingTask && editingTask.id) {
        await updateScanTask(editingTask.id, values);
        message.success('扫描任务更新成功');
      } else {
        await createScanTask(values);
        message.success('扫描任务创建成功');
      }
      setModalVisible(false);
      fetchTasks();
    } catch (e) {
      message.error('操作失败，请确认填写是否完整');
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
        return `已运行 ${elapsed > 0 ? elapsed : 0} 秒`;
      }
      return '-';
    }
    
    const seconds = Math.round((finish - start) / 1000);
    return `${seconds > 0 ? seconds : 0} 秒`;
  };

  const columns = [
    {
      title: '任务名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <span style={{ fontWeight: 500 }}>{text}</span>,
    },
    {
      title: '扫描网段 / IP 范围',
      dataIndex: 'target_range',
      key: 'target_range',
      render: (text: string) => <span style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{text}</span>,
    },
    {
      title: '探测端口',
      dataIndex: 'ports',
      key: 'ports',
      render: (text: string) => <span>{text}</span>,
    },
    {
      title: '执行状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        if (status === 'running') return <Badge status="processing" text="正在扫描" />;
        if (status === 'completed') return <Badge status="success" text="已完成" />;
        if (status === 'failed') return <Badge status="error" text="扫描失败" />;
        return <Badge status="default" text="空闲" />;
      },
    },
    {
      title: '上次运行时间',
      dataIndex: 'last_run_at',
      key: 'last_run_at',
      render: (text: string) => {
        if (!text) return <span>从未执行</span>;
        const t = new Date(text).getTime();
        if (isNaN(t) || t < -60000000000000) return <span>从未执行</span>;
        return <span>{new Date(text).toLocaleString()}</span>;
      },
    },
    {
      title: '操作',
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
              停止扫描
            </Button>
          ) : (
            <Button
              type="link"
              size="small"
              icon={<PlayCircleOutlined />}
              onClick={() => handleRunTask(record.id!)}
              style={{ color: '#10b981', padding: 0 }}
            >
              启动扫描
            </Button>
          )}
          <Button
            type="link"
            size="small"
            icon={<HistoryOutlined style={{ color: '#475569' }} />}
            onClick={() => handleShowLogs(record)}
            style={{ color: '#475569', padding: 0 }}
          >
            日志历史
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
            title="确认删除该扫描任务吗？"
            onConfirm={() => handleDelete(record.id!)}
            okText="是"
            cancelText="否"
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
    <div style={{ background: '#f8fafc', minHeight: '100vh' }}>
      {/* 顶部大厂 Header */}
      <div style={{
        background: '#ffffff',
        padding: '20px 32px',
        borderBottom: '1px solid #f1f5f9',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '24px'
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#0f172a' }}>自动发现扫描</h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>配置并触发端口网段发现任务，自动将在线主机录入 CMDB 资产中</p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleOpenAdd}
          style={{ borderRadius: 6 }}
        >
          创建扫描任务
        </Button>
      </div>

      <div style={{ padding: '0 32px 32px 32px' }}>
        {/* 表格主体 */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #f1f5f9',
          borderRadius: '8px',
          padding: '4px',
          boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.02)'
        }}>
          <Table
            columns={columns}
            dataSource={tasks}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            style={{ borderRadius: '8px', overflow: 'hidden' }}
          />
        </div>

      {/* 创建/编辑扫描任务弹窗 */}
      <Modal
        title={editingTask ? '编辑扫描任务' : '创建扫描任务'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ ports: '22,23,80,443' }} style={{ marginTop: 16 }}>
          <Form.Item
            label="任务名称"
            name="name"
            rules={[{ required: true, message: '请输入扫描任务别名' }]}
          >
            <Input placeholder="例如: 腾讯云测试机扫描" />
          </Form.Item>

          <Form.Item
            label="扫描网段 / IP 范围"
            name="target_range"
            rules={[{ required: true, message: '请输入 CIDR 或 IP 范围' }]}
            help="支持网段(如 192.168.1.0/24) 或范围(如 192.168.1.1-192.168.1.50)"
          >
            <Input placeholder="例如: 192.168.1.0/24" />
          </Form.Item>

          <Form.Item
            label="探测端口范围 (逗号分隔)"
            name="ports"
            rules={[{ required: true, message: '请输入需要扫描的端口' }]}
          >
            <Input placeholder="例如: 22,23,80,443" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 24, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit">
                确认
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 历史日志弹窗 */}
      <Modal
        title={`扫描执行日志 - ${selectedTask?.name}`}
        open={logsVisible}
        onCancel={() => setLogsVisible(false)}
        footer={null}
        width={800}
        destroyOnClose
      >
        {logsLoading && scanLogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px' }}><Spin size="large" /></div>
        ) : scanLogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#9CA3AF' }}>暂无该任务的扫描执行历史记录</div>
        ) : (
          <div style={{ marginTop: 16 }}>
            {/* 日志选择与状态 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Space>
                <span style={{ color: '#9CA3AF' }}>选择执行历史:</span>
                <Select
                  value={selectedLog?.id}
                  onChange={(val) => {
                    const found = scanLogs.find(l => l.id === val);
                    if (found) setSelectedLog(found);
                  }}
                  style={{ width: 280 }}
                  options={scanLogs.map(l => ({
                    value: l.id,
                    label: `${new Date(l.started_at).toLocaleString()} (${l.status === 'running' ? '正在执行' : l.status === 'completed' ? '已完成' : '已停止/失败'})`
                  }))}
                />
              </Space>
              
              {selectedLog && (
                <div style={{ fontSize: 13, color: '#9CA3AF' }}>
                  状态: <Badge status={selectedLog.status === 'running' ? 'processing' : selectedLog.status === 'completed' ? 'success' : 'error'} style={{ marginRight: 12 }} />
                  耗时: <span style={{ color: '#3B82F6', fontWeight: 500 }}>{getDurationText(selectedLog)}</span>
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
                {selectedLog?.detail || '[SYSTEM] 暂无详细控制台日志数据。'}
              </pre>
            </div>
            
            {selectedLog && (
              <div style={{ marginTop: 12, fontSize: 13, background: '#f8fafc', padding: '12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <span style={{ fontWeight: 600, color: '#3b82f6' }}>工作摘要: </span>
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
