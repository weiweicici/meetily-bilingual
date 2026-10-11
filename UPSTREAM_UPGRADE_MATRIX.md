# Meetily Bilingual — Upstream Upgrade Matrix
**Date:** 2026-10-11
**Fork base:** upstream `v0.4.1` (commit `a2cb62e`)
**Current Bilingual:** `v0.4.1-bilingual-beta.4.1` (commit `4514b5e`)

This matrix is the decision table for every file in the codebase.
Use this when a new upstream release arrives.

Legend:
- FAST-FORWARD  : Take upstream file as-is; no Bilingual content
- CHERRY-PICK   : Take upstream changes but verify one specific Bilingual invariant
- MANUAL PORT   : Diff carefully; upstream improvements welcome but Bilingual sections must be preserved
- PRESERVE      : Bilingual-owned file; do NOT replace with upstream version
- NEW-BILINGUAL : File does not exist upstream; always copy from Bilingual branch

---

## A. Rust Core — Audio

| File | Strategy | Invariant to Verify |
|------|----------|---------------------|
| `audio/pipeline.rs` | FAST-FORWARD | — |
| `audio/recording_commands.rs` | FAST-FORWARD | `recording-started` and `recording-stopped` events still emitted |
| `audio/recording_manager.rs` | FAST-FORWARD | Same events still emitted |
| `audio/recording_saver.rs` | FAST-FORWARD | — |
| `audio/incremental_saver.rs` | FAST-FORWARD | `recover_audio_from_checkpoints`, `cleanup_checkpoints`, `has_audio_checkpoints` commands still exist |
| `audio/vad.rs` | FAST-FORWARD | — |
| `audio/vad_config.rs` | FAST-FORWARD | — |
| `audio/buffer_pool.rs` | FAST-FORWARD | — |
| `audio/devices/discovery.rs` | FAST-FORWARD | — |
| `audio/devices/microphone.rs` | FAST-FORWARD | — |
| `audio/devices/speakers.rs` | FAST-FORWARD | — |
| `audio/devices/configuration.rs` | FAST-FORWARD | — |
| `audio/devices/platform/windows.rs` | FAST-FORWARD | — |
| `audio/devices/platform/macos.rs` | FAST-FORWARD | — |
| `audio/devices/platform/linux.rs` | FAST-FORWARD | — |
| `audio/capture/microphone.rs` | FAST-FORWARD | — |
| `audio/capture/system.rs` | FAST-FORWARD | — |
| `audio/simple_level_monitor.rs` | FAST-FORWARD | — |
| `audio/retranscription.rs` | FAST-FORWARD | — |
| `audio/import.rs` | FAST-FORWARD | — |
| `audio/recording_preferences.rs` | FAST-FORWARD | — |
| `audio/system_audio_commands.rs` | FAST-FORWARD | — |
| `audio/permissions.rs` | FAST-FORWARD | — |

---

## B. Rust Core — Whisper Engine

| File | Strategy | Invariant to Verify |
|------|----------|---------------------|
| `whisper_engine/whisper_engine.rs` | CHERRY-PICK | SharedModels path or model loading paths must not conflict with shared_models.rs |
| `whisper_engine/commands.rs` | CHERRY-PICK | `open_models_folder` command still exists |
| `whisper_engine/parallel_processor.rs` | FAST-FORWARD | — |
| `whisper_engine/parallel_commands.rs` | FAST-FORWARD | — |
| `whisper_engine/acceleration.rs` | FAST-FORWARD | — |
| `whisper_engine/mod.rs` | FAST-FORWARD | — |

---

## C. Rust Core — Parakeet Engine

| File | Strategy | Invariant to Verify |
|------|----------|---------------------|
| `parakeet_engine/parakeet_engine.rs` | CHERRY-PICK | Line in `new_with_models_dir()` fallback: MUST call `crate::shared_models::get_shared_parakeet_models_dir()` when models_dir is None |
| `parakeet_engine/model.rs` | FAST-FORWARD | — |
| `parakeet_engine/commands.rs` | FAST-FORWARD | — |
| `parakeet_engine/mod.rs` | FAST-FORWARD | — |

---

## D. Rust Core — Database

| File | Strategy | Invariant to Verify |
|------|----------|---------------------|
| `database/mod.rs` | FAST-FORWARD | — |
| `database/commands.rs` | FAST-FORWARD | — |
| `database/manager.rs` | FAST-FORWARD | — |
| `database/migrations/` | CHERRY-PICK | Migration files must not drop `translation TEXT` column from transcripts table |
| `database/repositories/transcript.rs` | MANUAL PORT | Must preserve: `translation` field in SELECT, `update_translation()`, `batch_update_translations_by_text()` |
| `database/repositories/meeting.rs` | FAST-FORWARD | — |
| `database/repositories/settings.rs` | FAST-FORWARD | — |

