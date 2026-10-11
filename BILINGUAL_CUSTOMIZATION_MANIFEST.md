# Meetily Bilingual — Customization Manifest
**Date:** 2026-10-11
**Status:** AUDIT ONLY — no source modifications made
**Source of Truth:** Current working-tree state on `feature/live-translation`

This manifest lists every Bilingual customization as a precise source-level record.
Use this as the authoritative checklist when porting Bilingual features to a future upstream base.

---

## Section 1 — New Files (100% Bilingual, no upstream equivalent)

### Rust / Tauri Backend

| File | Size | Purpose |
|------|------|---------|
| `frontend/src-tauri/src/credentials.rs` | ~8 KB | OS Credential Vault management (Groq + Gemini keys) |
| `frontend/src-tauri/src/groq/groq.rs` | 4.9 KB | Groq model listing, 5-minute cache, fallback models |
| `frontend/src-tauri/src/groq/mod.rs` | ~0.1 KB | groq module export |
| `frontend/src-tauri/src/translation_logger.rs` | ~5 KB | Rotating privacy-safe translation diagnostic log |
| `frontend/src-tauri/src/shared_models.rs` | ~6 KB | SharedModels root path + Parakeet/Summary model discovery |
| `frontend/src-tauri/src/summary/summary_engine/local_translation.rs` | 11.7 KB | Local Qwen batch translation via sidecar + full test suite |

### Summary Templates

| File | Size | Purpose |
|------|------|---------|
| `frontend/src-tauri/templates/nait_classroom.json` | ~12 KB | 9-section bilingual EN/ZH NAIT ITSA summary template |

### Frontend Services (TypeScript)

| File | Size | Purpose |
|------|------|---------|
| `frontend/src/services/geminiTranslationService.ts` | ~18 KB | Provider mode, Groq/Gemini auth state, enable/disable, localStorage persistence |
| `frontend/src/services/localTranslationService.ts` | ~12 KB | Local Qwen3 (Mac mini Tailscale) HTTP client, health check, batch |
| `frontend/src/services/translationSessionTracker.ts` | 4.9 KB | Session isolation, versioning, dedup, retry/attempt limiting |
| `frontend/src/services/translationStatsTracker.ts` | ~5 KB | Session RPM counter, health state machine, subscriber pattern |
| `frontend/src/services/translationDiagnosticLogger.ts` | 15.3 KB | 40+ structured log event types, async Rust dispatch, key sanitization |
| `frontend/src/services/unifiedTranslationScheduler.ts` | ~22 KB | Concurrency, batching, retry, rate-limit, provider cascade, queue |
| `frontend/src/services/legacyTranslationMigration.ts` | ~2 KB | One-time migration: Gemini key from localStorage -> OS vault |

### Frontend Components (React/TSX)

| File | Size | Purpose |
|------|------|---------|
| `frontend/src/components/TranslationHealthIndicator.tsx` | ~11 KB | Status badge (9 states), popover with stats, toggle, provider mode |
| `frontend/src/components/GeminiSettings.tsx` | 33.1 KB | Full bilingual settings panel: keys, Local Qwen3, provider mode, diagnostics |

### Tests

| File | Purpose |
|------|---------|
| `frontend/tests/lib/meetily-bilingual-reliability.test.ts` | Bilingual reliability: translation isolation, Smart Follow, SharedModels |

### Local Crates Override

| Path | Purpose |
|------|---------|
| `crates/whisper-rs/` | Local override of whisper-rs crate (pinned version) |

---

## Section 2 — Modified Files (upstream base + Bilingual additions)

### 2A. Rust Backend: api/api.rs

**Lines 1–1389:** Upstream API (meetings, transcripts, model config, profile, meeting details)

**Lines 1390–1878: BILINGUAL ADDITIONS**

