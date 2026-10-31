export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'https://smart-cafe-bay.vercel.app/api';

export interface Session {
  accessToken: string;
  refreshToken: string;
}

const TOKEN_KEY = 'vtu_admin_token';
const SESSION_KEY = 'vtu_admin_session';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session) {
  window.localStorage.setItem(TOKEN_KEY, session.accessToken);
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(SESSION_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

/** Attach an Authorization header, refresh the session when 401. */
let refreshing: Promise<void> | null = null;

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  let res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    const session = getSession();
    if (session?.refreshToken) {
      try {
        await (refreshing ??= doRefresh(session).finally(() => { refreshing = null; }));
        headers.Authorization = `Bearer ${getToken() ?? ''}`;
        res = await fetch(`${API_BASE}${path}`, { ...options, headers });
      } catch {
        clearSession();
        if (typeof window !== 'undefined') window.location.href = '/login';
        throw new Error('Session expired');
      }
    } else {
      clearSession();
      if (typeof window !== 'undefined') window.location.href = '/login';
      throw new Error('Unauthorized');
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray((data as any).message)
      ? (data as any).message.join(', ')
      : (data as any)?.message ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

async function doRefresh(session: Session) {
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Refresh failed');
  saveSession(data);
}