---

## E. Rust Core — Summary

| File | Strategy | Invariant to Verify |
|------|----------|---------------------|
| `summary/mod.rs` | FAST-FORWARD | — |
| `summary/processor.rs` | FAST-FORWARD | — |
| `summary/service.rs` | FAST-FORWARD | — |
| `summary/llm_client.rs` | FAST-FORWARD | — |
| `summary/commands.rs` | FAST-FORWARD | All commands still registered |
| `summary/summary_engine/mod.rs` | CHERRY-PICK | `api_translate_local_batch` and `api_is_local_qwen_available` still re-exported |
| `summary/summary_engine/commands.rs` | CHERRY-PICK | Uses `crate::shared_models::get_shared_summary_models_dir()` at lines 53, 361; Qwen model recommendations still present |
| `summary/summary_engine/model_manager.rs` | CHERRY-PICK | Must not break SharedModels path resolution |
| `summary/summary_engine/sidecar.rs` | CHERRY-PICK | Sidecar API must remain compatible with `local_translation.rs` client call |
| `summary/summary_engine/client.rs` | CHERRY-PICK | `generate_with_builtin_custom()` signature must remain compatible |
| `summary/summary_engine/models.rs` | FAST-FORWARD | — |
| `summary/summary_engine/local_translation.rs` | PRESERVE | 100% Bilingual — do not replace |
| `summary/templates/mod.rs` | FAST-FORWARD | — |
| `summary/templates/loader.rs` | CHERRY-PICK | NAIT template (`nait_classroom.json`) must still be discovered and loaded |
| `summary/templates/types.rs` | FAST-FORWARD | — |
| `summary/templates/defaults.rs` | CHERRY-PICK | NAIT template must be in the bundled list |
| `summary/template_commands.rs` | FAST-FORWARD | — |

---

## F. Rust Core — Bilingual-Specific Modules (PRESERVE ALL)

| File | Strategy | Notes |
|------|----------|-------|
| `credentials.rs` | PRESERVE | No upstream equivalent |
| `groq/groq.rs` | PRESERVE | No upstream equivalent |
| `groq/mod.rs` | PRESERVE | No upstream equivalent |
| `translation_logger.rs` | PRESERVE | No upstream equivalent |
| `shared_models.rs` | PRESERVE | No upstream equivalent — critical for Parakeet + Summary model paths |

---

## G. Rust Core — Mixed Files

| File | Strategy | Invariant to Verify |
|------|----------|---------------------|
| `api/api.rs` | MANUAL PORT | See table below |
| `lib.rs` | MANUAL PORT | See table below |
| `frontend/src-tauri/Cargo.toml` | MANUAL PORT | Bilingual crates must survive |
| `frontend/src-tauri/tauri.conf.json` | MANUAL PORT | CSP / network allowlists must include Groq, Gemini, Tailscale |

### api/api.rs Merge Procedure

When porting upstream changes to api.rs:

1. Take upstream changes for lines 1-1389 (upstream API commands)
2. Verify these structs still have `translation: Option<String>`:
   - `TranscriptSegment` (around line 182-195)
   - `MeetingTranscript` (around line 130-153)
3. Ensure all Bilingual command functions (lines 1390-1878) are appended after upstream content
4. Do NOT let upstream code overwrite or remove Bilingual functions

### lib.rs Merge Procedure

When porting upstream changes to lib.rs:

1. Take upstream module declarations
2. Verify these module declarations still exist:
   - `pub mod credentials;`
   - `pub mod groq;`
   - `pub mod shared_models;`
   - `pub mod translation_logger;`
3. Verify the following commands still registered in `invoke_handler!`:
   - `api::api_save_transcript_translation`
   - `api::api_batch_save_translations`
   - `api::api_save_gemini_api_key`
   - `api::api_migrate_gemini_api_key`
   - `api::api_is_gemini_configured`
   - `api::api_delete_gemini_api_key`
   - `api::api_translate_gemini_text`
   - `api::api_save_groq_api_key`
   - `api::api_is_groq_configured`
   - `api::api_delete_groq_api_key`
   - `api::api_translate_groq_text`
   - `api::api_check_local_qwen_health`
   - `api::api_translate_local_qwen_batch`
   - `translation_logger::api_write_translation_log_line`
   - `translation_logger::api_get_translation_log_path`
   - `translation_logger::api_open_translation_log_folder`
   - `summary::summary_engine::api_translate_local_batch`
   - `summary::summary_engine::api_is_local_qwen_available`
   - `groq::groq::get_groq_models`

