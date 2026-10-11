# Meetily Bilingual — Architecture, Customization & Upstream Upgrade Audit
**Date:** 2026-10-11
**Auditor:** Antigravity AI (read-only inspection — no source changes made)

---

## Phase 1 — Git Baseline

### Branch & HEAD
| Field | Value |
|-------|-------|
| Active branch | `feature/live-translation` |
| HEAD commit | `4514b5e` |
| HEAD message | Meetily Bilingual Beta 4.1: bilingual NAIT summary and dark theme polish |
| Tag at HEAD | `v0.4.1-bilingual-beta.4.1` |

### Remotes
| Name | URL |
|------|-----|
| `origin` | https://github.com/Zackriya-Solutions/meetily.git (upstream) |
| `publish` | https://github.com/weiweicici/meetily-bilingual.git (Bilingual public repo) |

### Branch Tracking
- `feature/live-translation` tracks `publish/main`, ahead by 2 commits.
- `main` tracks `origin/main` at `a2cb62e` (upstream v0.4.1).

### Bilingual Tags (newest first)
| Tag | Notes |
|-----|-------|
| `v0.4.1-bilingual-beta.4.1` | HEAD — NAIT bilingual summary + dark theme |
| `v0.4.1-bilingual-beta.4` | Stable hybrid classroom: local Parakeet + Groq |
| `v0.4.1-bilingual-beta.3` | Cloud translation, 6s batching, dark theme |
| `v0.4.1` | Upstream release base (fork point) |

### Commit Graph Summary
```
4514b5e  Meetily Bilingual Beta 4.1 (HEAD, v0.4.1-bilingual-beta.4.1)
8302a5e  Meetily Bilingual: stable hybrid classroom (v0.4.1-bilingual-beta.4)
77be43e  Meetily Bilingual: cloud translation 6s batching (v0.4.1-bilingual-beta.3)
ddd0864  fix: route translation through secure backend credentials
4a38fa5  feat: add secure Gemini bilingual translation
a2cb62e  (origin/main, main, tag: v0.4.1) Release v0.4.1  <- FORK BASE
```

5 Bilingual commits above fork point `a2cb62e` (v0.4.1).

### Uncommitted Working Tree Changes (18 files modified, 2 untracked)

| File | Delta | Significance |
|------|-------|-------------|
| `Cargo.lock` / `Cargo.toml` / `frontend/src-tauri/Cargo.toml` | varies | Dependency changes (new bilingual crates) |
| `frontend/src-tauri/src/api/api.rs` | +217 | Bilingual translation API commands |
| `frontend/src-tauri/src/lib.rs` | +29 | New command registrations |
| `frontend/src-tauri/src/whisper_engine/whisper_engine.rs` | +31 | Model path changes |
| `frontend/src-tauri/tauri.conf.json` | +10 | App config/CSP changes |
| `frontend/src/app/_components/TranscriptPanel.tsx` | +310 | Smart Follow + toolbar redesign |
| `frontend/src/app/page.tsx` | +55 | Recovery dialog, toolbar injection |
| `frontend/src/components/GeminiSettings.tsx` | +192 | Full bilingual settings panel |
| `frontend/src/components/RecordingControls.tsx` | +46 | Toolbar position change |
| `frontend/src/components/TranslationHealthIndicator.tsx` | +165 | Health indicator widget |
| `frontend/src/components/VirtualizedTranscriptView.tsx` | +57 | Manual translate, bilingual display |
| `frontend/src/contexts/TranscriptContext.tsx` | +85 | Translation dispatch integration |
| `frontend/src/services/geminiTranslationService.ts` | +12 | Provider mode switching |
| `frontend/src/services/localTranslationService.ts` | +358 | Local Qwen3 service |
| `frontend/src/services/translationStatsTracker.ts` | +51 | Stats and health tracking |
| `frontend/src/services/unifiedTranslationScheduler.ts` | +44 | Scheduler enhancements |

Untracked (new, not yet committed):
- `crates/whisper-rs/` — local whisper-rs crate override
- `frontend/tests/lib/meetily-bilingual-reliability.test.ts` — Bilingual reliability tests

> WARNING: These working-tree changes are the current production state. They are NOT lost.
> RECOMMENDATION: Commit with tag `v0.4.1-bilingual-wip-2026-10-11` before any upstream integration work.

