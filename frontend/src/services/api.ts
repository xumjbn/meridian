import axios from 'axios';

const API_BASE_URL = '/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 清理本地会话并跳回登录页
const clearSession = () => {
  localStorage.removeItem('mrd-auth');
  localStorage.removeItem('mrd-token');
  localStorage.removeItem('mrd-user');
  localStorage.removeItem('mrd-role');
};

// 请求拦截：附带会话 token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('mrd-token');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截，统一返回结果里的 data
api.interceptors.response.use(
  (response) => {
    const res = response.data;
    if (res.code === 200) {
      return res.data;
    }
    // 会话失效 / 未登录：清理本地状态并回到登录页
    if (res.code === 401) {
      clearSession();
      if (!window.location.pathname.startsWith('/terminal/')) {
        window.location.reload();
      }
    }
    return Promise.reject(new Error(res.message || 'Error'));
  },
  (error) => {
    return Promise.reject(error);
  }
);

export interface Stats {
  total_assets: number;
  servers: number;
  switches: number;
  routers: number;
  other: number;
  online_assets: number;
  offline_assets: number;
  running_tasks: number;
}

export interface Credential {
  id?: number;
  name: string;
  type: 'ssh_password' | 'ssh_key' | 'telnet';
  username: string;
  password?: string;
  private_key?: string;
  created_at?: string;
}

export interface Asset {
  id?: number;
  name: string;
  ip: string;
  type: 'server' | 'switch' | 'router' | 'other';
  status?: 'online' | 'offline' | 'unknown';
  ssh_port?: number; // SSH/SFTP 连接端口（默认 22）
  vendor?: string;
  os_version?: string;
  arch?: string; // CPU 架构: x86_64 / aarch64 ...（认证采集得到）
  virtualization?: string; // 虚拟化: physical/vmware/kvm/hyper-v/xen/qemu/aws/container:*（认证采集得到）
  ports?: string; // JSON string e.g. "[22, 80]"
  description?: string;
  credential_id?: number | null;
  last_scanned_at?: string;
  tags?: string; // JSON array string e.g. '["生产","DMZ"]'
  owner_id?: number;
  owner_name?: string; // 归属用户名（后端展示用，非持久化）
}

export interface ScanTask {
  id?: number;
  name: string;
  target_range: string;
  ports: string;
  kind?: 'discovery' | 'vuln'; // 扫描类型：端口发现 / nuclei 漏扫
  status?: 'idle' | 'running' | 'completed' | 'failed';
  last_run_at?: string;
  schedule?: string; // "@every 1h" | "daily:HH:MM"
}

export interface ScanLog {
  id: number;
  task_id: number;
  status: 'completed' | 'failed' | 'running';
  started_at: string;
  finished_at: string;
  summary: string;
  detail?: string;
}

export const getStats = (): Promise<Stats> => api.get('/dashboard/stats');

export const getCredentials = (): Promise<Credential[]> => api.get('/credentials');
export const createCredential = (data: Credential): Promise<Credential> => api.post('/credentials', data);
export const updateCredential = (id: number, data: Credential): Promise<Credential> => api.put(`/credentials/${id}`, data);
export const deleteCredential = (id: number): Promise<void> => api.delete(`/credentials/${id}`);

export const getAssets = (params?: { q?: string; type?: string; status?: string }): Promise<Asset[]> =>
  api.get('/assets', { params });
export const getAsset = (id: number): Promise<Asset> => api.get(`/assets/${id}`);
export const createAsset = (data: Asset): Promise<Asset> => api.post('/assets', data);

// CSV 批量导入（按 IP upsert）
export interface ImportResult {
  created: number;
  updated: number;
  failed: number;
  errors: string[];
}
export const importAssets = (file: File): Promise<ImportResult> => {
  const fd = new FormData();
  fd.append('file', file);
  // 置空 Content-Type，让浏览器自动带上 multipart boundary
  return api.post('/assets/import', fd, { headers: { 'Content-Type': undefined } as never });
};
export const updateAsset = (id: number, data: Asset): Promise<Asset> => api.put(`/assets/${id}`, data);
export const deleteAsset = (id: number): Promise<void> => api.delete(`/assets/${id}`);

