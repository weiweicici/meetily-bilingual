/**
 * Local Translation Service (Local Qwen3 via Mac mini HTTP API)
 * Calls Tailscale private service: http://jeffsmac-mini.taile61984.ts.net:8080
 * Strictly private network execution — zero public internet exposure.
 */

import { invoke } from '@tauri-apps/api/core';

export const DEFAULT_LOCAL_QWEN_ENDPOINT = 'http://jeffsmac-mini.taile61984.ts.net:8080';
export const LOCAL_QWEN_ENDPOINT_STORAGE_KEY = 'meetily_local_qwen_endpoint';

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

export interface LocalQwenHealthStatus {
  available: boolean;
  model?: string;
  latencyMs?: number;
  error?: string;
}

/**
 * Standard technical classroom terminology prompt to guarantee accurate terminology mapping.
 */
export const TECHNICAL_TERMINOLOGY_CONTEXT =
  'Technical classroom terminology: default gateway -> 默认网关, read-only access -> 只读访问权限, ' +
  'packet -> 数据包, domain controller -> 域控制器, static route -> 静态路由, subnet mask -> 子网掩码, ' +
  'shared folder -> 共享文件夹. Translate into concise, natural Simplified Chinese.';

/**
 * Get configured Local Qwen3 endpoint.
 */
export function getLocalQwenEndpoint(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_LOCAL_QWEN_ENDPOINT;
  try {
    const saved = localStorage.getItem(LOCAL_QWEN_ENDPOINT_STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '');
  } catch {
    // Fallback to default
  }
  return DEFAULT_LOCAL_QWEN_ENDPOINT;
}

/**
 * Set and persist Local Qwen3 endpoint.
 */
export function setLocalQwenEndpoint(endpoint: string): void {
  if (typeof localStorage === 'undefined') return;
  const clean = endpoint.trim().replace(/\/+$/, '');
  localStorage.setItem(LOCAL_QWEN_ENDPOINT_STORAGE_KEY, clean || DEFAULT_LOCAL_QWEN_ENDPOINT);
}

let mockLocalQwenAvailable = true;

/**
 * Set mock availability for unit tests.
 */
export function setMockLocalQwenAvailable(available: boolean): void {
  mockLocalQwenAvailable = available;
}

function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ ||
    (window as unknown as { __TAURI__?: unknown }).__TAURI__
  );
}

/**
 * Check if the Local Qwen3 service is reachable via GET /health.
 */