---

## Phase 2 — Architecture Map

### A. Audio / Recording

Entry point: `lib.rs` -> `start_recording` / `start_recording_with_devices_and_meeting`

Key files:
- `audio/recording_commands.rs` — core lifecycle (70 KB)
- `audio/recording_manager.rs` — session coordination
- `audio/recording_saver.rs` + `audio/incremental_saver.rs` — audio save + checkpoint WAL
- `audio/pipeline.rs` — mic+system mixing (RMS ducking), VAD gating
- `audio/devices/` — platform-specific device discovery

Lifecycle:
1. Frontend invokes Tauri command
2. `recording_commands.rs` starts mic + system audio streams
3. `pipeline.rs` mixes audio and applies VAD
4. `incremental_saver.rs` writes checkpoints (crash recovery)
5. `recording_saver.rs` writes final WAV on stop

Events: `recording-started`, `recording-stopped`

### B. VAD (Voice Activity Detection)

File: `audio/vad.rs` (34 KB)
- Silero VAD via ONNX runtime
- Gates Parakeet transcription — only speech segments sent
- Critical: VAD errors must not propagate to recording or transcript pipeline

### C. Local English ASR — Parakeet

Files:
- `parakeet_engine/parakeet_engine.rs` (79 KB) — engine core
- `parakeet_engine/model.rs` — ONNX model loading
- `parakeet_engine/commands.rs` — Tauri commands

Model path (Bilingual-specific):
`ParakeetEngine::new_with_models_dir(None)` -> `shared_models::get_shared_parakeet_models_dir()`
-> `%LOCALAPPDATA%\Meetily Bilingual\SharedModels\parakeet\`

Validated artifacts:
- `encoder-model.int8.onnx` (652 MB exact)
- `decoder_joint-model.int8.onnx` (18 MB exact)
- `nemo128.onnx` (139 KB exact)
- `vocab.txt` (93 KB exact)

Emits: `transcript-update` events with `sequence_id`, `text`, `confidence`, `audio_start_time`, `audio_end_time`

### D. Transcript Lifecycle

Persistence layers:
1. IndexedDB (browser) — `indexedDBService.ts` — `MeetilyRecoveryDB` — crash recovery buffer
2. SQLite (Rust) — `database/` — final persistent storage via `api_save_transcript`
3. translationMap — in-memory `Record<sequenceId, chineseTranslation>` in TranscriptContext

Flow:
1. `recording-started` -> IndexedDB meeting initialized
2. Each `transcript-update` -> `addTranscript()` -> IndexedDB write + `requestTranslation()`
3. Stop -> `markMeetingAsSaved()` -> SQLite save
4. Crash -> recovery dialog on next startup via `checkForRecoverableTranscripts()`

Key context: `TranscriptContext.tsx`
- `translationMap` / `translationMapRef` — dual state+ref for immediate access
- `requestTranslation()` — non-blocking fire-and-forget
- `requestManualTranslation()` — user-initiated catch-up
- `waitForInFlightTranslations()` — drain in-flight on stop

### E. Real-Time Translation

Primary: Groq — `openai/gpt-oss-20b` -> `openai/gpt-oss-120b`
Fallback: Google Gemini — `gemini-3.5-flash-lite` -> `gemini-3.6-flash`
Local: Qwen3 via Mac mini Tailscale — `http://jeffsmac-mini.taile61984.ts.net:8080`

Key files:
| File | Purpose |
|------|---------|
| `unifiedTranslationScheduler.ts` | Central dispatch, concurrency, batching, retry, rate-limit |
| `geminiTranslationService.ts` | Provider mode, auth state, enable/disable |
| `localTranslationService.ts` | Local Qwen3 endpoint management |
| `translationSessionTracker.ts` | Session isolation, versioning, deduplication |
| `translationStatsTracker.ts` | Health status, RPM, counters |
| `translationDiagnosticLogger.ts` | Privacy-preserving logs to Rust backend |

Scheduler parameters:
- Max concurrency: 1
- Min interval: 500ms
- Batch window: 6000ms (MAX_BATCH_WAIT_MS) — classroom cadence
- Max batch segments: 3
- Request timeout: 8000ms
- Short segment threshold: 20 words

