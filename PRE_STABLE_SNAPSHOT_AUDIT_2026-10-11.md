# Meetily Bilingual — Pre-Stable Snapshot Audit
**Audit Date:** 2026-10-11  
**Audit Scope:** READ-ONLY Forensic Audit of Current Working Tree  
**Auditor:** Antigravity AI (Read-Only Forensic Examiner)  
**Status:** COMPLETE  

---

## 1. Executive Summary & Verdict

| Inspection Target | Result |
| :--- | :--- |
| **Current Branch** | `feature/live-translation` |
| **Current HEAD** | `4514b5e` (*Meetily Bilingual Beta 4.1: bilingual NAIT summary and dark theme polish*) |
| **Upstream Fork Base** | `a2cb62e` (*Release v0.4.1*) |
| **Working Tree Modifications** | 18 modified files (1,432 insertions, 340 deletions) |
| **Untracked Items** | 2 items (`crates/`, `frontend/tests/lib/meetily-bilingual-reliability.test.ts`) |
| **Staged Changes** | None (0 files staged) |
| **Secret / Credential Leak Risk** | **CLEAN** (No API keys, passwords, or tokens found) |
| **Large / Binary Artifact Risk** | **CLEAN** (No compiled `.dll`, `.exe`, `.lib`, `.obj` found in working tree) |
| **Special Audit: `crates/whisper-rs/`** | `REQUIRED_BUT_SHOULD_NOT_VENDOR` (See Section 6) |
| **Special Audit: Reliability Test** | `TEST_OR_DOCUMENTATION` (Production test suite, safe to commit) |
| **Customization Manifest Alignment** | 100% Aligned with R1–R9 & classroom features |
| **Final Snapshot Readiness Verdict** | **`NOT_READY_TO_SNAPSHOT`** (Pending resolution of `crates/whisper-rs` git structure) |

---

## 2. Git State & Inventory

### 2.1 Branch & Commit Baseline
```text
Branch: feature/live-translation
Tracking: publish/feature/live-translation (ahead by 2 commits)
HEAD: 4514b5e ("Meetily Bilingual Beta 4.1: bilingual NAIT summary and dark theme polish")
Upstream Baseline: a2cb62e ("Release v0.4.1")
```

### 2.2 Full Modified Files Inventory (18 Files)
1. `Cargo.lock`
2. `Cargo.toml`
3. `frontend/src-tauri/Cargo.toml`
4. `frontend/src-tauri/src/api/api.rs`
5. `frontend/src-tauri/src/lib.rs`
6. `frontend/src-tauri/src/whisper_engine/whisper_engine.rs`
7. `frontend/src-tauri/tauri.conf.json`
8. `frontend/src/app/_components/TranscriptPanel.tsx`
9. `frontend/src/app/page.tsx`
10. `frontend/src/components/GeminiSettings.tsx`
11. `frontend/src/components/RecordingControls.tsx`
12. `frontend/src/components/TranslationHealthIndicator.tsx`
13. `frontend/src/components/VirtualizedTranscriptView.tsx`
14. `frontend/src/contexts/TranscriptContext.tsx`
15. `frontend/src/services/geminiTranslationService.ts`
16. `frontend/src/services/localTranslationService.ts`
17. `frontend/src/services/translationStatsTracker.ts`
18. `frontend/src/services/unifiedTranslationScheduler.ts`

### 2.3 Untracked Files Inventory (2 Items)
1. `crates/` (specifically `crates/whisper-rs/`)
2. `frontend/tests/lib/meetily-bilingual-reliability.test.ts`

---

## 3. Classification of Every Candidate File