---

## H. Frontend — Context Files

| File | Strategy | Invariant to Verify |
|------|----------|---------------------|
| `src/contexts/TranscriptContext.tsx` | MANUAL PORT | See checklist below |
| `src/contexts/RecordingStateContext.tsx` | FAST-FORWARD | — |
| `src/contexts/ConfigContext.tsx` | FAST-FORWARD | — |

### TranscriptContext.tsx Merge Checklist

When porting upstream changes to TranscriptContext.tsx:

1. `translationMap` state and `translationMapRef` still exist
2. `requestTranslation()` still fire-and-forget (void, async IIFE, never awaited)
3. `requestManualTranslation()` still callable from outside context
4. `waitForInFlightTranslations()` still called in meeting save flow
5. `addTranscript()` still calls `requestTranslation()` AFTER updating transcript state
6. `recording-started` event handler still resets translation session
7. Catch block for translation errors still present (IIFE try/catch)
8. `markMeetingAsSaved()` does NOT require translation success
9. IndexedDB writes happen BEFORE SQLite save (crash recovery)

---

## I. Frontend — Main Page Files

| File | Strategy | Invariant to Verify |
|------|----------|---------------------|
| `src/app/page.tsx` | MANUAL PORT | `recordingControls` prop injection into TranscriptPanel; TranscriptRecovery dialog |
| `src/app/_components/TranscriptPanel.tsx` | MANUAL PORT | Smart Follow logic; toolbar slot for TranslationHealthIndicator + recording controls |
| `src/app/_components/SettingsModal.tsx` | CHERRY-PICK | GeminiSettings panel still included as a tab |
| `src/app/_components/StatusOverlays.tsx` | FAST-FORWARD | — |

---

## J. Frontend — Components

| File | Strategy | Invariant to Verify |
|------|----------|---------------------|
| `src/components/VirtualizedTranscriptView.tsx` | MANUAL PORT | Dual-line EN+ZH display; manual translate button; `disableAutoScroll` prop |
| `src/components/RecordingControls.tsx` | CHERRY-PICK | Accepts `meetingName` prop; can be injected via prop (no hardcoded position) |
| `src/components/GeminiSettings.tsx` | PRESERVE | 100% Bilingual |
| `src/components/TranslationHealthIndicator.tsx` | PRESERVE | 100% Bilingual |
| `src/components/TranscriptRecovery.tsx` | CHERRY-PICK | Recovery dialog; ensure still compatible with indexedDBService |
| `src/components/Sidebar/SidebarProvider.tsx` | CHERRY-PICK | `refetchMeetings()` still exported |
| `src/components/Sidebar/` (other) | FAST-FORWARD | — |
| `src/components/ui/` | FAST-FORWARD | — |

---

## K. Frontend — Services

| File | Strategy | Invariant to Verify |
|------|----------|---------------------|
| `src/services/geminiTranslationService.ts` | PRESERVE | 100% Bilingual |
| `src/services/localTranslationService.ts` | PRESERVE | 100% Bilingual |
| `src/services/unifiedTranslationScheduler.ts` | PRESERVE | 100% Bilingual |
| `src/services/translationSessionTracker.ts` | PRESERVE | 100% Bilingual |
| `src/services/translationStatsTracker.ts` | PRESERVE | 100% Bilingual |
| `src/services/translationDiagnosticLogger.ts` | PRESERVE | 100% Bilingual |
| `src/services/legacyTranslationMigration.ts` | PRESERVE | 100% Bilingual |
| `src/services/indexedDBService.ts` | CHERRY-PICK | `StoredTranscript.translation` field still present; `deleteOldMeetings()` and `deleteSavedMeetings()` still work |
| `src/services/transcriptService.ts` | FAST-FORWARD | — |

---

## L. Frontend — Hooks

| File | Strategy | Invariant to Verify |
|------|----------|---------------------|
| `src/hooks/useRecordingStart.ts` | FAST-FORWARD | — |
| `src/hooks/useRecordingStop.ts` | CHERRY-PICK | Does not block on translation; calls `waitForInFlightTranslations()` indirectly via context |
| `src/hooks/useRecordingStateSync.ts` | FAST-FORWARD | — |
| `src/hooks/useTranscriptRecovery.ts` | CHERRY-PICK | Works with indexedDBService — recovery flow intact |
| `src/hooks/usePermissionCheck.ts` | FAST-FORWARD | — |
| `src/hooks/useModalState.ts` | FAST-FORWARD | — |

---

## M. Templates

