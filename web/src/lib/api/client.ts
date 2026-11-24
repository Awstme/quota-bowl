export type Session = { authenticated: boolean; csrfToken?: string };

export type Metric = {
  key: string;
  label: string;
  value: number | string;
  unit: string;
  resetsAt?: string;
};

export type Snapshot = { collectedAt: string; metrics: Metric[] };

export type Target = {
  id: string;
  label: string;
  provider: string;
  workspaceId?: string;
  intervalSeconds: number;
  credentialSource: 'managed' | 'file' | 'unconfigured';
  credentialFileConfigured: boolean;
  status: 'pending' | 'ok' | 'failed';
  errorCode?: string;
  lastAttemptAt?: string;
  latest?: Snapshot;
};

export type TargetsResponse = { targets: Target[] };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    const payload: { error?: { code?: string; message?: string } } | null =
      await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'HTTP_ERROR',
      payload?.error?.message ?? `HTTP ${response.status}`,
    );
  }
  return response;
}

async function read<T>(path: string, options?: RequestInit): Promise<T> {
  return (await request(path, options)).json();
}

export const api = {
  session: (signal?: AbortSignal) => read<Session>('/session', { signal }),
  login: (username: string, password: string) => read<Session & { authenticated: true; csrfToken: string }>('/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }),
  logout: async (token: string) => {
    await request('/session', { method: 'DELETE', headers: { 'x-csrf-token': token } });
  },
  targets: (signal?: AbortSignal) => read<TargetsResponse>('/targets', { signal }),
  createAccount: (account: { id: string; provider: string; label: string; workspaceId?: string; credential: string }, token: string) =>
    read<{ id: string }>('/targets', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify(account),
    }),
  saveCredential: async (id: string, credential: string, token: string) => {
    await request(`/targets/${encodeURIComponent(id)}/credential`, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify({ credential }),
    });
  },
  removeCredential: async (id: string, token: string) => {
    await request(`/targets/${encodeURIComponent(id)}/credential`, {
      method: 'DELETE', headers: { 'x-csrf-token': token },
    });
  },
  history: (id: string, signal?: AbortSignal) =>
    read<{ snapshots: Snapshot[] }>(`/targets/${encodeURIComponent(id)}/history`, { signal }),
  refresh: async (id: string, token: string) => {
    await request(`/targets/${encodeURIComponent(id)}/refresh`, {
      method: 'POST', headers: { 'x-csrf-token': token },
    });
  },
};

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401: return '登录已失效，请重新登录。';
      case 403: return '操作未通过验证。请重新加载页面后再试。';
      case 404: return '这条记录已不存在，请重新加载台账。';
      case 409: return '已有采集任务正在处理，请稍后再试。';
      case 429: return '操作过于频繁，请稍后再试。';
      default: return fallback;
    }
  }
  if (error instanceof TypeError) return '无法连接服务，请检查连接后重试。';
  return fallback;
}
