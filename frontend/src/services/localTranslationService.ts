/**
 * Local Translation Service (Qwen 3.5 4B via Tauri Rust sidecar)
 * Calls Rust `api_translate_local_batch` command.
 * Strictly local execution — zero network traffic.
 */

import { invoke } from '@tauri-apps/api/core';

export interface LocalTranslationInputSegment {
  id: number;
  text: string;
}

export interface LocalTranslationOutputSegment {
  id: number;
  translation: string;
}

export interface LocalTranslationBatchResult {
  successful_segments: LocalTranslationOutputSegment[];
  failed_ids: number[];
  raw_response: string;
}

/**
 * Call Rust Tauri backend to translate a batch of 1-3 transcript segments using Local Qwen 3.5 4B.
 */
export async function apiTranslateLocalBatch(
  segments: LocalTranslationInputSegment[]
): Promise<LocalTranslationBatchResult> {
  if (segments.length === 0) {
    return {
      successful_segments: [],
      failed_ids: [],
      raw_response: '[]',
    };
  }

  return await invoke<LocalTranslationBatchResult>('api_translate_local_batch', {
    segments,
  });
}

let mockLocalQwenAvailable = true;

/**
 * Set mock availability for unit tests.
 */
export function setMockLocalQwenAvailable(available: boolean): void {
  mockLocalQwenAvailable = available;
}

/**
 * Check if the Local Qwen 3.5 4B model is available locally in SharedModels.
 */
export async function isLocalQwenModelAvailable(): Promise<boolean> {
  if (
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ ||
        (window as unknown as { __TAURI__?: unknown }).__TAURI__
    )
  ) {
    try {
      return await invoke<boolean>('api_is_local_qwen_available');
    } catch (e) {
      console.error('[Translation] Failed to query Local Qwen model availability:', e);
      return false;
    }
  }
  return mockLocalQwenAvailable;
}