| File | Strategy | Notes |
|------|----------|-------|
| `frontend/src-tauri/templates/nait_classroom.json` | PRESERVE | 100% Bilingual |
| `frontend/src-tauri/templates/standard_meeting.json` | FAST-FORWARD | — |
| `frontend/src-tauri/templates/daily_standup.json` | FAST-FORWARD | — |
| `frontend/src-tauri/templates/project_sync.json` | FAST-FORWARD | — |
| `frontend/src-tauri/templates/retrospective.json` | FAST-FORWARD | — |
| `frontend/src-tauri/templates/sales_marketing_client_call.json` | FAST-FORWARD | — |
| `frontend/src-tauri/templates/psyciatric_session.json` | FAST-FORWARD | — |

---

## N. Configuration / Build

| File | Strategy | Invariant to Verify |
|------|----------|---------------------|
| `frontend/src-tauri/Cargo.toml` | MANUAL PORT | Bilingual crates (`keyring`, `constant_time_eq`, etc.) must survive |
| `frontend/src-tauri/tauri.conf.json` | MANUAL PORT | CSP allowlist: `https://api.groq.com`, `https://generativelanguage.googleapis.com`, Tailscale subnet |
| `frontend/src-tauri/build.rs` | FAST-FORWARD | — |
| `frontend/package.json` | FAST-FORWARD | — |
| `frontend/tsconfig.json` | FAST-FORWARD | — |
| `frontend/next.config.mjs` | FAST-FORWARD | — |

---

## Summary Count

| Strategy | Count | Files |
|----------|-------|-------|
| FAST-FORWARD | 42 | Audio (most), whisper (most), notifications, analytics, UI primitives |
| CHERRY-PICK | 16 | Key infrastructure with one specific Bilingual invariant each |
| MANUAL PORT | 8 | Files with deep Bilingual + upstream overlap |
| PRESERVE | 18 | 100% Bilingual-owned |
| NEW-BILINGUAL | 13 | New files not in upstream |

---

## Pre-Upgrade Verification Checklist

Before starting any upstream integration work:

### Step 0: Commit current working tree
```bash
git add -A
git commit -m "wip: Bilingual working state 2026-10-11 (pre-upgrade snapshot)"
git tag v0.4.1-bilingual-wip-2026-10-11
```

### Step 1: Check upstream release notes
- Any changes to Tauri version (2.x -> 3.x would be breaking)
- Any database schema changes
- Any changes to `TranscriptSegment` struct
- Any changes to event names (`transcript-update`, `recording-started`, `recording-stopped`)
- Any changes to how sidecar is managed

### Step 2: Diff key files
```bash
# Check for structural changes in critical files
git diff a2cb62e..<new-upstream-tag> -- frontend/src-tauri/src/api/api.rs
git diff a2cb62e..<new-upstream-tag> -- frontend/src-tauri/src/lib.rs
git diff a2cb62e..<new-upstream-tag> -- frontend/src/contexts/TranscriptContext.tsx
git diff a2cb62e..<new-upstream-tag> -- frontend/src-tauri/src/database/repositories/transcript.rs
git diff a2cb62e..<new-upstream-tag> -- frontend/src-tauri/src/parakeet_engine/parakeet_engine.rs
git diff a2cb62e..<new-upstream-tag> -- frontend/src-tauri/src/summary/summary_engine/sidecar.rs
git diff a2cb62e..<new-upstream-tag> -- frontend/src-tauri/tauri.conf.json
```

### Step 3: Verify RED invariants
- [ ] `translation: Option<String>` still in `TranscriptSegment`
- [ ] `translation: Option<String>` still in `MeetingTranscript`
- [ ] `translation` column not dropped in any new migration
- [ ] `update_translation()` and `batch_update_translations_by_text()` not removed from transcript.rs
- [ ] `new_with_models_dir(None)` fallback still present in parakeet_engine.rs
- [ ] `get_shared_summary_models_dir()` still called in commands.rs
- [ ] sidecar `generate_with_builtin_custom()` signature unchanged

### Step 4: Test Bilingual features post-integration
- [ ] Record 30 seconds: English transcript appears
- [ ] Bilingual translation appears (Chinese below English)
- [ ] Translation health indicator shows correct state
- [ ] Smart Follow: scroll up -> auto-return after 10s idle
- [ ] Translation toggle: recording continues when translation disabled
- [ ] NAIT classroom template available in summary dropdown
- [ ] Recovery dialog: appears on startup after simulated crash (requires indexedDB data)
- [ ] Groq API key: save + verify + delete in settings
- [ ] Gemini API key: save + verify + delete in settings
- [ ] Manual translate button: per-segment retry works
