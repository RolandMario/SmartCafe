import * as SecureStore from 'expo-secure-store';

export interface SavedCredentials {
  identifier: string;
  password: string;
}

/**
 * "Remember me" — persist the last successful login credentials in the device
 * keychain so the login form can be pre-filled after the user signs out.
 * Kept separate from the session store, so signing out does not clear it.
 */
const KEY = 'vtu_remember_me';

export async function loadSavedCredentials(): Promise<SavedCredentials | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<SavedCredentials>;
    if (!data.identifier) return null;
    return { identifier: data.identifier, password: data.password ?? '' };
  } catch {
    return null;
  }
}

export async function saveCredentials(identifier: string, password: string) {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify({ identifier, password }));
  } catch {
    // ignore storage errors
  }
}

export async function clearSavedCredentials() {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // ignore storage errors
  }
}