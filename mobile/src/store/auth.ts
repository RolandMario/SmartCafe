import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { AuthTokens, User } from '../types';

const STORAGE_KEY = 'vtu_session';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  /** true once initial session has been loaded from storage */
  bootstrapped: boolean;
  setTokens: (tokens: AuthTokens) => void;
  setUser: (user: User) => void;
  signIn: (tokens: AuthTokens, user: User) => Promise<void>;
  signOut: () => Promise<void>;
  hydrate: () => Promise<void>;
}

interface Persisted {
  user?: User;
  tokens?: AuthTokens;
}

async function persist(payload: Persisted) {
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    // ignore storage errors in dev
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  bootstrapped: false,

  setTokens: (tokens) => {
    set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    persist({ user: get().user ?? undefined, tokens });
  },

  setUser: (user) => {
    set({ user });
    persist({
      user,
      tokens:
        get().accessToken && get().refreshToken
          ? { accessToken: get().accessToken!, refreshToken: get().refreshToken! }
          : undefined,
    });
  },

  signIn: async (tokens, user) => {
    set({ user, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, bootstrapped: true });
    await persist({ user, tokens });
  },

  signOut: async () => {
    set({ user: null, accessToken: null, refreshToken: null, bootstrapped: true });
    try {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
    } catch {}
  },

  hydrate: async () => {
    try {
      const raw = await SecureStore.getItemAsync(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw) as Persisted;
        set({
          user: data.user ?? null,
          accessToken: data.tokens?.accessToken ?? null,
          refreshToken: data.tokens?.refreshToken ?? null,
          bootstrapped: true,
        });
      } else {
        set({ bootstrapped: true });
      }
    } catch {
      set({ bootstrapped: true });
    }
  },
}));