export const getScanTasks = (): Promise<ScanTask[]> => api.get('/tasks');
export const createScanTask = (data: ScanTask): Promise<ScanTask> => api.post('/tasks', data);
export const updateScanTask = (id: number, data: ScanTask): Promise<ScanTask> => api.put(`/tasks/${id}`, data);
export const deleteScanTask = (id: number): Promise<void> => api.delete(`/tasks/${id}`);
export const runScanTask = (id: number): Promise<string> => api.post(`/tasks/${id}/run`);
export const stopScanTask = (id: number): Promise<string> => api.post(`/tasks/${id}/stop`);
export const getScanLogs = (taskId: number): Promise<ScanLog[]> => api.get(`/tasks/${taskId}/logs`);

export interface ActivityLog {
  id: number;
  type: string; // asset_created | asset_updated | asset_deleted | scan_started | scan_completed | scan_failed
  message: string;
  ref_id: number;
  created_at: string;
}

export interface PingResult {
  ip: string;
  status: 'online' | 'offline';
}

// 单资产在线探测
export const pingAsset = (id: number): Promise<PingResult> => api.post(`/assets/${id}/ping`);

// 批量资产在线探测
export const batchPingAssets = (ids: number[]): Promise<{ processed: number }> => api.post('/assets/batch-ping', { ids });

export interface Tag {
  id?: number;
  name: string;
  color: string;
}

// 全局标签管理
export const getTags = (): Promise<Tag[]> => api.get('/tags');
export const createTag = (data: Tag): Promise<Tag> => api.post('/tags', data);
export const updateTag = (id: number, data: Tag): Promise<Tag> => api.put(`/tags/${id}`, data);
export const deleteTag = (id: number): Promise<void> => api.delete(`/tags/${id}`);



// 最近活动日志
export const getRecentActivity = (): Promise<ActivityLog[]> => api.get('/activity/recent');

// ── 系统配置（Phase 2/3） ─────────────────────────
export type Settings = Record<string, string>;
export const getSettings = (): Promise<Settings> => api.get('/settings');
export const updateSettings = (data: Settings): Promise<{ updated: number }> => api.put('/settings', data);

// ── 告警通知 ─────────────────────────────────
export const testNotify = (type: string, url: string): Promise<{ ok: boolean }> =>
  api.post('/notify/test', { type, url });

// ── AI 命令助手 ───────────────────────────────
export interface AiCommandResult {
  command: string;
  dangerous: boolean;
  warning: string;
}
export const aiGenerateCommand = (assetId: number, prompt: string): Promise<AiCommandResult> =>
  api.post('/ai/command', { asset_id: assetId, prompt });
// 是否启用 AI 助手（仅返回开关，不含密钥；任意登录用户可查）
export const aiStatus = (): Promise<{ enabled: boolean }> => api.get('/ai/status');
export const aiTest = (base_url: string, api_key: string, model: string): Promise<{ ok: boolean; sample: string }> =>
  api.post('/ai/test', { base_url, api_key, model });

// ── AI Agent（一句话自动完成任务：自动执行 + 高危拦截 + 多轮上下文）──
export interface AgentStep {
  index: number;
  thought?: string;
  command: string;
  output: string;
  exit_code: number;
  dangerous: boolean;
}
export interface AgentState {
  session_id: string;
  status: 'awaiting_confirm' | 'done' | 'error' | 'aborted' | 'running' | string;
  steps: AgentStep[];
  pending: string;
  pending_note: string;
  pending_warning: string;
  summary: string;
  error: string;
  work_dir: string;
}
// 启动一次 Agent 任务
export const aiAgentStart = (assetId: number, prompt: string): Promise<AgentState> =>
  api.post('/ai/agent/start', { asset_id: assetId, prompt });
