import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/auth';

// Base URL: prefer an explicit env override, otherwise use the hosted backend.
// For local development against a locally-running backend, set
// EXPO_PUBLIC_API_URL (e.g. http://<your-lan-ip>:4000/api) in mobile/.env.
export const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://smart-cafe-bay.vercel.app/api';

export const api = axios.create({ baseURL: BASE_URL, timeout: 90000 });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

function isAuthEndpoint(url?: string) {
  if (!url) return false;
  return url.includes('/auth/login') || url.includes('/auth/refresh');
}

let refreshingPromise: Promise<string> | null = null;

async function doRefresh(): Promise<string> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }
  const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
  useAuthStore.getState().setTokens(data);
  return data.accessToken as string;
}

function refreshAccessToken(): Promise<string> {
  if (!refreshingPromise) {
    refreshingPromise = doRefresh().finally(() => {
      refreshingPromise = null;
    });
  }
  return refreshingPromise;
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const status = error.response?.status;
    const data = error.response?.data as { message?: string | string[] } | undefined;
    // Only treat a 401 as a session-expiry when it really looks like one.
    // Business rejections (e.g. "Incorrect transaction PIN") used to come back
    // as 401 on older backends — refreshing the token can never fix those, and
    // a failed refresh logs the user out for no reason. The backend now returns
    // 403 for those, but stay defensive: if the body carries a meaningful
    // non-auth message, surface it directly instead of refreshing.
    let looksLikeSessionExpiry = false;
    if (data?.message) {
      const msg = Array.isArray(data.message) ? data.message[0] : data.message;
      looksLikeSessionExpiry = /unauthorized/i.test(String(msg));
    } else {
      looksLikeSessionExpiry = true; // no readable body (HTML/empty) — treat as session problem
    }
    if (
      status === 401 &&
      looksLikeSessionExpiry &&
      original &&
      !original._retry &&
      !isAuthEndpoint(original.url)
    ) {
      original._retry = true;
      try {
        const newAccess = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${newAccess}`;
        return api(original);
      } catch (refreshError) {
        void useAuthStore.getState().signOut();
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  },
);

/**
 * Endpoints that create an order (or funding request) server-side. If one of
 * these times out, the outcome is genuinely unknown — the order may still be
 * processing, so the "check your Transactions" wording is appropriate. A
 * timeout on any other request (login, profile, catalog, …) never touched an
 * order, so that wording would just confuse the user.
 */
const ORDER_CREATING_ENDPOINTS = [
  '/airtime/purchase',
  '/data/purchase',
  '/cable/purchase',
  '/electricity/purchase',
  '/waec/purchase',
  '/jamb/purchase',
  '/sms/purchase',
  '/funding/deposit',
];

function isOrderCreatingRequest(url?: string) {
  if (!url) return false;
  return ORDER_CREATING_ENDPOINTS.some((endpoint) => url.includes(endpoint));
}

/** Extract a friendly error message from an axios/API error. */
export function apiErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as any;
    if (data?.message) {
      if (Array.isArray(data.message)) return data.message.join(', ');
      return String(data.message);
    }
    // No server response -> network-level failure (timeout / lost connection).
    if (
      err.code === 'ECONNABORTED' ||
      err.code === 'ETIMEDOUT' ||
      /timeout/i.test(String(err.message))
    ) {
      // Only purchases (and wallet deposits) can leave a real order pending
      // server-side after a timeout. For any other request — including the
      // login call — keep the message generic so it never implies an order
      // was placed (or asks users to check Transactions they may not see).
      if (isOrderCreatingRequest(err.config?.url)) {
        return 'The request timed out. Your order may still be processing — check your Transactions to confirm its status before trying again.';
      }
      return 'The request timed out. Please check your internet connection and try again.';
    }
    // HTTP error without a parseable JSON body (proxy/HTML 401, etc.).
    // Never leak the raw "Request failed with status code 401" to the user.
    if (err.response) {
      const status = err.response.status;
      if (status === 401) {
        return 'Your session has expired. Please sign in again.';
      }
      return `Request failed (${status}). Please try again.`;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