| Function / Struct | Lines | Purpose |
|-------------------|-------|---------|
| `api_save_transcript_translation` | 1390-1412 | Save single segment translation to SQLite |
| `api_batch_save_translations` | 1415-1435 | Batch update translations by text (legacy migration) |
| Gemini key functions (4): | 1437-1472 | `api_save_gemini_api_key`, `api_migrate_gemini_api_key`, `api_is_gemini_configured`, `api_delete_gemini_api_key` |
| Groq key functions (3): | 1476-1490 | `api_save_groq_api_key`, `api_is_groq_configured`, `api_delete_groq_api_key` |
| `api_translate_groq_text` | 1493-1573 | Real-time translation via Groq HTTP API |
| `api_translate_gemini_text` | 1574-1660 | Real-time translation via Gemini HTTP API |
| `LocalQwenHealthResponse` (struct) | 1661-1667 | Health response from Local Qwen3 |
| `LocalQwenBatchInputSegment` (struct) | 1669-1673 | Input segment type |
| `LocalQwenBatchOutputSegment` (struct) | 1675-1679 | Output segment type |
| `LocalQwenBatchResponse` (struct) | 1681-1685 | Batch result type |
| `api_check_local_qwen_health` | 1688-1763 | Health check Local Qwen3 via Tailscale |
| `api_translate_local_qwen_batch` | 1766-1875 | Batch translate via Local Qwen3 (Mac mini) |

**Struct field additions to upstream types:**

| Struct | Added Field | Type | Purpose |
|--------|-------------|------|---------|
| `TranscriptSegment` (line 182-195) | `translation` | `Option<String>` | Per-segment Chinese translation |
| `MeetingTranscript` (line 130-153) | `translation` | `Option<String>` | Per-transcript Chinese translation for meeting view |

---

### 2B. Rust Backend: lib.rs

**Command registrations added by Bilingual (lines 762-777, 809-810):**

```
api::api_save_transcript_translation,    // line 762
api::api_batch_save_translations,        // line 763
api::api_save_gemini_api_key,           // line 764
api::api_migrate_gemini_api_key,        // line 765
api::api_is_gemini_configured,          // line 766
api::api_delete_gemini_api_key,         // line 767
api::api_translate_gemini_text,         // line 768
api::api_save_groq_api_key,             // line 769
api::api_is_groq_configured,            // line 770
api::api_delete_groq_api_key,           // line 771
api::api_translate_groq_text,           // line 772
api::api_check_local_qwen_health,       // line 773
api::api_translate_local_qwen_batch,    // line 774
translation_logger::api_write_translation_log_line,     // line 775
translation_logger::api_get_translation_log_path,       // line 776
translation_logger::api_open_translation_log_folder,    // line 777
summary::summary_engine::api_translate_local_batch,     // line 809
summary::summary_engine::api_is_local_qwen_available,   // line 810
```

**Module declarations added (lines 43-57):**
```
pub mod credentials;       // line 43
pub mod groq;              // line 50
pub mod shared_models;     // line 53
pub mod translation_logger; // line 57
```

---

### 2C. Rust Backend: database/repositories/transcript.rs

**Added column:** `translation TEXT` in transcripts table

**Added functions:**
- `update_translation(pool, transcript_id, translation)` — single-segment translation write
- `batch_update_translations_by_text(pool, meeting_id, translations)` — batch write by text matching

**Modified function:** `get_transcripts_for_meeting()` — now includes `translation` column in SELECT

---

### 2D. Rust Backend: parakeet_engine/parakeet_engine.rs

**Line 283 (Bilingual modification):**
```rust
// Before (upstream): some default path or error
// After (Bilingual):
crate::shared_models::get_shared_parakeet_models_dir()
```
When `new_with_models_dir(None)` is called (production builds),
falls back to SharedModels canonical location instead of app bundle path.

---

### 2E. Rust Backend: summary/summary_engine/commands.rs

**Lines 53, 361:** Uses `crate::shared_models::get_shared_summary_models_dir()` for model discovery.

**Model recommendations (Bilingual-specific):**
- `qwen3.5:4b` — primary (>=14GB RAM)
- `qwen3.5:2b` — fallback (<14GB RAM)
- (upstream had: `gemma3:4b` / `gemma3:1b`)

