import {
  unifiedTranslationScheduler,
  OFFICIAL_CANDIDATE_MODELS,
} from './unifiedTranslationScheduler.ts';

export { unifiedTranslationScheduler, OFFICIAL_CANDIDATE_MODELS };

const LEGACY_API_KEY_STORAGE_KEY = 'gemini_api_key';
const CLOUD_TRANSLATION_ENABLED_KEY = 'meetily_cloud_translation_enabled';

let isTauriDetected: boolean | null = null;
// In-memory test mock state for non-Tauri / test environments
let mockConfiguredInVault = false;

/**
 * Check if the app is currently running inside Tauri
 */
function isTauriEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  if (isTauriDetected !== null) return isTauriDetected;
  isTauriDetected = Boolean(
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ ||
    (window as unknown as { __TAURI__?: unknown }).__TAURI__
  );
  return isTauriDetected;
}

/**
 * Check if the user has explicitly authorized cloud-based translation.
 * Default is FALSE to ensure no meeting content is sent to Google Gemini API without consent.
 */
export function isCloudTranslationEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(CLOUD_TRANSLATION_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Update user's explicit authorization for cloud-based translation.
 * When disabled, immediately cancels all queued translation tasks.
 */
export function setCloudTranslationEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CLOUD_TRANSLATION_ENABLED_KEY, enabled ? 'true' : 'false');
    if (!enabled) {
      unifiedTranslationScheduler.clear();
    }
  } catch (error) {
    console.error('[GeminiTranslation] Failed to update cloud translation authorization:', error);
  }
}

/**
 * Migration result for legacy localStorage Gemini API key.
 */
export interface LegacyKeyMigrationResult {
  migrated: boolean;
  error?: string;
}

/**
 * Migrate legacy localStorage Gemini API key into the OS secure credential store.
 * 
 * Strict Atomic Migration Workflow:
 * 1. Read old value from localStorage;
 * 2. Invoke atomic Rust command `api_migrate_gemini_api_key` which:
 *    - Backs up existing store value;
 *    - Writes candidate key;
 *    - Reads back and verifies with constant-time equality;
 *    - Rolls back to previous value if verification fails.
 * 3. Only after receiving verified success, delete the old value from localStorage.
 * 4. If ANY step fails, retain the old value and report the error (do not fail silently).
 * 5. Under no circumstances log or expose the key, its length, prefix/suffix, or fingerprint.
 */
export async function migrateLegacyGeminiKey(options?: {
  migrateFn?: (key: string) => Promise<void>;
  removeFn?: () => void;
}): Promise<LegacyKeyMigrationResult> {
  if (typeof window === 'undefined') {
    return { migrated: false };
  }

  let oldKey: string | null = null;
  try {
    oldKey = localStorage.getItem(LEGACY_API_KEY_STORAGE_KEY);
  } catch (readErr) {
    const error = `Failed to read legacy key from localStorage: ${readErr}`;
    console.error(`[GeminiMigration] ${error}`);
    return { migrated: false, error };
  }

  if (!oldKey || !oldKey.trim()) {
    return { migrated: false };
  }

  const trimmedKey = oldKey.trim();

  try {
    // Step 2: Atomic migration via backend
    if (options?.migrateFn) {
      await options.migrateFn(trimmedKey);
    } else if (isTauriEnvironment()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('api_migrate_gemini_api_key', { apiKey: trimmedKey });
    } else {
      mockConfiguredInVault = true;
    }

    // Step 3: Only on verified success, remove from localStorage
    if (options?.removeFn) {
      options.removeFn();
    } else {
      localStorage.removeItem(LEGACY_API_KEY_STORAGE_KEY);
    }

    return { migrated: true };
  } catch (err: unknown) {
    // Step 4: Retain old value and report error without leaking secrets
    const errMsg = (err as { message?: string })?.message || 'Migration to secure credential store failed';
    console.error(
      `[GeminiMigration] Migration to secure credential store failed. Legacy key was retained in localStorage: ${errMsg}`
    );
    return { migrated: false, error: errMsg };
  }
}

/**
 * Initialize Gemini translation service:
 * 1. Wire up backend translation command to UnifiedTranslationScheduler.
 * 2. Perform legacy key migration if old key exists in localStorage.
 * 3. Return whether the Gemini API key is configured.
 */