Rate-limit / auth failure handling:
- 429 -> cooldown backoff, promote to next model within provider
- All Groq models disabled -> fallback to Gemini
- All Gemini models disabled -> `all_failed` health state
- 401/403 -> session-level provider disable (NEVER kills recording)

### F. Catch-up / Manual Translation

Entry: `requestManualTranslation(sequenceId, text)` in `TranscriptContext.tsx`
- Calls `unifiedTranslationScheduler.enqueue()` directly
- Per-segment retry button in `VirtualizedTranscriptView.tsx` (hover-visible Languages icon)

### G. UI Integration

Main page: `frontend/src/app/page.tsx`

Key Bilingual layout change:
`RecordingControls` injected as `recordingControls` prop into `TranscriptPanel`,
rendered in the STICKY TOP TOOLBAR (not a separate panel).

TranscriptPanel.tsx (Bilingual):
- Sticky header: TranslationHealthIndicator (left) + recording controls (right)
- Smart Follow logic (Phase 6)
- Down arrow "Live" button (bottom-right when Follow Live is OFF)

VirtualizedTranscriptView.tsx (Bilingual):
- Dual-line: English (gray/zinc) + Chinese translation (cyan-300 dark mode)
- Per-segment manual translate button (hover-visible)

TranslationHealthIndicator.tsx:
States: idle, groq_success, groq_inflight, groq_429, gemini_fallback,
        local_qwen_success, local_qwen_inflight, local_qwen_error, all_failed
Popover: session stats, enable/disable toggle, provider mode, copy stats, open log folder

GeminiSettings.tsx:
Full settings: Groq key, Gemini key, Local Qwen endpoint, provider mode, diagnostics

### H. Summary

Templates: `frontend/src-tauri/templates/`
| Template | Notes |
|---------|-------|
| `nait_classroom.json` | BILINGUAL-SPECIFIC — 9-section EN/ZH summary for NAIT ITSA |
| `standard_meeting.json` | Upstream |
| `daily_standup.json` | Upstream |
| `project_sync.json` | Upstream |
| `retrospective.json` | Upstream |
| `sales_marketing_client_call.json` | Upstream |
| `psyciatric_session.json` | Upstream |

NAIT template sections:
1. Today's Main Topics / today-topics
2. MUST-DO / Instructor Requirements (checkboxes)
3. Lab / Assignment Details
4. Deadlines / Important Dates
5. Exam / Quiz / Practical (strict confirmation only)
6. Important Technical Notes
7. Instructor Warnings / Common Traps
8. Useful English Vocabulary
9. Quick Review

Summary engine:
- `summary/summary_engine/` — built-in AI sidecar (llama.cpp)
- `summary/summary_engine/local_translation.rs` — Bilingual local Qwen translation via sidecar
- Model discovery: `shared_models::find_valid_shared_summary_model()`

### I. SharedModels

File: `frontend/src-tauri/src/shared_models.rs`
Purpose: Canonical model storage shared across dev/prod build variants.