---

### 2F. Frontend: TranscriptContext.tsx

**Bilingual additions (85+ lines):**

Imports added:
- `unifiedTranslationScheduler` — main scheduler singleton
- `translationSessionTracker` — `TranslationSessionTracker` class
- `translationStatsTracker` — stats tracker
- `TranslationLogEvent`, `translationDiagnosticLogger` — logging

State added:
- `translationMap: Record<string, string>` — sequenceId -> Chinese translation
- `translationMapRef` — ref mirror for immediate access without stale closure
- `trackerRef` — `TranslationSessionTracker` instance

Functions added:
- `requestTranslation(sequenceId, text, isPartial?)` — fire-and-forget dispatch
- `requestManualTranslation(sequenceId, text)` — user-triggered catch-up translation
- `waitForInFlightTranslations(maxWaitMs?)` — drain queue on stop
- `setTranslationForSequence(sequenceId, translation)` — update translationMap + persist to SQLite

Context value extended:
- Exports `translationMap`, `requestManualTranslation`, `setTranslationForSequence`

Modified lifecycle:
- `addTranscript()` — now calls `requestTranslation(sequenceId, text)` after state update
- `markMeetingAsSaved()` — now calls `waitForInFlightTranslations()` before SQLite save
- `useEffect` for `recording-started` — resets translation session via `tracker.resetSession()`

---

### 2G. Frontend: VirtualizedTranscriptView.tsx

**Bilingual display changes (57+ lines):**

- Segment rendering: two lines — English (normal weight) + Chinese (cyan-300 dark mode, italic)
- `onManualTranslate?: (sequenceId: string, text: string) => void` prop added
- Manual translate button: `Languages` icon, hover-visible, calls `onManualTranslate`
- `disableAutoScroll={true}` — scroll ownership delegated to TranscriptPanel
- Translation-pending state: spinner icon when translation in-flight for segment
- `translationMap` prop threaded through for display

---

### 2H. Frontend: TranscriptPanel.tsx

**Bilingual toolbar + Smart Follow additions (310+ lines):**

Toolbar (sticky header):
- Left slot: `TranslationHealthIndicator` component
- Right slot: `recordingControls` prop (injected by page.tsx)
- Dark theme: `bg-zinc-900/80 backdrop-blur-sm border-zinc-800`

Smart Follow state/refs:
- `followLive`, `followLiveRef`, `isProgrammaticScrollRef`
- `idleTimerRef`, `pausedAtCountRef`, `newSegmentsCount`

Smart Follow behavior (see Phase 6 in Architecture Audit for full details)

Down-arrow Live button:
- Visible when `!followLive && transcripts.length > 0`
- Shows badge: new segment count
- Clicks -> `returnToLive()`

Props added:
- `recordingControls?: React.ReactNode` — injected recording button slot

---

### 2I. Frontend: page.tsx

**Bilingual additions (55+ lines):**

- `TranscriptRecovery` dialog (recovery from IndexedDB crashes)
- Startup recovery checks: `deleteOldMeetings(7)`, `deleteSavedMeetings(24)`, `checkForRecoverableTranscripts()`
- Recovery dialog session flag (`recovery_dialog_shown` in sessionStorage)
- `handleRecovery()` — toast notification + auto-navigate to recovered meeting
- `RecordingControls` injected via `recordingControls` prop into `TranscriptPanel` (not rendered standalone)

---

### 2J. Frontend: GeminiSettings.tsx

**Entire file is Bilingual** (742 lines).
Manages:
- Cloud Translation enable/disable toggle
- Provider mode: Cloud (Groq+Gemini) vs Local Qwen3
- Groq API key: save, verify, delete (via Tauri OS vault)
- Gemini API key: save, verify, delete, legacy migration (via Tauri OS vault)
- Local Qwen3 endpoint: configure, health test, latency display
- Diagnostics: log path, open log folder, session stats display
- Stats: total requests, Groq/Gemini/Local counts, success rate, batch count