// 对高危命令确认(true)/中止(false)
export const aiAgentContinue = (sessionId: string, approve: boolean): Promise<AgentState> =>
  api.post('/ai/agent/continue', { session_id: sessionId, approve });
// 多轮追加指令（带上下文记忆继续推进）
export const aiAgentMessage = (sessionId: string, prompt: string): Promise<AgentState> =>
  api.post('/ai/agent/message', { session_id: sessionId, prompt });

// 历史会话（持久化，重启不丢）
export interface AgentSessionMeta {
  session_id: string;
  asset_id: number;
  asset_name: string;
  title: string;
  status: string;
  summary: string;
  updated_at: string;
}
export const aiAgentSessions = (): Promise<AgentSessionMeta[]> => api.get('/ai/agent/sessions');
export const aiAgentSession = (id: string): Promise<AgentState> => api.get(`/ai/agent/sessions/${id}`);

// ── SFTP 文件传输 ─────────────────────────────
export interface SftpEntry {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  mode: string;
  mod_time: number;
}
export interface SftpListResult {
  path: string;
  entries: SftpEntry[];
}
export const sftpList = (assetId: number, path: string): Promise<SftpListResult> =>
  api.get(`/assets/${assetId}/sftp/list`, { params: { path } });

export const sftpUpload = (assetId: number, dir: string, file: File): Promise<{ path: string; size: number }> => {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('path', dir);
  return api.post(`/assets/${assetId}/sftp/upload`, fd, { headers: { 'Content-Type': undefined } as never });
};

export const sftpMkdir = (assetId: number, path: string): Promise<{ ok: boolean }> =>
  api.post(`/assets/${assetId}/sftp/mkdir`, { path });
export const sftpRemove = (assetId: number, path: string): Promise<{ ok: boolean }> =>
  api.post(`/assets/${assetId}/sftp/remove`, { path });
export const sftpRename = (assetId: number, from: string, to: string): Promise<{ ok: boolean }> =>
  api.post(`/assets/${assetId}/sftp/rename`, { from, to });

