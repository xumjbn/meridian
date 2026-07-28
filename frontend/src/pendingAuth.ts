// ─────────────────────────────────────────────────────────────
// 「新建连接」输入的 SSH 账号密码的临时中转。
//
// 只放内存，不落 localStorage、不写数据库——密码一律不持久化。
// 终端会话收到后端的 auth_request 时，若这里有对应资产的待用凭据，
// 就直接应答，用户不用在弹窗里把账号密码再敲一遍；用完立即抹掉。
// ─────────────────────────────────────────────────────────────

export interface PendingAuth {
  username: string;
  password: string;
}

const store = new Map<number, PendingAuth>();

export const setPendingAuth = (assetId: number, auth: PendingAuth): void => {
  store.set(assetId, auth);
};

/** 取出并删除：一次性使用，避免凭据在内存里留存 */
export const takePendingAuth = (assetId: number): PendingAuth | undefined => {
  const v = store.get(assetId);
  if (v) store.delete(assetId);
  return v;
};

export const clearPendingAuth = (assetId: number): void => {
  store.delete(assetId);
};