Windows: `%LOCALAPPDATA%\Meetily Bilingual\SharedModels\`
- `SharedModels/parakeet/parakeet-tdt-0.6b-v3-int8/` — 4 ONNX artifacts (byte-exact validation)
- `SharedModels/summary/` — GGUF models (Qwen3.5-4B, Qwen3.5-2B, Gemma3-4b, Gemma3-1b)

Key functions:
- `get_shared_models_root()` — platform path
- `get_shared_parakeet_models_dir()` — parakeet path
- `get_shared_summary_models_dir()` — summary/translation path
- `validate_shared_parakeet_model()` — exact byte size verification
- `find_valid_shared_summary_model()` — priority-ordered GGUF discovery
- `check_shared_models_readiness()` — both-engines-ready check

### J. Credentials / Settings

Rust: `credentials.rs` (CredentialManager)
Storage: OS keyring (Windows Credential Manager / macOS Keychain / Linux Secret Service)
Keys: `gemini_api_key`, `groq_api_key`

Security features:
- Constant-time comparison (prevent timing attacks)
- CREDENTIAL_MUTEX serializes all operations
- Write-verify-rollback pattern
- Never stored in SQLite or localStorage

Frontend: `GeminiSettings.tsx` calls credential Tauri commands.

### K. Diagnostics / Statistics

Frontend:
- `translationStatsTracker.ts` — in-memory session counters, RPM, health state, subscriber pattern
- `translationDiagnosticLogger.ts` — structured log events dispatched async to Rust

Rust: `translation_logger.rs`
- Rotating file logger (5 MB max, 5 backups)
- Log: `%APPDATA%\...\logs\bilingual_translation.log`
- Sanitizes API keys and Bearer tokens before writing
- Tauri commands: `api_write_translation_log_line`, `api_get_translation_log_path`, `api_open_translation_log_folder`

---

## Phase 3 — Bilingual Customizations Inventory (35 items)

| # | Customization | Location |
|---|--------------|----------|
| 1 | Groq Realtime Translation (primary) | unifiedTranslationScheduler.ts, api.rs |
| 2 | Gemini Fallback Translation | unifiedTranslationScheduler.ts, api.rs |
| 3 | UnifiedTranslationScheduler | unifiedTranslationScheduler.ts |
| 4 | 6-second Batch Window (classroom cadence) | unifiedTranslationScheduler.ts |
| 5 | Translation Session Isolation | translationSessionTracker.ts |
| 6 | Rate-Limit Handling (429 / cooldown / model promotion) | unifiedTranslationScheduler.ts |
| 7 | Session-Level Auth Disable (401/403) | unifiedTranslationScheduler.ts |
| 8 | Translation ON/OFF Toggle | geminiTranslationService.ts, TranslationHealthIndicator.tsx |
| 9 | Manual/Selective Per-Segment Translation | TranscriptContext.tsx, VirtualizedTranscriptView.tsx |
| 10 | English-Only Degraded Mode | unifiedTranslationScheduler.ts, translationStatsTracker.ts |
| 11 | Translation Failure Isolation (async IIFE) | TranscriptContext.tsx |
| 12 | Bilingual Transcript Display (EN + ZH dual-line) | VirtualizedTranscriptView.tsx |
| 13 | TranslationHealthIndicator (badge + popover) | TranslationHealthIndicator.tsx |
| 14 | Smart Follow (Follow Live ON/OFF) | TranscriptPanel.tsx |
| 15 | 10-Second Idle Auto-Return | TranscriptPanel.tsx |
| 16 | Down-Arrow Live Button + new segment counter | TranscriptPanel.tsx |
| 17 | Recording Controls in Top Toolbar | TranscriptPanel.tsx, page.tsx |
| 18 | Dark Theme Polish (cyan-300 translations) | VirtualizedTranscriptView.tsx, globals.css |
| 19 | NAIT Classroom Summary Template | frontend/src-tauri/templates/nait_classroom.json |
| 20 | Local Qwen3 Translation (Mac mini Tailscale) | localTranslationService.ts, api.rs |
| 21 | Local Qwen3 via Built-in Sidecar | summary/summary_engine/local_translation.rs |
| 22 | SharedModels path management | shared_models.rs |
| 23 | Groq API key in OS Credential Vault | credentials.rs, api.rs |
| 24 | Gemini API key in OS Credential Vault | credentials.rs, api.rs |
| 25 | Legacy localStorage -> Vault key migration | geminiTranslationService.ts, api.rs |
| 26 | Translation Stats Tracker (RPM, counters, health) | translationStatsTracker.ts |
| 27 | Translation Diagnostic Logger (privacy-safe, rotating) | translationDiagnosticLogger.ts, translation_logger.rs |
| 28 | Provider Mode Switching (Cloud vs Local Qwen3) | geminiTranslationService.ts, GeminiSettings.tsx |
| 29 | Local Qwen3 Health Check Tauri command | api.rs, localTranslationService.ts |
| 30 | Translation persistence in SQLite | api.rs (api_save_transcript_translation, api_batch_save_translations) |
| 31 | Translation column in transcripts DB | database/repositories/transcript.rs |
| 32 | IndexedDB crash recovery | indexedDBService.ts, TranscriptContext.tsx |
| 33 | Technical Terminology Context (NAIT IT terms) | localTranslationService.ts (TECHNICAL_TERMINOLOGY_CONTEXT) |
| 34 | groq.rs module (model listing + cache + fallback) | groq/groq.rs |
| 35 | GeminiSettings full panel | GeminiSettings.tsx |

---

## Phase 4 — Module Classification

### GREEN — Upstream Core (safe to follow upstream)

| Module | Notes |
|--------|-------|
| `audio/pipeline.rs` | Audio mixing/VAD — no bilingual content |
| `audio/recording_commands.rs` | Recording lifecycle — upstream-owned |
| `audio/recording_manager.rs` | Session coordination — upstream-owned |
| `audio/recording_saver.rs` | Audio persistence — upstream-owned |
| `audio/incremental_saver.rs` | Checkpoint recovery — upstream-owned |
| `audio/vad.rs` | Silero VAD — upstream-owned |
| `audio/devices/` | Device discovery — upstream-owned |
| `audio/capture/` | Stream capture — upstream-owned |
| `audio/retranscription.rs` | Retranscription — upstream-owned |
| `audio/import.rs` | Import audio — upstream-owned |
| `whisper_engine/` (most) | Whisper transcription — upstream-owned |
| `summary/processor.rs` | LLM summary pipeline — upstream-owned |
| `summary/service.rs` | Summary service — upstream-owned |
| `summary/llm_client.rs` | LLM client — upstream-owned |
| `summary/summary_engine/model_manager.rs` | Built-in AI model management — upstream-owned |
| `summary/summary_engine/sidecar.rs` | Sidecar process — upstream-owned |
| `summary/templates/loader.rs`, `types.rs` | Template system (not templates themselves) |
| `database/` (most) | SQLite schema, migrations, repositories |
| `analytics/` | Telemetry |
| `notifications/` | Notification system |
| `ollama/`, `openai/`, `anthropic/`, `openrouter/` | LLM provider integrations |
| `onboarding.rs` | Onboarding flow |
| `tray.rs` | System tray |
| `config.rs` | Whisper model catalog |
| `state.rs` | App state |
| Front: `ConfigContext.tsx` | Config management |
| Front: `RecordingStateContext.tsx` | Recording state |
| Front: `Sidebar/` | Sidebar |
| Front: `BuiltInModelManager.tsx` | Model UI |
| Front: `WhisperModelManager.tsx` | Whisper model UI |
| Front: `ParakeetModelManager.tsx` | Parakeet model UI |
| Front: `hooks/` (most) | useRecordingStart, useRecordingStop, etc. |

### BLUE — Bilingual Owned (preserve across all upstream upgrades)

| Module | Notes |
|--------|-------|
| `credentials.rs` | Groq + Gemini credential management |
| `groq/groq.rs` | Groq model listing with bilingual fallback models |
| `translation_logger.rs` | Translation diagnostic logger |
| `shared_models.rs` | SharedModels path management |
| `summary/summary_engine/local_translation.rs` | Local Qwen batch translation via sidecar |
| `summary/templates/nait_classroom.json` | NAIT classroom summary template |
| `api/api.rs` lines 1390-1878 | Translation commands: Gemini, Groq, Local Qwen, credentials |
| Front: `geminiTranslationService.ts` | Provider state, enable/disable, mode switching |
| Front: `localTranslationService.ts` | Local Qwen3 endpoint management |
| Front: `unifiedTranslationScheduler.ts` | Full translation dispatch engine |
| Front: `translationSessionTracker.ts` | Session isolation and versioning |
| Front: `translationStatsTracker.ts` | Health metrics and subscriber pattern |
| Front: `translationDiagnosticLogger.ts` | Structured async log dispatch |
| Front: `legacyTranslationMigration.ts` | Legacy key migration |
| Front: `TranslationHealthIndicator.tsx` | Status badge + popover |
| Front: `GeminiSettings.tsx` | Full bilingual settings panel |
| Front: `VirtualizedTranscriptView.tsx` | Bilingual display + manual translate |
| Front: `TranscriptPanel.tsx` | Smart Follow + toolbar integration |

### YELLOW — Overlap (manual integration review required)

| Module | Upstream Concern | Bilingual Addition |
|--------|-----------------|-------------------|
| `api/api.rs` lines 1-1389 | Meetings, transcripts, model config | `translation: Option<String>` in TranscriptSegment and MeetingTranscript |
| `lib.rs` | Command registration, app setup | Bilingual command registrations (lines 764-777, 809-810) |
| `frontend/src-tauri/Cargo.toml` | Standard deps | New bilingual crates |
| `TranscriptContext.tsx` | Transcript state, IndexedDB | translationMap, requestTranslation, session tracker |
| `page.tsx` | Main page layout | Recovery dialog, toolbar injection |
| `RecordingControls.tsx` | Recording UI | Position moved to toolbar via prop |
| `database/repositories/transcript.rs` | Transcript CRUD | translation column, update_translation(), batch_update_translations_by_text() |
| `summary/templates/defaults.rs` + `loader.rs` | Template loading | NAIT template must be included |
| `indexedDBService.ts` | Recovery service | Enhanced for Bilingual metadata |
| `tauri.conf.json` | App config | CSP, allowlist for Groq/Gemini/Tailscale network access |

### RED — High-Risk Overlap (NEVER blindly overwrite)

| Module | Risk Description |
|--------|-----------------|
| `api/api.rs` | Both upstream commands AND all 488 lines of Bilingual translation commands in one file. Struct changes to TranscriptSegment or MeetingTranscript could break translation persistence. |
| `TranscriptContext.tsx` | Central coordinator: recording events + transcript persistence + translation dispatch. Upstream changes to transcript-update handling or markMeetingAsSaved could break translation flow. |
| `database/repositories/transcript.rs` | translation column is a Bilingual addition. Upstream migrations must not remove it. |
| `parakeet_engine/parakeet_engine.rs` | SharedModels fallback path at line 283. Upstream model loading refactors could break it. |
| `summary/summary_engine/local_translation.rs` | Calls shared_models::get_shared_summary_models_dir(). Sidecar API changes could interfere. |
| `lib.rs` command handler | Bilingual commands at lines 764-777, 809-810. Upstream handler reorganization risks dropping them. |
| `tauri.conf.json` | App identifier, CSP, allowlists. Upstream changes could break Groq/Gemini/Tailscale network access. |

---

## Phase 5 — Recovery Boundary Audit

### Translation Isolation — Three Levels

#### Level 1: Async IIFE in TranscriptContext.tsx (lines 99-125)

```
requestTranslation(sequenceId, text) {
  // ... tracker checks ...
  (async () => {          // <-- fire-and-forget IIFE
    try {
      const translation = await translateWithGemini(...)
      trackerRef.current.commitResult(...)
      setTranslationForSequence(...)
    } catch (error) {
      trackerRef.current.commitResult(..., null)
      // log error — NEVER throws — NEVER affects recording
    }
  })();                   // <-- never awaited
}
```

#### Level 2: UnifiedTranslationScheduler internal guards
- All HTTP failures caught -> logged + return null
- Session-level disables -> return null without network call
- Queue overflow -> resolve with null (drop cleanly)
- AuthError -> session disabled, resolved to null

#### Level 3: TranslationSessionTracker.commitResult()
- Rejects responses from old sessions (session ID mismatch)
- Rejects superseded requests (version mismatch)
- Prevents stale translations from overwriting newer results

### Enforcement Points (MUST-PRESERVE)

| File | Lines | Mechanism |
|------|-------|-----------|
| `TranscriptContext.tsx` | 84-128 | Async IIFE + try/catch isolation |
| `unifiedTranslationScheduler.ts` | all | try/catch on all HTTP, null on failure |
| `translationSessionTracker.ts` | 116-147 | commitResult session+version guard |
| `TranscriptContext.tsx` | 164-172 | waitForInFlightTranslations — wait only, never block |
| `geminiTranslationService.ts` | 121-131 | setCloudTranslationEnabled(false) -> scheduler.clear() |

### MUST-PRESERVE Behaviors (non-negotiable)
1. requestTranslation() MUST remain fire-and-forget (void return, never awaited)
2. addTranscript() MUST call requestTranslation() AFTER updating React state
3. Catch block at TranscriptContext.tsx:115-124 MUST catch all translation errors
4. markMeetingAsSaved() MUST NOT require translation to have succeeded
5. recording-stopped handler MUST persist transcripts regardless of translation state

---

## Phase 6 — Smart Follow Preservation

### Implementation — TranscriptPanel.tsx

Core refs/state:
- `followLive` (state) + `followLiveRef` (ref) — Follow Live on/off
- `isProgrammaticScrollRef` — prevents scroll handler misreading programmatic scroll
- `idleTimerRef` — 10-second timeout handle
- `pausedAtCountRef` — transcript count at pause (for new-segment delta)
- `newSegmentsCount` — unseen segments while paused

| Behavior | Implementation |
|----------|---------------|
| Follow Live ON | Scroll handler: distance-from-bottom <= 80px -> setFollowLive(true) |
| User scrolls up | Scroll handler: distance > 80px -> setFollowLive(false), record pause point |
| 10-second idle auto-return | resetIdleTimer() -> 10s setTimeout -> returnToLive() |
| Text-selection protection | Before return: check window.getSelection(); reschedule if active selection |
| Activity resets idle timer | mousemove, mousedown, touchstart, pointerdown, wheel, selectionchange |
| New segment counter | currentLength - pausedAtCountRef.current while paused |
| Down-arrow Live button | Visible when !followLive && transcripts.length > 0 |
| Return to live | returnToLive() -> setFollowLive(true) + scrollToBottomSmooth() |
| Smooth scroll | container.scrollTo({top: scrollHeight, behavior: 'smooth'}) |
| Programmatic scroll guard | isProgrammaticScrollRef set during scroll, cleared after 400ms |

Files involved:
- `frontend/src/app/_components/TranscriptPanel.tsx` — ALL Smart Follow logic lives here
- `frontend/src/components/VirtualizedTranscriptView.tsx` — `disableAutoScroll={true}` (panel owns scroll)
- `frontend/src/contexts/TranscriptContext.tsx` — `transcriptContainerRef` shared via context

MUST-PRESERVE: Smart Follow is entirely self-contained in TranscriptPanel.tsx.
Upstream changes to transcript panel layout must not remove this logic.

---

## Phase 7 — Upstream Upgrade Boundaries

### Strategy Classification

| Module | Strategy | Rationale |
|--------|----------|-----------|
| `audio/pipeline.rs` | FAST-FORWARD | No bilingual content |
| `audio/vad.rs` | FAST-FORWARD | No bilingual content |
| `audio/devices/` | FAST-FORWARD | Device discovery improvements welcome |
| `audio/recording_saver.rs` | FAST-FORWARD | Audio file persistence |
| `audio/recording_manager.rs` | CHERRY-PICK | Must verify recording-started/stopped events still fire |
| `whisper_engine/` | CHERRY-PICK | Verify SharedModels path integration not broken |
| `parakeet_engine/` (most) | CHERRY-PICK | Verify new_with_models_dir() SharedModels fallback preserved |
| `database/migrations/` | CHERRY-PICK | Verify translation column preserved |
| `summary/templates/loader.rs` | CHERRY-PICK | Verify nait_classroom.json still loaded |
| `summary/summary_engine/model_manager.rs` | CHERRY-PICK | Verify SharedModels path integration |
| `notifications/` | FAST-FORWARD | No bilingual concern |
| `analytics/` | FAST-FORWARD | No bilingual concern |
| `onboarding.rs` | FAST-FORWARD | No bilingual concern |
| `ollama/`, `openai/`, `anthropic/`, `openrouter/` | FAST-FORWARD | No bilingual concern |
| `api/api.rs` | MANUAL PORT | Bilingual commands in same file as upstream |
| `lib.rs` | MANUAL PORT | Command registrations must be preserved |
| `TranscriptContext.tsx` | MANUAL PORT | Deep translation integration |
| `database/repositories/transcript.rs` | MANUAL PORT | translation column must survive |
| `tauri.conf.json` | MANUAL PORT | CSP / allowlists for bilingual network access |
| `frontend/src-tauri/Cargo.toml` | MANUAL PORT | Bilingual crates |
| `RecordingControls.tsx` | CHERRY-PICK | Verify toolbar injection prop still works |
| `page.tsx` | MANUAL PORT | Toolbar injection architecture must survive |
| `credentials.rs` | PRESERVE BILINGUAL | No upstream equivalent |
| `groq/groq.rs` | PRESERVE BILINGUAL | Bilingual-specific module |
| `translation_logger.rs` | PRESERVE BILINGUAL | Bilingual-specific |
| `shared_models.rs` | PRESERVE BILINGUAL | Bilingual-specific |
| `summary/summary_engine/local_translation.rs` | PRESERVE BILINGUAL | Bilingual-specific |
| `summary/templates/nait_classroom.json` | PRESERVE BILINGUAL | Bilingual-specific template |
| All `frontend/src/services/translation*.ts` | PRESERVE BILINGUAL | Core bilingual feature |
| `TranslationHealthIndicator.tsx` | PRESERVE BILINGUAL | Bilingual-specific component |
| `GeminiSettings.tsx` | PRESERVE BILINGUAL | Bilingual-specific settings |
| Smart Follow in `TranscriptPanel.tsx` | PRESERVE BILINGUAL | Bilingual UX |
| Bilingual display in `VirtualizedTranscriptView.tsx` | PRESERVE BILINGUAL | Core bilingual feature |

---

## Phase 8 — Long-Term Git Strategy

### Recommended Branch Model

```
origin (upstream: Zackriya-Solutions/meetily)
   |
   +-- upstream-baseline/<version>   (read-only tag snapshot, no changes)
        |
        +-- integration/<version>    (controlled port + test branch)
             |
             +-- feature/live-translation   (current Bilingual dev branch)
                  |
                  +-- bilingual-stable      (classroom-tested releases)
                       |
                       +-- publish/main     (public Bilingual repo)