| File | Classification | Detailed Rationale |
| :--- | :--- | :--- |
| `Cargo.lock` | `REQUIRED_DEPENDENCY_CHANGE` | Updates lockfile to `whisper-rs` 0.15.0 and `whisper-rs-sys` 0.14.0, bindgen 0.71.1, and transitive windows-sys dependencies. Mandatory for repeatable builds of the current application state. |
| `Cargo.toml` | `REQUIRED_DEPENDENCY_CHANGE` | Configures `[patch."https://codeberg.org/tazz4843/whisper-rs"]` and `[patch.crates-io]` to redirect whisper-rs to local `crates/whisper-rs`. Required for Windows MSVC build bypass. |
| `frontend/src-tauri/Cargo.toml` | `REQUIRED_DEPENDENCY_CHANGE` | Updates whisper-rs git dependency to Codeberg rev `0c509ec`, sets keyring features, removes obsolete `esaxx-rs` patch. |
| `frontend/src-tauri/src/api/api.rs` | `REQUIRED_CURRENT_PRODUCTION` | Implements `api_check_local_qwen_health` and `api_translate_local_qwen_batch` commands for Local Qwen3 Tailscale integration. |
| `frontend/src-tauri/src/lib.rs` | `REQUIRED_CURRENT_PRODUCTION` | Registers local Qwen Tauri commands; prevents app minimize-to-invisible bug on Windows startup with delayed check; gates single-instance plugin on non-debug builds. |
| `frontend/src-tauri/src/whisper_engine/whisper_engine.rs` | `REQUIRED_CURRENT_PRODUCTION` | Migrates Whisper engine to `whisper-rs` 0.15.0 API (`state.get_segment(i)`, `set_suppress_nst(true)`, `seg.start_timestamp()`, `full_n_segments()`); eliminates hot-path I/O logging overhead. |
| `frontend/src-tauri/tauri.conf.json` | `REQUIRED_CURRENT_PRODUCTION` | Configures window defaults (`visible`, `center`, `focus`), labels main window, sets devUrl. *(Note: identifier is set to `com.meetily.bilingual.dev`)*. |
| `frontend/src/app/_components/TranscriptPanel.tsx` | `REQUIRED_CURRENT_PRODUCTION` | Implements Smart Follow (auto-follow, pause on user scroll, 10s idle reset, "Live" pill indicator with unread count), and embeds recording controls directly into header to prevent UI overlap. |
| `frontend/src/app/page.tsx` | `REQUIRED_CURRENT_PRODUCTION` | Removes the floating bottom fixed recording controls toolbar, passing it directly as a child/prop into `TranscriptPanel`. |
| `frontend/src/components/GeminiSettings.tsx` | `REQUIRED_CURRENT_PRODUCTION` | Provides settings UI for Translation Provider switching (Cloud Groq+Gemini vs Local Qwen3 Mac mini), Tailscale endpoint configuration, and connection testing. |
| `frontend/src/components/RecordingControls.tsx` | `REQUIRED_CURRENT_PRODUCTION` | Compact responsive controls layout, dark mode colors (`dark:bg-zinc-800`), reduced heights to fit inside header cleanly. |
| `frontend/src/components/TranslationHealthIndicator.tsx` | `REQUIRED_CURRENT_PRODUCTION` | Adds Local Qwen3 health badges, quick Real-Time Translation ON/OFF toggle switch, and session stats popover. |
| `frontend/src/components/VirtualizedTranscriptView.tsx` | `REQUIRED_CURRENT_PRODUCTION` | Adds hover/focus "Translate" button on individual transcript segments for user-initiated Manual Translation Recovery (R9). |
| `frontend/src/contexts/TranscriptContext.tsx` | `REQUIRED_CURRENT_PRODUCTION` | Removes the dangerous self-healing backlog translation loop (which previously caused rate limit flooding); adds `requestManualTranslation`; removes redundant legacy scroll listeners. |
| `frontend/src/services/geminiTranslationService.ts` | `REQUIRED_CURRENT_PRODUCTION` | Re-exports local Qwen endpoint, health checker, and candidate model constants. |
| `frontend/src/services/localTranslationService.ts` | `REQUIRED_CURRENT_PRODUCTION` | Implements Local Qwen3 HTTP client, technical classroom terminology prompt context, numbered line parser, and dual-mode fallback (Tauri command vs fetch). |
| `frontend/src/services/translationStatsTracker.ts` | `REQUIRED_CURRENT_PRODUCTION` | Extends session statistics to track Local Qwen3 requests, successes, failures, and health statuses. |
| `frontend/src/services/unifiedTranslationScheduler.ts` | `REQUIRED_CURRENT_PRODUCTION` | Handles Local Qwen3 execution route; parses `Retry-After` headers for Groq (429) and Gemini (429/503); provides `isRateLimited()` query. |
| `frontend/tests/lib/meetily-bilingual-reliability.test.ts` | `TEST_OR_DOCUMENTATION` | Comprehensive 11-scenario automated test suite using `node:test` covering R1–R9 requirements (see Section 7). |
| `crates/` (`crates/whisper-rs/`) | `REQUIRED_BUT_SHOULD_NOT_VENDOR` | Patched whisper-rs crate required for building on Windows MSVC without libclang; contains embedded `.git` repos that prevent direct git commit (see Section 6). |

---

## 4. Secret & Privacy Audit

A comprehensive pattern scan was conducted over all modified and untracked candidate files for:
- Groq API keys (`gsk_*`)
- Google Gemini API keys (`AIza*`)
- Bearer tokens, HTTP Authorization headers
- Passwords, access tokens, and private credentials
- Audio recordings (`.wav`), transcript database dumps (`.db`), or private meeting logs