---

### 2K. Frontend: geminiTranslationService.ts

**Bilingual additions (+12 lines):**

Functions added:
- `getUserTranslationMode()` -> `UserTranslationMode` ('cloud' | 'local')
- `setUserTranslationMode(mode)` — persists to localStorage
- `getLocalQwenEndpoint()` -> string
- `setLocalQwenEndpoint(url)` — persists to localStorage
- `checkLocalQwenHealth(endpoint?)` — calls `api_check_local_qwen_health` Tauri command
- `DEFAULT_LOCAL_QWEN_ENDPOINT` constant

Type added:
- `UserTranslationMode = 'cloud' | 'local'`

---

### 2L. Frontend: tauri.conf.json

**Bilingual changes:**

CSP / allowlist additions:
- `https://api.groq.com` — Groq translation API
- `https://generativelanguage.googleapis.com` — Gemini translation API
- Tailscale subnet (for Local Qwen3 Mac mini)

App identifier may differ from upstream (Bilingual-specific bundle ID).

---

## Section 3 — Translation System Constant Reference

### Provider Configuration

| Provider | Base URL | Models Tried In Order |
|----------|----------|----------------------|
| Groq | `https://api.groq.com/openai/v1/chat/completions` | `openai/gpt-oss-20b` -> `openai/gpt-oss-120b` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | `gemini-3.5-flash-lite` -> `gemini-3.6-flash` |
| Local Qwen3 | `http://jeffsmac-mini.taile61984.ts.net:8080` (configurable) | `qwen3:1.7b` (or discovered model) |
| Built-in Qwen3.5 | Via sidecar | `qwen3.5:4b` (>=14GB RAM) or `qwen3.5:2b` |

### Scheduler Timing

| Parameter | Value | Location |
|-----------|-------|----------|
| MAX_BATCH_WAIT_MS | 6000 ms | unifiedTranslationScheduler.ts |
| MAX_BATCH_SEGMENTS | 3 | unifiedTranslationScheduler.ts |
| REQUEST_TIMEOUT_MS | 8000 ms | unifiedTranslationScheduler.ts |
| MIN_INTERVAL_MS | 500 ms | unifiedTranslationScheduler.ts |
| MAX_CONCURRENCY | 1 | unifiedTranslationScheduler.ts |
| SHORT_SEGMENT_WORDS | 20 | unifiedTranslationScheduler.ts |
| IDLE_TIMER_MS | 10000 ms | TranscriptPanel.tsx |
| SCROLL_BOTTOM_THRESHOLD | 80 px | TranscriptPanel.tsx |
| PROGRAMMATIC_SCROLL_GUARD | 400 ms | TranscriptPanel.tsx |

### SharedModels Paths (Windows)

