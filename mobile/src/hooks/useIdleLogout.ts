import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import type { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';

const IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
const CHECK_INTERVAL_MS = 30 * 1000; // foreground idle check cadence
const LAST_ACTIVE_KEY = 'vtu_last_active';

/**
 * Auto sign-out after 3 minutes of inactivity.
 *
 * Covers three scenarios:
 *  1. Foreground idle — any touch resets the clock; if nothing is touched for
 *     3 minutes the session is ended.
 *  2. Backgrounded — the away time is measured against the last activity and
 *     the user is signed out on return to the foreground.
 *  3. Cold start — the last-activity timestamp is persisted to SecureStore, so
 *     relaunching the app after being away for 3+ minutes ends the session too.
 *
 * Returns a `recordActivity` callback to attach to the root view's onTouchStart.
 */
export function useIdleLogout(queryClient: QueryClient) {
  const router = useRouter();
  const lastActivityRef = useRef<number>(0);
  const lastAppStateRef = useRef(AppState.currentState);

  useEffect(() => {
    // Impure initialisers are only allowed inside effects (react-hooks/purity).
    lastActivityRef.current = Date.now();

    const logout = () => {
      if (!useAuthStore.getState().user) return; // already signed out
      void useAuthStore
        .getState()
        .signOut()
        .then(() => {
          lastActivityRef.current = Date.now();
          queryClient.clear();
          router.replace('/(auth)/login');
        });
    };

    const recordActive = () => {
      lastActivityRef.current = Date.now();
      void SecureStore.setItemAsync(LAST_ACTIVE_KEY, String(lastActivityRef.current)).catch(
        () => {},
      );
    };

    const handleAppStateChange = (next: AppStateStatus) => {
      const prev = lastAppStateRef.current;
      lastAppStateRef.current = next;
      const wasAway = prev === 'background' || prev === 'inactive';
      const isAway = next === 'background' || next === 'inactive';

      if (isAway) {
        // Remember the moment the app stopped being usable.
        void SecureStore.setItemAsync(LAST_ACTIVE_KEY, String(Date.now())).catch(() => {});
        return;
      }

      if (next === 'active' && wasAway) {
        // Back in the foreground — count the away time against the timeout.
        if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
          logout();
          return;
        }
        recordActive();
      }
    };

    // Cold start: restore the last-known activity timestamp so the foreground
    // idle check below ends sessions that were stale before launch.
    void SecureStore.getItemAsync(LAST_ACTIVE_KEY)
      .then((raw) => {
        const last = raw ? Number(raw) : Number.NaN;
        if (Number.isFinite(last)) lastActivityRef.current = last;
      })
      .catch(() => {});

    const appStateSub = AppState.addEventListener('change', handleAppStateChange);

    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        logout();
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      appStateSub.remove();
      clearInterval(interval);
    };
  }, [queryClient, router]);

  useEffect(() => {
    // A fresh session always starts with a full inactivity window no matter how
    // the previous one ended (manual sign-out, 401 refresh failure, idle
    // timeout), so a new login is never cut short by a stale idle clock.
    return useAuthStore.subscribe((state, prev) => {
      if (state.user && !prev.user) {
        lastActivityRef.current = Date.now();
        void SecureStore.setItemAsync(LAST_ACTIVE_KEY, String(lastActivityRef.current)).catch(
          () => {},
        );
      }
    });
  }, []);

  /** Reset the idle clock — attach to the root view's onTouchStart. */
  const recordActivity = () => {
    lastActivityRef.current = Date.now();
  };

  return recordActivity;
}