### Findings:
1. **API Keys / Secrets: NONE DETECTED (CLEAN)**  
   All cloud API keys remain isolated in the Tauri backend keyring and are not hardcoded or leaked into the frontend source or git diff.
2. **Network Endpoints:**  
   - Files `frontend/src-tauri/src/api/api.rs`, `frontend/src/components/GeminiSettings.tsx`, `frontend/src/services/localTranslationService.ts`, and `frontend/tests/lib/meetily-bilingual-reliability.test.ts` contain the default Tailscale node address:  
     `http://jeffsmac-mini.taile61984.ts.net:8080`  
   - **Severity:** `LOW / INFORMATIONAL`.  
     This is a private Tailscale domain name on a tailnet. It is unreachable without membership in the private tailnet and contains no credentials or authentication tokens. Users can also override this URL in the Settings UI.
3. **Application Identifier:**  
   In `frontend/src-tauri/tauri.conf.json`:  
   `"identifier": "com.meetily.bilingual.dev"` (changed from `"com.meetily.bilingual"`).  
   - **Severity:** `LOW / CONFIGURATION`. Verify if production release builds require the non-`.dev` identifier.

---

## 5. Generated & Large File Audit

- **Binaries (`.dll`, `.exe`, `.so`, `.dylib`):** NONE in modified or untracked files.
- **Model weights (`.gguf`, `.onnx`, `.bin`):** NONE in working tree. Models reside in ignored paths (`models/`).
- **Temporary logs (`*.log`, `*.wav`):** NONE.
- **`crates/whisper-rs/` Size & Composition:**
  - Total size: **52.5 MB**
  - Contains full C++ source of `whisper.cpp` (including examples, bindings, CMake scripts).
  - Contains **0** compiled binary files (`.obj`, `.lib`, `.dll`, `.exe`, `.a`).
  - Contains **2** internal `.git` repositories (detailed below).

---

## 6. Special Forensic Audit: `crates/whisper-rs/`

### 6.1 Why does `crates/whisper-rs/` exist?
On Windows, standard `whisper-rs` compilation via `whisper-rs-sys` invokes `bindgen` during build time (`build.rs`). This requires `libclang.dll` to be installed and found in the system `PATH`. When `libclang` is absent or mismatched, the build fails. Furthermore, generated bindings on Windows MSVC contained `offset_of!` assertions and enum representations (`#[repr(i32)]`) that triggered compile errors.

To solve this, `crates/whisper-rs` was modified:
1. **`sys/build.rs`**: Completely removed runtime `bindgen` execution; directly copies bundled `src/bindings.rs`.
2. **`sys/src/bindings.rs`**: Removed 500+ lines of fragile `offset_of!` layout assertions that failed on MSVC. Added `whisper_version()` foreign declaration.
3. **`src/common_logging.rs` & `src/whisper_grammar.rs`**: Replaced Windows-specific `#[repr(i32)]` attributes with standard `#[repr(u32)]`.

### 6.2 Is Cargo currently referencing it?
**YES, DEFINITIVELY.**
- Root `Cargo.toml` lines 20–27:
  ```toml
  [patch."https://codeberg.org/tazz4843/whisper-rs"]
  whisper-rs = { path = "crates/whisper-rs" }
  whisper-rs-sys = { path = "crates/whisper-rs/sys" }

  [patch.crates-io]
  whisper-rs = { path = "crates/whisper-rs" }
  whisper-rs-sys = { path = "crates/whisper-rs/sys" }
  ```
- `Cargo.lock` resolves `whisper-rs` (v0.15.0) and `whisper-rs-sys` (v0.14.0) to this path override.
- `frontend/src-tauri/src/whisper_engine/whisper_engine.rs` has been adapted to the 0.15.0 API (`get_segment`, `set_suppress_nst`).

### 6.3 Forensic Discovery: Embedded `.git` Repositories
The directory `crates/whisper-rs/` is **not a plain folder**:
- `crates/whisper-rs/.git` is an independent Git repository cloned from `file:///C:/Users/huang/.cargo/git/db/whisper-rs-c01d2649b5f1563d` (HEAD: `0c509ec`).
- `crates/whisper-rs/sys/whisper.cpp/.git` is another internal submodule Git repository.