export async function initializeGeminiKey(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    if (isTauriEnvironment()) {
      const { invoke } = await import('@tauri-apps/api/core');

      // Hook up backend translation function to unifiedTranslationScheduler
      // Note: Key is read internally in Rust from OS secure store; never passed from frontend
      unifiedTranslationScheduler.setBackendTranslateFn(async (text, model) => {
        return invoke<string>('api_translate_gemini_text', { text, model });
      });
    }

    // Attempt migration of legacy localStorage key if present
    await migrateLegacyGeminiKey();

    return isGeminiConfigured();
  } catch (err) {
    console.warn('[GeminiTranslation] Initialization error:', err);
    return false;
  }
}

/**
 * Check whether Gemini API key is configured in the OS secure credential store.
 * Returns true/false without exposing the secret key.
 */
export async function isGeminiConfigured(): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<boolean>('api_is_gemini_configured');
    } catch (e) {
      console.error('[GeminiTranslation] Failed to query credential status:', e);
      return false;
    }
  }
  return mockConfiguredInVault;
}

/**
 * Save Gemini API key to the OS secure credential store.
 * Does NOT persist the key in SQLite, localStorage, or plain config files.
 * Atomically writes, reads back, and verifies using constant-time equality in Rust.
 */
export async function saveGeminiApiKey(key: string | null): Promise<void> {
  const trimmed = key && key.trim() ? key.trim() : null;

  if (!trimmed) {
    await deleteGeminiApiKey();
    return;
  }

  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('api_save_gemini_api_key', { apiKey: trimmed });
  } else {
    mockConfiguredInVault = true;
  }
}

/**
 * Delete Gemini API key from the OS secure credential store.
 * Also disables cloud translation and cancels all pending tasks.
 */
export async function deleteGeminiApiKey(): Promise<void> {
  setCloudTranslationEnabled(false);
  unifiedTranslationScheduler.clear();

  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('api_delete_gemini_api_key');
    } catch (e) {
      console.error('[GeminiTranslation] Failed to delete credential:', e);
    }
  } else {
    mockConfiguredInVault = false;
  }

  if (typeof window !== 'undefined') {
    localStorage.removeItem(LEGACY_API_KEY_STORAGE_KEY);
  }
}

/**
 * Synchronous wrapper for setGeminiApiKey for backward compatibility
 */
export function setGeminiApiKey(key: string | null): void {
  saveGeminiApiKey(key).catch(e => {
    console.error('[GeminiTranslation] Error in setGeminiApiKey:', e);
  });
}

/**
 * Backward compatibility stub:
 * Key is no longer readable by frontend once saved.
 * Returns null.
 */
export function getGeminiApiKey(): string | null {
  return null;
}

/**
 * Translates English transcript text to Simplified Chinese using Google Gemini.
 * 
 * Boundary and Authorization Rules:
 * 1. Zero network requests if isCloudTranslationEnabled() is false.
 * 2. Delegates to UnifiedTranslationScheduler for:
 *    - Concurrency control (default 1)
 *    - 429 rate limiting with scheduler cooldown
 *    - 404 model unavailability caching
 *    - Non-retryable 401/403 handling
 */
export async function translateWithGemini(
  text: string,
  apiKey?: string,
  signal?: AbortSignal
): Promise<string | null> {
  // CRITICAL RULE: Zero requests if cloud translation is not explicitly enabled by the user
  if (!isCloudTranslationEnabled()) {
    return null;
  }

  const trimmedText = text.trim();
  if (!trimmedText) {
    return null;
  }

  return unifiedTranslationScheduler.enqueue({
    id: `trans-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: trimmedText,
    apiKey,
    signal,
  });
}

const MEETING_TRANSLATIONS_KEY_PREFIX = 'meetily_translations_';

/**
 * Save translations for a specific meeting into localStorage
 */
export function saveMeetingTranslations(
  meetingId: string,
  translations: Record<string | number, string>
): void {
  if (typeof window === 'undefined' || !meetingId) return;
  try {
    const existing = getMeetingTranslations(meetingId);
    const merged = { ...existing, ...translations };
    localStorage.setItem(
      `${MEETING_TRANSLATIONS_KEY_PREFIX}${meetingId}`,
      JSON.stringify(merged)
    );
  } catch (e) {
    console.error('[GeminiTranslation] Failed to save meeting translations to localStorage:', e);
  }
}

/**
 * Get translations for a specific meeting from localStorage
 */
export function getMeetingTranslations(meetingId: string): Record<string, string> {
  if (typeof window === 'undefined' || !meetingId) return {};
  try {
    const data = localStorage.getItem(`${MEETING_TRANSLATIONS_KEY_PREFIX}${meetingId}`);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    console.error('[GeminiTranslation] Failed to load meeting translations from localStorage:', e);
    return {};
  }
}