```

### Upgrade Procedure for Future Upstream Releases

Example: upstream releases v0.5.0

```bash
# Step 1: Snapshot upstream baseline (read-only)
git fetch origin
git branch upstream-baseline/v0.5.0 v0.5.0

# Step 2: Create integration branch from upstream
git checkout -b integration/v0.5.0 v0.5.0

# Step 3: Apply Bilingual-owned (BLUE) files first
git checkout feature/live-translation -- credentials.rs
git checkout feature/live-translation -- groq/groq.rs
git checkout feature/live-translation -- translation_logger.rs
git checkout feature/live-translation -- shared_models.rs
# ... all BLUE files

# Step 4: Manually diff YELLOW/RED files
git diff v0.4.1..v0.5.0 -- frontend/src-tauri/src/api/api.rs
git diff v0.4.1..v0.5.0 -- frontend/src/contexts/TranscriptContext.tsx
# ... review each diff, port upstream improvements while preserving Bilingual sections

# Step 5: Verify RED file invariants
# - translation column in transcript.rs still exists
# - TranscriptSegment.translation field still exists
# - MeetingTranscript.translation field still exists
# - Bilingual commands in lib.rs still registered
# - parakeet shared_models fallback still present
# - tauri.conf.json allowlists still include Groq/Gemini/Tailscale