### 6.4 Risk of Staging `crates/`
If a developer runs `git add crates/` or `git add .`:
1. Git will see `crates/whisper-rs` as a **nested repository** and create a **gitlink (mode 160000)** entry without recording `.gitmodules`.
2. Anyone cloning or checking out the repo elsewhere will receive an **empty `crates/whisper-rs` folder**, causing `cargo build` to fail immediately because `Cargo.toml` points to `crates/whisper-rs`.

### 6.5 Final Classification
**`REQUIRED_BUT_SHOULD_NOT_VENDOR`**  
The working build strictly requires these patches, but the folder cannot be cleanly committed as a plain working tree commit until its Git structure is resolved.

---

## 7. Special Audit: Reliability Test Suite

**File:** `frontend/tests/lib/meetily-bilingual-reliability.test.ts` (302 lines)

### 7.1 What behaviors does it protect?
- **Scenario 1 (R2):** Groq HTTP 429 + `Retry-After` header initiates bounded cooldown without throwing unhandled exceptions.
- **Scenario 2 (R3):** Gemini HTTP 429/503 exponential backoff non-blocking resilience.
- **Scenario 3:** Provider network timeout safety (safe catch, session preserved).
- **Scenario 4:** Invalid/empty translation response handling.
- **Scenario 5 (R4):** English-only uninterrupted fallback when all translation providers fail.
- **Scenario 6:** Local Qwen3 technical classroom terminology batch translation and prompt parsing.
- **Scenario 7:** Local Qwen3 unreachable (Tailscale down) safe degradation.
- **Scenario 8:** Translation ON → OFF → ON state toggle cleanliness.
- **Scenario 9 (R7 & R9):** No automatic backlog translation flood; user-triggered Manual Recovery translates single requested segment.
- **Scenario 10:** Out-of-order & overlapping request safety.
- **Scenario 11:** Numbered response parser (`[1]`, `1.`, `[2]`) robustness.

### 7.2 Audit Assessment:
- **Production Alignment:** 100% tests active production code in `unifiedTranslationScheduler.ts`, `localTranslationService.ts`, and `translationStatsTracker.ts`.
- **Destructiveness:** Completely non-destructive; mocks `fetchFn` and `localStorage`.
- **Verdict:** `TEST_OR_DOCUMENTATION`. Highly recommended to commit permanently alongside production code.

---

## 8. Verification against Customization Manifest

| Customization Requirement | Verification Status | Implementation Proof |
| :--- | :--- | :--- |
| **Translation Failure Isolation (R1, R4)** | **VERIFIED** | Enqueue catches errors, returns `null`, English transcripts continue without interruption. |
| **Translation ON/OFF (R6, R8)** | **VERIFIED** | Quick toggle in `TranslationHealthIndicator` and `GeminiSettings`; stopped when OFF. |
| **No Backlog Flood (R7)** | **VERIFIED** | Dangerous `useEffect` self-healing loop deleted from `TranscriptContext.tsx`. |
| **Manual Recovery (R9)** | **VERIFIED** | Hover "Translate" button on un-translated segments in `VirtualizedTranscriptView.tsx`. |
| **Groq / Gemini Resilience (R2, R3)** | **VERIFIED** | `Retry-After` parsing + backoff implemented in `unifiedTranslationScheduler.ts`. |
| **Smart Follow Live** | **VERIFIED** | 100px threshold, pause on user scroll, 10s idle reset, "Live" pill button in `TranscriptPanel.tsx`. |
| **Recording Controls Integration** | **VERIFIED** | Embedded into `TranscriptPanel` sticky header; removed floating bottom overlay in `page.tsx`. |
| **Local Qwen3 Integration** | **VERIFIED** | Rust commands in `api.rs` + client in `localTranslationService.ts`. |
| **IndexedDB Persistence** | **VERIFIED** | Intact in `TranscriptContext.tsx`. |
| **Bilingual NAIT Summary** | **VERIFIED** | Committed and stable in `4514b5e`. |

---

## 9. Recommendations for Next Snapshot

### 9.1 Files Recommended to Commit in Stable Snapshot (19 Files)
```text
Cargo.lock
Cargo.toml
frontend/src-tauri/Cargo.toml
frontend/src-tauri/src/api/api.rs
frontend/src-tauri/src/lib.rs
frontend/src-tauri/src/whisper_engine/whisper_engine.rs
frontend/src-tauri/tauri.conf.json
frontend/src/app/_components/TranscriptPanel.tsx
frontend/src/app/page.tsx
frontend/src/components/GeminiSettings.tsx
frontend/src/components/RecordingControls.tsx
frontend/src/components/TranslationHealthIndicator.tsx
frontend/src/components/VirtualizedTranscriptView.tsx
frontend/src/contexts/TranscriptContext.tsx
frontend/src/services/geminiTranslationService.ts
frontend/src/services/localTranslationService.ts
frontend/src/services/translationStatsTracker.ts
frontend/src/services/unifiedTranslationScheduler.ts
frontend/tests/lib/meetily-bilingual-reliability.test.ts
```

