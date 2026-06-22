import axios from 'axios';

const API_BASE_URL = '/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 响应拦截，统一返回结果里的 data
api.interceptors.response.use(
  (response) => {
    const res = response.data;
    if (res.code === 200) {
      return res.data;
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
  vendor?: string;
  os_version?: string;
  arch?: string; // CPU 架构: x86_64 / aarch64 ...（认证采集得到）
  virtualization?: string; // 虚拟化: physical/vmware/kvm/hyper-v/xen/qemu/aws/container:*（认证采集得到）
  ports?: string; // JSON string e.g. "[22, 80]"
  description?: string;
  credential_id?: number | null;
  last_scanned_at?: string;
  tags?: string; // JSON array string e.g. '["生产","DMZ"]'
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
}
export const login = (username: string, password: string): Promise<LoginResult> =>
  api.post('/login', { username, password });

// ── 扫描日志 SSE 流地址（供 EventSource 使用，走同源 Vite 代理） ──
export const getScanStreamUrl = (taskId: number): string => `/api/tasks/${taskId}/stream`;



// WebSocket URL 辅助函数
export const getTerminalWsUrl = (assetId: number): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  // 仅在 Vite 开发模式下直连后端 8080，绕开 dev server 偶发的 ws 代理问题；
  // 生产 / 容器部署（vite build）一律走同源，由 nginx 反向代理到后端，
  // 这样无论用 localhost、内网 IP 还是域名访问，终端 WebSocket 都能正常握手
  if (import.meta.env.DEV && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return `${protocol}//127.0.0.1:8080/api/ws/terminal/${assetId}`;
  }

  return `${protocol}//${window.location.host}/api/ws/terminal/${assetId}`;
};