# Step 6: Run reliability tests
# frontend/tests/lib/meetily-bilingual-reliability.test.ts

# Step 7: NAIT classroom smoke test
# - Start recording -> bilingual transcript appears
# - Toggle translation off/on -> recording unaffected
# - NAIT classroom template present in summary

# Step 8: Merge to bilingual-stable
git checkout bilingual-stable
git merge integration/v0.5.0
git tag v0.5.0-bilingual-beta.1

# Step 9: Push to publish
git push publish feature/live-translation
git push publish --tags
```

---

## Summary: High-Risk Areas

### Top 10 Highest-Risk Files for Upstream Integration

1. `frontend/src-tauri/src/api/api.rs` — upstream API + 488 lines of Bilingual commands in one file
2. `frontend/src/contexts/TranscriptContext.tsx` — translation dispatch wired into upstream transcript lifecycle
3. `frontend/src-tauri/src/database/repositories/transcript.rs` — translation column is Bilingual addition
4. `frontend/src-tauri/src/lib.rs` — Bilingual command registrations mixed into Tauri builder
5. `frontend/src-tauri/Cargo.toml` — bilingual crates mixed with upstream
6. `frontend/src-tauri/src/parakeet_engine/parakeet_engine.rs` — SharedModels fallback path
7. `frontend/src-tauri/src/summary/summary_engine/commands.rs` — SharedModels path for summary models
8. `frontend/src-tauri/tauri.conf.json` — CSP / allowlists for translation API network access
9. `frontend/src/app/page.tsx` — toolbar injection architecture for RecordingControls
10. `frontend/src/app/_components/TranscriptPanel.tsx` — Smart Follow + toolbar host

### Working Tree Status
18 modified files + 2 untracked paths are the current production state.
Commit them before any upstream integration work begins.
