import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Select, Space, Tooltip, message } from 'antd';
import {
  RobotOutlined, ThunderboltOutlined, PlusOutlined,
  HistoryOutlined, SyncOutlined, MinusOutlined, StopOutlined,
} from '@ant-design/icons';
import {
  aiStatus, aiAgentStart, aiAgentContinue, aiAgentMessage, aiAgentSessions, aiAgentSession, aiAgentStop,
  type Asset, type AgentState, type AgentSessionMeta,
} from '../services/api';

const genAgentId = () => `agent-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

interface Props {
  assets: Asset[];
  defaultAssetId: number;
  /** 跳转到系统设置（用于未启用 AI 时引导配置） */
  onOpenSettings?: () => void;
}

const MIN_W = 320;
const MAX_W = 760;

// 悬浮球的位置：存的是「距容器右下角的偏移」而不是绝对坐标。
// 用右下偏移，窗口缩放时球会跟着角走，不会跑到可视区外面去。
const BALL_POS_KEY = 'ai_ball_pos';
const BALL_DEFAULT = { right: 16, bottom: 16 };
/** 小于这个位移量算点击，不算拖拽——否则手一抖就打不开面板了 */
const DRAG_SLOP = 4;

/**
 * 悬浮式 AI 助手面板：默认收起为右下角悬浮按钮，点击展开；宽度可拖拽调节；
 * 支持新建 / 切换历史对话。Agent 在后端独立 SSH 通道执行命令（自动执行 + 高危拦截）。
 */
export const TerminalAIPanel: React.FC<Props> = ({ assets, defaultAssetId, onOpenSettings }) => {
  const [enabled, setEnabled] = useState(false);
  const [statusChecked, setStatusChecked] = useState(false);
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState<number>(() => {
    const s = parseInt(localStorage.getItem('ai_panel_width') || '', 10);
    return s >= MIN_W && s <= MAX_W ? s : 420;
  });

  // 悬浮球位置。默认在右下角，但那儿常压住终端最后几行输出，所以做成可拖的。
  const [ballPos, setBallPos] = useState<{ right: number; bottom: number }>(() => {
    try {
      const raw = localStorage.getItem(BALL_POS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (Number.isFinite(p?.right) && Number.isFinite(p?.bottom)) return p;
      }
    } catch { /* 存坏了就用默认位置 */ }
    return BALL_DEFAULT;
  });
  const ballRef = useRef<HTMLElement | null>(null);
  // 拖拽过程中的临时状态。用 ref 而不是 state：mousemove 频率高，
  // 每次 setState 都会重渲染整个面板组件。
  const ballDragRef = useRef<{ x: number; y: number; right: number; bottom: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = ballDragRef.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > DRAG_SLOP) {
        d.moved = true;
        setDragging(true);
      }
      if (!d.moved) return;
      // 往左拖 = right 变大；往上拖 = bottom 变大
      const host = ballRef.current?.offsetParent as HTMLElement | null;
      const el = ballRef.current;
      const maxR = Math.max(0, (host?.clientWidth || 0) - (el?.offsetWidth || 0));
      const maxB = Math.max(0, (host?.clientHeight || 0) - (el?.offsetHeight || 0));
      setBallPos({
        right: Math.min(maxR, Math.max(0, d.right - dx)),
        bottom: Math.min(maxB, Math.max(0, d.bottom - dy)),
      });
    };
    const onUp = () => {
      if (!ballDragRef.current) return;
      const moved = ballDragRef.current.moved;
      ballDragRef.current = null;
      document.body.style.cursor = '';
      setDragging(false);
      // 没怎么动就是想点开面板；真拖过了就只落位，不要顺手把面板弹出来
      if (!moved) setOpen(true);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  useEffect(() => { localStorage.setItem(BALL_POS_KEY, JSON.stringify(ballPos)); }, [ballPos]);

  const [target, setTarget] = useState<number>(defaultAssetId);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<AgentState | null>(null);
  const [history, setHistory] = useState<AgentSessionMeta[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null); // 运行中的会话 id，用于停止

  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const checkStatus = () => {
    aiStatus()
      .then((s) => setEnabled(!!s.enabled))
      .catch(() => {})
      .finally(() => setStatusChecked(true));
  };
  useEffect(() => { checkStatus(); }, []);

  useEffect(() => { setTarget(defaultAssetId); }, [defaultAssetId]);

  // 展开时刷新历史列表 + 重新检测 AI 是否已启用（便于刚在设置里配置完即生效）
  const loadHistory = () => {
    aiAgentSessions().then(setHistory).catch(() => {});
  };
  useEffect(() => {
    if (open) {
      checkStatus();
      loadHistory();
    }
  }, [open]);

  // 执行记录滚动到底
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [active, loading]);

  // 首次状态尚未返回前不闪现按钮；返回后无论是否启用都常驻入口（未启用则引导去配置）
  if (!statusChecked) return null;

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: width };
    let latest = width; // 跟踪拖拽到的最新宽度，避免 up 闭包持久化拖拽前的旧值
    const move = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      // 面板锚定右侧，向左拖拽变宽
      const next = Math.max(MIN_W, Math.min(MAX_W, dragRef.current.startW + (dragRef.current.startX - ev.clientX)));
      latest = next;
      setWidth(next);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('ai_panel_width', String(latest));
      dragRef.current = null;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const runStart = async () => {
    const p = prompt.trim();
    if (!p) return;
    if (!target) { message.warning('请先选择要操作的资产'); return; }
    const sid = genAgentId();
    setRunningId(sid);
    setLoading(true);
    try {
      const st = await aiAgentStart(target, p, sid);
      setActive(st);
      setPrompt('');
      loadHistory();
    } catch (e: any) {
      message.error(e?.message || 'AI 任务启动失败');
    } finally { setLoading(false); setRunningId(null); }
  };

  const runFollowup = async () => {
    const p = prompt.trim();
    if (!p || !active) return;
    setRunningId(active.session_id);
    setLoading(true);
    try {
      const st = await aiAgentMessage(active.session_id, p);
      setActive(st);
      setPrompt('');
      loadHistory();
    } catch (e: any) {
      message.error(e?.message || '发送失败');
    } finally { setLoading(false); setRunningId(null); }
  };

  const confirm = async (approve: boolean) => {
    if (!active) return;
    setRunningId(active.session_id);
    setLoading(true);
    try {
      const st = await aiAgentContinue(active.session_id, approve);
      setActive(st);
      loadHistory();
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    } finally { setLoading(false); setRunningId(null); }
  };

  // 立即停止运行中的任务（误操作中止）；运行中的 start/continue/message 请求会随之返回 aborted
  const stop = async () => {
    const sid = runningId || active?.session_id;
    if (!sid) return;
    try {
      await aiAgentStop(sid);
      message.info('正在停止…');
    } catch (e: any) {
      message.error(e?.message || '停止失败');
    }
  };

  const openSession = async (id: string) => {
    setLoading(true);
    try {
      const st = await aiAgentSession(id);
      setActive(st);
    } catch (e: any) {
      message.error(e?.message || '载入会话失败');
    } finally { setLoading(false); }
  };

  const newChat = () => { setActive(null); setPrompt(''); };
  const onSubmit = active ? runFollowup : runStart;

  // ── 收起态：右下角悬浮按钮（未启用也常驻，点开引导配置）──────────
  if (!open) {
    return (
      <Tooltip title={enabled ? '按住可拖动' : 'AI 助手未启用，点击查看如何开启'} placement="left">
        <Button
          type="primary"
          icon={<RobotOutlined />}
          ref={(el) => { ballRef.current = el as unknown as HTMLElement | null; }}
          // 开面板放在 mouseup 里判定：拖完手一松不该顺带把面板弹出来。
          // 这里不接 onClick，否则拖拽结束时浏览器仍会补一次 click。
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            ballDragRef.current = { x: e.clientX, y: e.clientY, right: ballPos.right, bottom: ballPos.bottom, moved: false };
            document.body.style.cursor = 'grabbing';
          }}
          style={{
            position: 'absolute', right: ballPos.right, bottom: ballPos.bottom, zIndex: 1500,
            height: 40, borderRadius: 20,
            cursor: dragging ? 'grabbing' : 'grab',
            // 拖的时候半透明，好看清底下被挡住的终端内容
            opacity: dragging ? 0.6 : (enabled ? 1 : 0.92),
            transition: dragging ? 'none' : 'opacity .15s',
            boxShadow: enabled ? '0 6px 20px rgba(99,102,241,0.45)' : '0 6px 20px rgba(100,116,139,0.35)',
            background: enabled ? 'linear-gradient(135deg,#6366f1,#7c5cfb)' : 'linear-gradient(135deg,#64748b,#475569)',
            border: 'none',
            userSelect: 'none',
          }}
        >
          AI 助手
        </Button>
      </Tooltip>
    );
  }

  const targetAsset = assets.find((a) => a.id === target);

  // ── 展开态：悬浮面板 ────────────────────────────
  return (
    <div style={{
      position: 'absolute', top: 12, right: 12, bottom: 12, width, zIndex: 1500,
      display: 'flex', flexDirection: 'column',
      background: '#0f172a', border: '1px solid #334155', borderRadius: 10,
      boxShadow: '0 12px 40px rgba(0,0,0,0.55)', overflow: 'hidden',
    }}>
      {/* 左边缘拖拽调宽 */}
      <div
        onMouseDown={startResize}
        style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 2 }}
      />

      {/* 头部 */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#a5b4fc', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RobotOutlined /> AI 助手 · 自动执行
          </span>
          <Space size={2}>
            <Tooltip title="新建对话"><Button size="small" type="text" icon={<PlusOutlined />} onClick={newChat} style={{ color: '#94a3b8' }} /></Tooltip>
            <Tooltip title="收起"><Button size="small" type="text" icon={<MinusOutlined />} onClick={() => setOpen(false)} style={{ color: '#94a3b8' }} /></Tooltip>
          </Space>
        </div>
        <Space size={6} style={{ width: '100%' }} wrap>
          {/* 目标资产：新对话可选，进行中的对话固定显示其资产 */}
          {active ? (
            <span style={{ fontSize: 11, color: '#64748b' }}>
              资产：{history.find((h) => h.session_id === active.session_id)?.asset_name || targetAsset?.name || '—'}
              <span style={{ marginLeft: 6, color: active.status === 'done' ? '#34d399' : active.status === 'awaiting_confirm' ? '#fbbf24' : '#94a3b8' }}>
                · {active.status}
              </span>
            </span>
          ) : (
            <Select
              size="small"
              showSearch
              placeholder="选择资产"
              value={target || undefined}
              onChange={setTarget}
              filterOption={(i, o) => (o?.label ?? '').toLowerCase().includes(i.toLowerCase())}
              options={assets.map((a) => ({ label: `${a.name} (${a.ip})`, value: a.id }))}
              style={{ width: 180 }}
              popupMatchSelectWidth={false}
            />
          )}
          {/* 历史对话切换 */}
          <Select<string>
            size="small"
            value={undefined}
            placeholder={<span><HistoryOutlined /> 历史 ({history.length})</span>}
            onChange={(v) => { if (v) openSession(v); }}
            options={history.map((h) => ({
              label: `${h.asset_name || '?'}｜${h.title || '(无标题)'}`,
              value: h.session_id,
            }))}
            style={{ width: 150 }}
            popupMatchSelectWidth={320}
          />
        </Space>
      </div>

      {!enabled ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 12 }}>
          <RobotOutlined style={{ fontSize: 32, color: '#64748b' }} />
          <div style={{ fontSize: 13, color: '#cbd5e1', fontWeight: 600 }}>AI 助手未启用</div>
          <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
            前往「系统设置 → AI」填写 API 地址 / Key / 模型并开启，即可在终端里用一句话自动完成运维任务。
          </div>
          <Space>
            {onOpenSettings && (
              <Button size="small" type="primary" onClick={() => { setOpen(false); onOpenSettings(); }}>去设置</Button>
            )}
            <Button size="small" onClick={checkStatus}>我已配置，重新检测</Button>
          </Space>
        </div>
      ) : (
      <>
      {/* 执行记录 */}
      <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 10px' }}>
        {!active && !loading && (
          <div style={{ color: '#64748b', fontSize: 12, padding: '24px 4px', textAlign: 'center', lineHeight: 1.7 }}>
            用一句话描述要自动完成的运维任务，例如：<br />
            <span style={{ color: '#818cf8' }}>清理 /var/log 下大于 100M 的日志</span><br />
            AI 会自动执行命令并读取输出推进，命中高危命令时暂停请你确认。
          </div>
        )}

        {active?.steps?.map((step) => (
          <div key={step.index} style={{ marginBottom: 10 }}>
            {step.thought && <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>💭 {step.thought}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#e2e8f0', flex: 1, minWidth: 0, wordBreak: 'break-all' }}>
                <span style={{ color: '#818cf8' }}>▶ </span>{step.command}
              </span>
              <span style={{ fontSize: 10, color: step.exit_code === 0 ? '#10B981' : '#f87171', whiteSpace: 'nowrap' }}>
                exit {step.exit_code}{step.dangerous ? ' ⚠' : ''}
              </span>
            </div>
            {step.output && (
              <pre style={{
                margin: '4px 0 0 0', maxHeight: 160, overflow: 'auto',
                background: '#020617', border: '1px solid #1e293b', borderRadius: 4,
                padding: '6px 8px', fontFamily: 'monospace', fontSize: 11, color: '#cbd5e1',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>{step.output}</pre>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#818cf8', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <SyncOutlined spin /> AI 执行中…（自动运行命令并读取输出推进任务）
            </span>
            <Button size="small" danger icon={<StopOutlined />} onClick={stop}>停止</Button>
          </div>
        )}

        {!loading && active?.status === 'awaiting_confirm' && (
          <div style={{ background: '#020617', border: '1px solid #b91c1c', borderRadius: 6, padding: '8px 10px' }}>
            {active.pending_note && <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>💭 {active.pending_note}</div>}
            <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#fca5a5', wordBreak: 'break-all', marginBottom: 4 }}>{active.pending}</div>
            <div style={{ fontSize: 11, color: '#f87171', marginBottom: 8 }}>{active.pending_warning || '⚠️ 高危命令，确认后才会执行'}</div>
            <Space>
              <Button size="small" danger type="primary" icon={<ThunderboltOutlined />} onClick={() => confirm(true)}>确认执行</Button>
              <Button size="small" onClick={() => confirm(false)}>中止</Button>
            </Space>
          </div>
        )}

        {!loading && (active?.status === 'done' || active?.status === 'aborted') && active.summary && (
          <div style={{ fontSize: 12, color: active.status === 'done' ? '#34d399' : '#94a3b8', marginTop: 4 }}>
            {active.status === 'done' ? '✓ ' : '■ '}{active.summary}
          </div>
        )}
        {!loading && active?.status === 'error' && (
          <div style={{ fontSize: 12, color: '#f87171', marginTop: 4 }}>✗ {active.error}</div>
        )}
      </div>

      {/* 输入区 */}
      <div style={{ padding: '8px 10px', borderTop: '1px solid #1e293b', flexShrink: 0 }}>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            size="small"
            value={prompt}
            disabled={loading}
            onChange={(e) => setPrompt(e.target.value)}
            onPressEnter={onSubmit}
            placeholder={active ? '追加指令继续（带上下文）…' : '一句话描述要自动完成的任务…'}
            prefix={<RobotOutlined style={{ color: '#818cf8' }} />}
            style={{ background: '#1e293b', borderColor: '#334155', color: '#e2e8f0' }}
          />
          <Button size="small" type="primary" loading={loading} onClick={onSubmit}>
            {active ? '继续' : '执行'}
          </Button>
        </Space.Compact>
      </div>
      </>
      )}
    </div>
  );
};

export default TerminalAIPanel;