// 下载用原生 fetch（携带 token），区分二进制流与 JSON 错误响应
export const sftpDownload = async (assetId: number, filePath: string): Promise<void> => {
  const token = localStorage.getItem('mrd-token') || '';
  const res = await fetch(`/api/assets/${assetId}/sftp/download?path=${encodeURIComponent(filePath)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok || ct.includes('application/json')) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string })?.message || '下载失败');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filePath.split('/').pop() || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// ── 资产可用性 ───────────────────────────────
export interface AssetCheck {
  id: number;
  asset_id: number;
  status: 'online' | 'offline' | string;
  checked_at: string;
}
export interface AssetUptime {
  hours: number;
  total: number;
  online: number;
  uptime_percent: number;
  checks: AssetCheck[];
}
export const getAssetUptime = (id: number, hours = 24): Promise<AssetUptime> =>
  api.get(`/assets/${id}/uptime`, { params: { hours } });

// ── 凭据连通性测试（Phase 3） ─────────────────────
export interface CredTestResult {
  ok: boolean;
  message: string;
}
export const testCredential = (id: number, host: string, port?: number): Promise<CredTestResult> =>
  api.post(`/credentials/${id}/test`, { host, port: port ?? 0 });

// ── 认证采集（架构 / 系统信息） ─────────────────
export interface CollectResult {
  ok: boolean;
  arch?: string;
  os?: string;
  message: string;
}
export const collectAsset = (id: number): Promise<CollectResult> => api.post(`/assets/${id}/collect`);

// ── 漏洞发现（nuclei） ─────────────────────────
export interface VulnFinding {
  id: number;
  asset_id: number;
  target: string;
  template_id: string;
  name: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical' | string;
  matched_at: string;
  engine: string;
  created_at: string;
}
export const getVulns = (assetId?: number): Promise<VulnFinding[]> =>
  api.get('/vulns', { params: assetId ? { asset_id: assetId } : {} });

// ── 资产变更历史 ─────────────────────────────
export interface AssetHistory {
  id: number;
  asset_id: number;
  field: string;
  old_value: string;
  new_value: string;
  created_at: string;
}
export const getAssetHistory = (id: number): Promise<AssetHistory[]> => api.get(`/assets/${id}/history`);

// ── 登录 ───────────────────────────────────
export interface LoginResult {
  ok: boolean;
  token: string;
  username: string;
  role?: 'admin' | 'user' | string;
  must_change_password?: boolean;
}
export const login = (username: string, password: string): Promise<LoginResult> =>
  api.post('/login', { username, password });

// 注销当前会话（后端使 token 失效）
export const logout = (): Promise<{ ok: boolean }> => api.post('/logout');

// ── 用户管理 ─────────────────────────────────
export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user' | string;
  status: 'active' | 'disabled' | 'pending' | string;
  must_change_password?: boolean;
  last_login_at?: string | null;
  last_login_ip?: string;
  created_at?: string;
}

// 开放注册（创建普通用户）
export const registerUser = (username: string, password: string): Promise<{ id: number; username: string }> =>
  api.post('/register', { username, password });

// 用户列表（管理员）
export const getUsers = (): Promise<User[]> => api.get('/users');
// 管理员新增用户
export const createUser = (data: { username: string; password: string; role?: string }): Promise<{ id: number }> =>
  api.post('/users', data);
// 管理员更新用户（改角色 / 启禁用 / 重置密码）
export const updateUser = (id: number, data: { role?: string; status?: string; password?: string }): Promise<void> =>
  api.put(`/users/${id}`, data);
// 删除用户
export const deleteUser = (id: number): Promise<void> => api.delete(`/users/${id}`);
// 修改本人密码
export const changePassword = (username: string, oldPassword: string, newPassword: string): Promise<{ ok: boolean }> =>
  api.post('/users/change-password', { username, old_password: oldPassword, new_password: newPassword });

// ── 审计日志（管理员）─────────────────────────
export interface AuditLog {
  id: number;
  actor: string;
  action: 'POST' | 'PUT' | 'DELETE' | string;
  path: string;
  status: number; // 业务 code：200 成功
  ip: string;
  created_at: string;
}
export const getAuditLogs = (params?: { actor?: string; action?: string; limit?: number }): Promise<AuditLog[]> =>
  api.get('/audit', { params });

// ── 扫描日志 SSE 流地址（供 EventSource 使用，走同源 Vite 代理） ──
// EventSource 无法设置请求头，故 token 通过查询参数传递
export const getScanStreamUrl = (taskId: number): string => {
  const token = localStorage.getItem('mrd-token') || '';
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  return `/api/tasks/${taskId}/stream${q}`;
};



// WebSocket URL 辅助函数（浏览器 WebSocket 无法设置请求头，token 走查询参数）
export const getTerminalWsUrl = (assetId: number): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = localStorage.getItem('mrd-token') || '';
  // 自动尝试已存凭据（默认开）；关闭时附带 autotry=0
  const autoTry = localStorage.getItem('term_auto_cred') !== 'false';
  const params = [token ? `token=${encodeURIComponent(token)}` : '', autoTry ? '' : 'autotry=0'].filter(Boolean);
  const q = params.length ? `?${params.join('&')}` : '';

  // 仅在 Vite 开发模式下直连后端 8080，绕开 dev server 偶发的 ws 代理问题；
  // 生产 / 容器部署（vite build）一律走同源，由 nginx 反向代理到后端，
  // 这样无论用 localhost、内网 IP 还是域名访问，终端 WebSocket 都能正常握手
  if (import.meta.env.DEV && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return `${protocol}//127.0.0.1:8080/api/ws/terminal/${assetId}${q}`;
  }

  return `${protocol}//${window.location.host}/api/ws/terminal/${assetId}${q}`;
};