| Path | Contents |
|------|----------|
| `%LOCALAPPDATA%\Meetily Bilingual\SharedModels\` | Root |
| `...\SharedModels\parakeet\parakeet-tdt-0.6b-v3-int8\` | 4 ONNX artifacts |
| `...\SharedModels\summary\` | GGUF models |

### Validated Parakeet Artifacts

| File | Exact Size |
|------|-----------|
| `encoder-model.int8.onnx` | 652 MB (exact) |
| `decoder_joint-model.int8.onnx` | 18 MB (exact) |
| `nemo128.onnx` | 139 KB (exact) |
| `vocab.txt` | 93 KB (exact) |

### OS Credential Vault Keys

| Key Name | Provider | Used By |
|----------|----------|---------|
| `meetily_gemini_api_key` | Google Gemini | api_translate_gemini_text |
| `meetily_groq_api_key` | Groq | api_translate_groq_text |

---

## Section 4 — Translation Log Event Types (reference)

All events are sanitized (API keys and Bearer tokens redacted before writing).

| Stage | Level | When |
|-------|-------|------|
| eligible | INFO | Segment evaluated for translation |
| skipped | DEBUG | Segment skipped (partial, duplicate, empty) |
| enqueue | INFO | Segment added to scheduler queue |
| dequeue | INFO | Segment dequeued for processing |
| provider_select | INFO | Provider chosen (groq/gemini/local) |
| credential | INFO/WARN/ERROR | Key read from vault |
| request | DEBUG | HTTP request initiated |
| success | INFO | Translation received |
| http_error | WARN/ERROR | HTTP non-2xx response |
| fallback | WARN | Provider fallback triggered |
| all_providers_failed | ERROR | All providers failed |
| tracker_commit | DEBUG | Result committed to session tracker |
| map_update | DEBUG | translationMap updated |
| ui_rendered | DEBUG | UI rendered with translation |
| batch_flush | INFO | Batch sent to Groq |
| local_batch_complete | INFO | Local Qwen batch completed |
| provider_switch_success | INFO | User switched provider mode |

---

## Section 5 — NAIT Classroom Template Reference

File: `frontend/src-tauri/templates/nait_classroom.json`

Name: "NAIT Classroom Summary"
Description: "Action-oriented bilingual class review document for NAIT ITSA program students"

| # | Section Title | Format | Key Rules |
|---|--------------|--------|-----------|
| 1 | Today's Main Topics / 今日主要内容 | paragraph | EN first + ZH below; no basic IT explanations |
| 2 | MUST-DO / Instructor Requirements / 必须完成与老师要求 | list | Checkboxes `- [ ] EN\n  ZH`; highest priority |
| 3 | Lab / Assignment Details / Lab与作业详情 | paragraph | Preserve all exact technical values |
| 4 | Deadlines / Important Dates / 截止日期与重要时间 | list | Never infer; state exact dates only |
| 5 | Exam / Quiz / Practical / 考试与测验信息 | paragraph | STRICTLY confirmed only; no inference |
| 6 | Important Technical Notes / 重要技术知识点 | paragraph | Bilingual subheadings; technical strings unedited |
| 7 | Instructor Warnings / Common Traps / 老师提醒与常见陷阱 | list | Direct instructor speech only |
| 8 | Useful English / 实用课堂英语 | list | EN technical terms + ZH explanation |
| 9 | Quick Review / 快速复习 | list | Key technical points; 5-10 items max |

Critical template rules:
- Commands, IP addresses, filenames, hostnames, subnets: NEVER translate, NEVER alter
- Student commentary: NEVER presented as instructor information
- Deadlines: NEVER inferred from context
- Exam content: ONLY when instructor explicitly links to assessment

---

## Section 6 — Smart Follow Feature Contract

These behaviors are the user-observable contract. Any refactor MUST preserve them.

1. When user scrolls up: Follow Live turns OFF immediately
2. When user returns to bottom (within 80px): Follow Live turns ON automatically
3. When Follow Live is OFF: idle 10 seconds -> automatic return to live
4. When Follow Live is OFF: active text selection -> timer reschedules (no forced scroll)
5. When Follow Live is OFF: any mouse/touch/scroll activity resets idle timer
6. When Follow Live is OFF: down-arrow button shows with new segment count badge
7. Down-arrow button click: smooth scroll to bottom, Follow Live ON
8. All scroll-to-bottom is smooth (behavior: 'smooth')
9. Programmatic scrolls do NOT trigger "user scrolled up" logic (guard: 400ms)

---

## Section 7 — Isolation Contract

These properties MUST be preserved in all future versions:

1. Translation failure NEVER stops, pauses, or corrupts English recording
2. Translation failure NEVER stops, pauses, or corrupts English transcription
3. Translation failure NEVER prevents meeting from being saved to SQLite
4. requestTranslation() is ALWAYS fire-and-forget (void, never awaited in transcript pipeline)
5. All translation HTTP calls have maximum 8-second timeout
6. Rate-limit cooldown NEVER blocks transcript pipeline
7. OS Credential Vault keys NEVER stored in SQLite, localStorage, or log files
8. Log files NEVER contain API keys, Bearer tokens, English text, or Chinese translation text