export async function checkLocalQwenHealth(
  customEndpoint?: string,
  customFetchFn?: typeof fetch
): Promise<LocalQwenHealthStatus> {
  const endpoint = (customEndpoint || getLocalQwenEndpoint()).replace(/\/+$/, '');
  const startTime = Date.now();

  // If in Tauri environment and no customFetchFn specified, use native Rust command for zero CSP/CORS friction
  if (isTauri() && !customFetchFn) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const resp = await invoke<{
        available: boolean;
        model?: string;
        latency_ms?: number;
        error?: string;
      }>('api_check_local_qwen_health', { endpoint });

      return {
        available: resp.available,
        model: resp.model || 'qwen3:1.7b',
        latencyMs: resp.latency_ms ?? (Date.now() - startTime),
        error: resp.error,
      };
    } catch (e) {
      console.warn('[LocalQwen] Tauri native health check fallback to fetch:', e);
    }
  }

  const url = `${endpoint}/health`;
  const fetcher = customFetchFn || (typeof fetch !== 'undefined' ? fetch : undefined);

  if (!fetcher) {
    return {
      available: false,
      latencyMs: 0,
      error: 'Fetch API not available',
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const resp = await fetcher(url, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const latencyMs = Date.now() - startTime;

    if (!resp.ok) {
      return {
        available: false,
        latencyMs,
        error: `HTTP ${resp.status}`,
      };
    }

    const data = await resp.json();
    return {
      available: data?.status === 'ok',
      model: data?.model || 'qwen3:1.7b',
      latencyMs,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    return {
      available: false,
      latencyMs,
      error: err instanceof Error ? err.message : 'Unreachable',
    };
  }
}

/**
 * Check if the Local Qwen model is available (used by mode switcher).
 */
export async function isLocalQwenModelAvailable(): Promise<boolean> {
  if (typeof window !== 'undefined') {
    const health = await checkLocalQwenHealth();
    return health.available;
  }
  return mockLocalQwenAvailable;
}

/**
 * Translate a single English text segment via the Local Qwen3 service (POST /translate).
 */
export async function apiTranslateLocalQwen3(
  text: string,
  context?: string,
  signal?: AbortSignal
): Promise<{ translation: string; model: string; latency_ms: number } | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const endpoint = getLocalQwenEndpoint();
  const url = `${endpoint}/translate`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: trimmed,
        context: context || TECHNICAL_TERMINOLOGY_CONTEXT,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);

    if (!resp.ok) {
      console.warn(`[LocalQwen] Translation failed: HTTP ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    if (data && typeof data.translation === 'string' && data.translation.trim()) {
      return {
        translation: data.translation.trim(),
        model: data.model || 'qwen3:1.7b',
        latency_ms: data.latency_ms || 0,
      };
    }
    return null;
  } catch (err) {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
    console.warn('[LocalQwen] Translation request error:', err);
    return null;
  }
}

/**
 * Formats multiple segments into a structured numbered text block for prompt batching.
 */
export function formatSegmentsForPrompt(segments: LocalTranslationInputSegment[]): string {
  return segments.map((seg, idx) => `[${idx + 1}] ${seg.text}`).join('\n');
}

/**
 * Parses numbered responses like '[1] 译文' or '1. 译文' into a Map of relativeIndex -> translation.
 */
export function parseNumberedResponse(text: string, expectedIndices: number[]): Map<number, string> {
  const result = new Map<number, string>();
  if (!text || !text.trim()) return result;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const regex = /^(?:\[(\d+)\]|(\d+)[\.\:\-\s]+)(.*)$/;

  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      const idx = parseInt(match[1] || match[2], 10);
      const content = (match[3] || '').trim();
      if (idx && content) {
        result.set(idx, content);
      }
    }
  }

  // If no numbered lines found and only 1 segment expected, use whole text
  if (result.size === 0 && expectedIndices.length === 1 && text.trim()) {
    result.set(expectedIndices[0], text.trim());
  }

  return result;
}

export interface TranslateWithLocalQwenOptions {
  endpoint?: string;
  context?: string;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}

/**
 * Flexible wrapper for local Qwen3 translation supporting custom endpoint and fetchFn for test mocking.
 */
export async function translateWithLocalQwen(
  segments: LocalTranslationInputSegment[],
  options?: TranslateWithLocalQwenOptions
): Promise<LocalTranslationBatchResult> {
  if (segments.length === 0) {
    return { successful_segments: [], failed_ids: [], raw_response: '[]' };
  }

  const endpoint = (options?.endpoint || getLocalQwenEndpoint()).replace(/\/+$/, '');

  // If in Tauri environment and no options.fetchFn provided, invoke native Rust command
  if (isTauri() && !options?.fetchFn) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const resp = await invoke<LocalTranslationBatchResult>('api_translate_local_qwen_batch', {
        endpoint,
        segments,
        context: options?.context || TECHNICAL_TERMINOLOGY_CONTEXT,
      });
      return resp;
    } catch (e) {
      console.warn('[LocalQwen] Tauri native translation fallback to fetch:', e);
    }
  }

  const url = `${endpoint}/translate`;
  const fetcher = options?.fetchFn || (typeof fetch !== 'undefined' ? fetch : undefined);

  if (!fetcher) {
    return {
      successful_segments: [],
      failed_ids: segments.map(s => s.id),
      raw_response: '',
    };
  }

  try {
    const promptText = formatSegmentsForPrompt(segments);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const onAbort = () => controller.abort();
    options?.signal?.addEventListener('abort', onAbort);

    const resp = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: promptText,
        context: options?.context || TECHNICAL_TERMINOLOGY_CONTEXT,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    options?.signal?.removeEventListener('abort', onAbort);

    if (!resp.ok) {
      return {
        successful_segments: [],
        failed_ids: segments.map(s => s.id),
        raw_response: `HTTP ${resp.status}`,
      };
    }

    const data = await resp.json();
    const raw = typeof data.translation === 'string' ? data.translation : '';
    const indices = segments.map((_, i) => i + 1);
    const parsed = parseNumberedResponse(raw, indices);

    const successful_segments: LocalTranslationOutputSegment[] = [];
    const failed_ids: number[] = [];

    segments.forEach((seg, idx) => {
      const trans = parsed.get(idx + 1);
      if (trans && trans.trim()) {
        successful_segments.push({ id: seg.id, translation: trans.trim() });
      } else {
        failed_ids.push(seg.id);
      }
    });

    return {
      successful_segments,
      failed_ids,
      raw_response: raw,
    };
  } catch (err) {
    return {
      successful_segments: [],
      failed_ids: segments.map(s => s.id),
      raw_response: '',
    };
  }
}

export const apiTranslateLocalBatch = translateWithLocalQwen;