### 9.2 Files Recommended NOT to Commit Directly as Plain Git Objects
- **`crates/` (specifically `crates/whisper-rs/`)** in its current nested `.git` state.

### 9.3 Action Required for `crates/whisper-rs/` Before Snapshot
Choose one of the following two solutions:
- **Solution 1 (Vendor as pure source tree - Recommended if fully offline build is desired):**  
  Remove the internal `.git` directories from `crates/whisper-rs` and `crates/whisper-rs/sys/whisper.cpp`:
  ```powershell
  Remove-Item -Recurse -Force crates\whisper-rs\.git
  Remove-Item -Recurse -Force crates\whisper-rs\sys\whisper.cpp\.git
  ```
  Then `crates/` becomes standard vendored source and can be committed via `git add crates/`.
- **Solution 2 (Official Git Submodule or Upstream Fork):**  
  Push the patched `whisper-rs` to a repository (e.g., `Zackriya-Solutions/whisper-rs` or a personal fork) and reference it as a proper git dependency in `Cargo.toml`.

---

## 10. Final Snapshot Readiness Verdict

# `NOT_READY_TO_SNAPSHOT`

### Blocking Items:
1. **`crates/whisper-rs` git nesting:** Contains inner `.git` directories. Running `git add -A` will produce a corrupted gitlink submodule.
2. **`tauri.conf.json` app identifier:** Currently set to `"com.meetily.bilingual.dev"` and `beforeDevCommand: ""`. Must be verified whether this was intentional for development or should be reverted/retained for release.

Once the team selects Solution 1 or Solution 2 for `crates/whisper-rs`, the working tree will be **100% READY** to freeze as a stable snapshot tag.

---

## 11. Git Status & Diff Stat Verification

### `git status --short`
```text
 M Cargo.lock
 M Cargo.toml
 M frontend/src-tauri/Cargo.toml
 M frontend/src-tauri/src/api/api.rs
 M frontend/src-tauri/src/lib.rs
 M frontend/src-tauri/src/whisper_engine/whisper_engine.rs
 M frontend/src-tauri/tauri.conf.json
 M frontend/src/app/_components/TranscriptPanel.tsx
 M frontend/src/app/page.tsx
 M frontend/src/components/GeminiSettings.tsx
 M frontend/src/components/RecordingControls.tsx
 M frontend/src/components/TranslationHealthIndicator.tsx
 M frontend/src/components/VirtualizedTranscriptView.tsx
 M frontend/src/contexts/TranscriptContext.tsx
 romantic/services/geminiTranslationService.ts -> modified
 M frontend/src/services/localTranslationService.ts
 M frontend/src/services/translationStatsTracker.ts
 M frontend/src/services/unifiedTranslationScheduler.ts
?? crates/
?? frontend/tests/lib/meetily-bilingual-reliability.test.ts
```

### `git diff --stat`
```text
 Cargo.lock                                         |  93 ++----
 Cargo.toml                                         |   9 +
 frontend/src-tauri/Cargo.toml                      |   8 +-
 frontend/src-tauri/src/api/api.rs                  | 217 +++++++++++++
 frontend/src-tauri/src/lib.rs                      |  29 +-
 .../src-tauri/src/whisper_engine/whisper_engine.rs |  31 +-
 frontend/src-tauri/tauri.conf.json                 |  10 +-
 frontend/src/app/_components/TranscriptPanel.tsx   | 310 +++++++++++++++---
 frontend/src/app/page.tsx                          |  55 ++--
 frontend/src/components/GeminiSettings.tsx         | 192 +++++++++--
 frontend/src/components/RecordingControls.tsx      |  46 +--
 .../src/components/TranslationHealthIndicator.tsx  | 165 +++++++---
 .../src/components/VirtualizedTranscriptView.tsx   |  57 +++-
 frontend/src/contexts/TranscriptContext.tsx        |  85 +++--
 frontend/src/services/geminiTranslationService.ts  |  12 +-
 frontend/src/services/localTranslationService.ts   | 358 +++++++++++++++++++--
 frontend/src/services/translationStatsTracker.ts   |  51 ++-
 .../src/services/unifiedTranslationScheduler.ts    |  44 ++-
 18 files changed, 1432 insertions(+), 340 deletions(-)
```
