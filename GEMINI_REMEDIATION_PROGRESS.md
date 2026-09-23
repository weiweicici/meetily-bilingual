# Meetily Bilingual 修复进度追踪 (GEMINI_REMEDIATION_PROGRESS.md)

**创建日期**: 2026-09-19  
**最后更新**: 2026-09-20（最终差异审计、依赖归属核查与冒烟测试准备）  
**目标分支**: `feature/live-translation`  
**遵循计划**: `GEMINI_REMEDIATION_PLAN.md`  
**约束准则**: 严格遵守硬边界，数据可恢复、幂等，mock 与合成数据测试验证，不修改归档 backend、音频底层与转录引擎；禁止将 SQLite 明文当作安全存储；受阻或未验证项如实单列；不提交、推送或调用真实 Gemini API。

---

## 总体状态概要 (Executive Status)

- **阶段 0（基线核验）**: 已完成。`cargo check --release` 退出码 0，`cargo check` 退出码 0（均依赖 `$env:LIBCLANG_PATH="C:\Users\huang\llvm-18\bin"`，未修改系统变量）。
- **阶段 1（转录与译文对应）**: **已完成并通过验收测试**（5/5）。
- **阶段 2（统一调度与错误处理）**: **已完成并通过验收测试**（5/5）。
- **阶段 3（SQLite 持久化与旧数据迁移）**: **已完成并通过真实数据库集成测试**（10/10）。
- **阶段 4（密钥存储与明确云端授权）**: **已完成并通过安全验收测试**（11/11）。最终 `#[cfg(test)]` 边界整改完成，mock 基础设施从生产路径彻底移除。
- **阶段 5（界面与性能收尾）**: **已完成**。

---

## 最终差异审计 — 文件归属表

### 已修改文件（`git diff HEAD`，共 25 个文件）

| 文件 | 归属类别 | 说明 |
| :--- | :--- | :--- |
| `Cargo.lock` | 本次整改 | `keyring 3.6.3`、`lazy_static` 等新依赖锁定 |
| `frontend/pnpm-lock.yaml` | **用户任务开始前已有改动**（见下文 §pnpm-lock 归属说明；本次整改未引入任何新 npm 依赖） |
| `frontend/src-tauri/Cargo.toml` | 本次整改 | 按平台显式配置 `keyring 3.6.3` 三平台依赖 |
| `frontend/src-tauri/src/api/api.rs` | 本次整改 | 新增 `TranscriptSegment.translation`、翻译存储与安全凭据 Tauri commands |
| `frontend/src-tauri/src/audio/common.rs` | translation 字段适配（必须） | 见下文专项说明 |
| `frontend/src-tauri/src/audio/import.rs` | translation 字段适配（必须） | 测试中 `TranscriptSegment` 字面量补 `translation: None` |
| `frontend/src-tauri/src/audio/recording_preferences.rs` | 用户任务开始前已有改动 | 录音目录名从 `meetily-recordings` 改为 `meetily-bilingual-recordings` |
| `frontend/src-tauri/src/database/models.rs` | 本次整改 | `Transcript` struct 新增 `translation: Option<String>` |
| `frontend/src-tauri/src/database/repositories/meeting.rs` | 本次整改 | `get_meeting` 读取 `translation` 字段 |
| `frontend/src-tauri/src/database/repositories/transcript.rs` | 本次整改 | `save_transcript` 写入 `translation`；新增幂等更新与批量写入 |
| `frontend/src-tauri/src/lib.rs` | 本次整改 | 注册翻译与凭据 Tauri commands，导出 `pub mod credentials` |
| `frontend/src-tauri/src/notifications/settings.rs` | 用户任务开始前已有改动 | 配置目录从 `meetily` 改为 `meetily-bilingual` |
| `frontend/src-tauri/tauri.conf.json` | 用户任务开始前已有改动 | 产品名、标识符、标题及 CSP 中 Gemini API 域名 |
| `frontend/src/app/_components/TranscriptPanel.tsx` | 本次整改 | 双语显示适配 |
| `frontend/src/components/MeetingDetails/TranscriptButtonGroup.tsx` | 本次整改 | 复制按钮支持双语格式 |
| `frontend/src/components/MeetingDetails/TranscriptPanel.tsx` | 本次整改 | 会话隔离、SQLite 写入、旧数据迁移触发 |
| `frontend/src/components/PreferenceSettings.tsx` | 本次整改 | 接入 `GeminiSettings` 组件入口 |
| `frontend/src/components/VirtualizedTranscriptView.tsx` | 本次整改 | 双语显示、动态高度估算 |
| `frontend/src/contexts/TranscriptContext.tsx` | 本次整改 | 会话隔离、partial 过滤、调度器接入 |
| `frontend/src/hooks/meeting-details/useCopyOperations.ts` | 本次整改 | 复制时优先使用 SQLite `t.translation` |
| `frontend/src/hooks/usePaginatedTranscripts.ts` | 本次整改 | 映射 `translation` 字段 |
| `frontend/src/hooks/useRecordingStop.ts` | 本次整改 | 停录时合并翻译并一次性提交至 SQLite |
| `frontend/src/services/storageService.ts` | 本次整改 | 封装 `saveTranscriptTranslation`、`batchSaveTranslations` |
| `frontend/src/types/index.ts` | 本次整改 | `Transcript`、`TranscriptSegmentData` 新增 `translation?: string` |
| `frontend/tsconfig.json` | 本次整改 | 添加 `allowImportingTsExtensions` 支持 Node 原生测试 |

### 新增文件（Untracked，共 15 个文件）

| 文件 | 归属类别 | 说明 |
| :--- | :--- | :--- |
| `AGENTS.md` | 用户任务开始前已有 | 项目规范文档 |
| `GEMINI_REMEDIATION_PLAN.md` | 用户任务开始前已有 | 整改方案 |
| `GEMINI_REMEDIATION_PROGRESS.md` | 本次整改 | 本进度追踪文档 |
| `frontend/src-tauri/migrations/20260920000000_add_translation_to_transcripts.sql` | 本次整改 | 幂等 SQLite schema 迁移 |
| `frontend/src-tauri/src/credentials.rs` | 本次整改 | 跨平台安全凭据管理器 |
| `frontend/src/components/GeminiSettings.tsx` | 本次整改 | Gemini API Key 配置 UI |
| `frontend/src/services/geminiTranslationService.ts` | 本次整改 | 翻译服务，接入调度器与安全凭据 |
| `frontend/src/services/legacyTranslationMigration.ts` | 本次整改 | localStorage → SQLite 幂等迁移 |
| `frontend/src/services/translationSessionTracker.ts` | 本次整改 | 会话隔离与去重追踪 |
| `frontend/src/services/unifiedTranslationScheduler.ts` | 本次整改 | 统一调度、错误处理、限速 |
| `frontend/tests/lib/gemini-authorization-and-storage.test.ts` | 本次整改 | Phase 4 安全验收（11项） |
| `frontend/tests/lib/legacy-translation-migration.test.ts` | 本次整改 | Phase 3 迁移测试（4项） |
| `frontend/tests/lib/sqlite-translation-integration.test.ts` | 本次整改 | 真实 SQLite 集成测试（6项） |
| `frontend/tests/lib/translation-session-tracker.test.ts` | 本次整改 | Phase 1 验收（5项） |
| `frontend/tests/lib/unified-translation-scheduler.test.ts` | 本次整改 | Phase 2 验收（5项） |

---

## pnpm-lock.yaml 归属说明

**结论：`frontend/pnpm-lock.yaml` 的改动属于用户任务开始前已有改动，本次整改未引入任何新 npm 依赖。**

- `package.json` 在 HEAD 与当前工作区均**无 `better-sqlite3` 或任何 sqlite 相关 npm 依赖**（经 `git diff HEAD -- frontend/package.json` 与 `package.json` 内容核验，均无结果）。
- 所有 SQLite 集成测试（`sqlite-translation-integration.test.ts`）使用 Node.js 24 内置模块 `node:sqlite`（`import { DatabaseSync } from 'node:sqlite'`），不依赖任何 npm 包。
- `pnpm-lock.yaml` 的 917 行 diff 内容为 `supports-color@8.1.1` peer-dependency 传播及 `prosemirror-*` overrides 条目删除——系用户在本任务开始前执行的 `pnpm install` 或依赖升级产生，与本次整改无关。
- 前一版本进度报告将 `pnpm-lock.yaml` 归属为"本次整改（better-sqlite3 等测试依赖锁定）"是**错误描述**，此处予以纠正。

---

## audio/common.rs 修改专项说明

**变更位置**: `frontend/src-tauri/src/audio/common.rs`，函数 `create_transcript_segments`，第 66 行。  
**变更内容**: 在 `TranscriptSegment { ... }` 字面量中补加 `translation: None`（共 1 行）。  
**原因**: 本次整改在 `api::TranscriptSegment` 结构体（`frontend/src-tauri/src/api/api.rs:182`）新增了 `pub translation: Option<String>` 字段。  
`common.rs` 中的 `create_transcript_segments()` 函数构造 `api::TranscriptSegment` 的实例（通过 `use crate::api::api::TranscriptSegment`），Rust 结构体字面量语法不允许省略字段，故必须在此处显式指定 `translation: None`，否则编译报错。  
**此修改与音频采集、混音、VAD 及转录引擎行为完全无关**，仅为编译适配，不影响任何音频逻辑路径。

---

## TranscriptSegment 构造点完整核查

共发现两种完全独立的 `TranscriptSegment` 结构体：

### A. `api::TranscriptSegment`（含 `translation` 字段）
**定义**: `frontend/src-tauri/src/api/api.rs:182`，包含 `translation: Option<String>`。

| 构造位置 | `translation` 处理 | 状态 |
| :--- | :--- | :--- |
| `audio/common.rs:59`（`create_transcript_segments`） | `translation: None` | ✅ 已适配 |
| `audio/import.rs:1178,1187`（单元测试）| `translation: None` | ✅ 已适配 |

### B. `audio::recording_saver::TranscriptSegment`（无 `translation` 字段）
**定义**: `frontend/src-tauri/src/audio/recording_saver.rs:16`。这是录音机内部独立结构体，用于音频文件写入路径，字段完全不同（含 `display_time`, `confidence`, `sequence_id`），与 `api::TranscriptSegment` 无共享关系。  
**结论**: 不需要适配，也不应添加 `translation` 字段，不影响编译。

| 构造位置 | 类型 | 是否需要适配 |
| :--- | :--- | :--- |
| `audio/recording_commands.rs:446` | `recording_saver::TranscriptSegment` | ❌ 无需（独立类型） |
| `audio/recording_commands.rs:633` | `recording_saver::TranscriptSegment` | ❌ 无需（独立类型） |
| `audio/recording_saver.rs:121` | `recording_saver::TranscriptSegment` | ❌ 无需（独立类型） |

---

## 凭据模块 `#[cfg(test)]` 边界审计

### 整改前存在的问题
`MockFailureMode`、`MockStoreState`、`MOCK_STORE`、`USE_MOCK_STORE`、`set_mock_mode`、`reset_mock_store`、`set_mock_failure_mode` 等 mock 基础设施在整改前位于生产作用域，在 release 构建中虽为死代码但会被编译进去，违反了"mock 不进生产路径"原则。

### 整改后状态（最终版 `credentials.rs`）

| 类别 | 编译范围 | 说明 |
| :--- | :--- | :--- |
| `CREDENTIAL_MUTEX`（`TokioMutex<()>`） | 生产 + 测试 | 正常，用于串行化真实凭据操作 |
| `constant_time_eq()` | 生产 + 测试 | 正常，纯函数，无敏感状态 |
| `MockFailureMode`、`MockStoreState`、`MOCK_STORE`、`USE_MOCK_STORE` | **`#[cfg(test)]` only** | ✅ 已整改，release 构建中不存在 |
| `set_mock_mode`、`reset_mock_store`、`set_mock_failure_mode` | **`#[cfg(test)]` only** | ✅ 已整改，release 构建中不存在 |
| `set_raw_sync`、`get_raw_sync`、`delete_raw_sync` 中 mock 分支 | **`#[cfg(test)]` 条件块** | ✅ 已整改，`#[cfg(test)] if ...` 块在 release 被静态消除 |
| `mod tests { ... }` | **`#[cfg(test)]` only** | ✅ 正常 |
| API Key 字段 | 无 `Debug`/`Serialize`，无 `log!`/`info!` 调用 | ✅ 已验证，不泄露到日志或 Debug 输出 |

**验证**：`cargo check --release` 退出码 0，release 构建下无 mock 相关代码。  
**测试**：`cargo test ... credentials`（仅在 test 构建激活 mock）10/10 通过。

---

## 阶段 0：建立事实和验证基线 (Phase 0)

### 0.1 分支与工作区基线
- **当前分支**: `feature/live-translation`
- **工作区未提交改动**: 保留全部现有改动，不执行任何 reset/checkout。
- **构建与测试工具链核验**:
  - 前端 TypeScript: `pnpm tsc --noEmit` 退出码 0，无类型错误。
  - Rust 后端 `cargo check --release`: **通过 (Exit Code 0)**（2m 12s）。
  - Rust 后端 `cargo check`（debug）: **通过 (Exit Code 0)**。
    - 验证方式: 在当前终端设置 `$env:LIBCLANG_PATH="C:\Users\huang\llvm-18\bin"`，未修改系统环境变量。
  - Rust 后端单元测试:
    - `cargo test --manifest-path frontend/src-tauri/Cargo.toml credentials`: **10/10 全部通过 (Exit Code 0)**。
    - `cargo test --manifest-path frontend/src-tauri/Cargo.toml`（全量）: **248 passed, 7 failed**（7 项既有 VAD 测试因本地 `onnxruntime.dll` 1.17.1 与 `ort 2.0.0-rc.10` 版本不匹配失败，严格遵守规则未修改音频/VAD 代码）。
  - Rust 代码格式: `credentials.rs` 格式完全合规（无 `rustfmt` 警告）。
  - 测试运行器: Node.js v24.19.0，5 套件 31 项测试全部通过 (Exit Code 0)。

### 0.2 代码事实与官方文档核验表

| 核验事项 | 审计推测 | 代码核验与官方文档实际情况 | 影响与设计决策 |
| :--- | :--- | :--- | :--- |
| **`is_partial` 来源与语义** | Whisper 临时片段 | `audio/transcription/worker.rs` 发送 `transcript-update`，其中包含 `is_partial: bool`。每次发送都会递增 `SEQUENCE_COUNTER`。 | 必须仅对 `!is_partial` 且已确认最终的片段发起翻译，避免碎片锁定与无谓网络开销。 |
| **`sequence_id` 作用域** | 会议内片段序号 | `worker.rs` 中为全局静态 `AtomicU64`，跨会议累加不重置。**未存入 SQLite `transcripts` 表**。 | `sequence_id` 仅在单次录制会话期有效；持久化必须依托稳定的 `transcript_id` 或基于会议范围对账。 |
| **持久化实际位置** | SQLite 缺失 / 存在于 localStorage | SQLite `transcripts` 表目前**无 `translation` 列**；前端将翻译全部保存在 `localStorage['meetily_translations_' + meetingId]`。历史会议回显完全依赖 `translationMap[text.trim()]`。 | `localStorage` 5MB 配额必将超限（P0）。必须通过 SQLite 增量存储翻译，并提供幂等可恢复迁移。 |
| **API Key 存储机制** | localStorage 明文 | 原存在于 `localStorage['gemini_api_key']`。原先尝试写入 SQLite `settings` 表的方案被否决，因为 SQLite 为未加密明文存储。 | 必须将生产凭据定位至 OS Keyring 且显式按平台配置 feature。 |
| **Google Gemini 模型核验 (2026-09-20)** | 1.5/2.0 vs 3.x 存疑 | 查验 Google AI 官方文档：`gemini-2.5-flash` 为主流低延迟推荐模型，`gemini-2.5-flash-lite` 为超轻量备选。`gemini-2.0` 系列大多已弃用。 | 仅保留最小候选集 `['gemini-2.5-flash', 'gemini-2.5-flash-lite']`。不把 404 作为常规模型发现机制。 |
| **调度与并发控制** | 实时无队列，补译有延时 | `TranscriptContext.tsx` 每次事件直接启动异步 IIFE，无并发上限；`TranscriptPanel.tsx` 串行 350ms 延时。 | 阶段 2 需统一调度队列，并发设为 1，支持有界队列、429 退避与平滑调度。 |

---

## 阶段 1：转录与译文对应正确性 (Phase 1)
- **状态**: 已完成并通过验收测试
- **问题证据**:
  1. `onTranscriptUpdate` 与 `addTranscript` 无条件对 `is_partial` 临时片段发起翻译，导致半截话被锁定或产生重复无效请求。
  2. 原代码以 `sessionStorage['last_saved_meeting_id']` 作为实时翻译的归属会议，导致新会议录制时翻译被串写存入上一场会议的 `localStorage`。
  3. `TranscriptPanel.tsx` 补译循环缺少会议切换中断防护，切换会议后旧会议的异步响应会继续写回当前视图。
- **修改文件**:
  - `frontend/src/services/translationSessionTracker.ts` [NEW]
  - `frontend/src/contexts/TranscriptContext.tsx`
  - `frontend/src/components/MeetingDetails/TranscriptPanel.tsx`
  - `frontend/tsconfig.json`
  - `frontend/tests/lib/translation-session-tracker.test.ts` [NEW]
- **实际验证结果**:
  - `pnpm tsc --noEmit`: 退出码 0。
  - `node --experimental-strip-types --test tests/lib/translation-session-tracker.test.ts`: 5/5 通过。

---

## 阶段 2：统一请求调度及模型错误处理 (Phase 2)
- **状态**: 已完成并通过验收测试
- **问题证据**:
  1. 实时录制与历史补译使用独立的分散请求逻辑，并发无约束，极易突破 Gemini 免费层 15 RPM 限制触发 429。
  2. 原候选模型列表包含 `gemini-3.1-flash-lite` 与 `gemini-3.8-flash` 等非法名称，导致每次调用都必须先承受 404 失败再顺延重试。
  3. 原代码在 429 时尝试轮换模型，未能有效隔离配额耗尽与模型故障。
- **修改文件**:
  - `frontend/src/services/unifiedTranslationScheduler.ts` [NEW]
  - `frontend/src/services/geminiTranslationService.ts` [NEW]
  - `frontend/tests/lib/unified-translation-scheduler.test.ts` [NEW]
- **实际验证结果**:
  - `pnpm tsc --noEmit`: 退出码 0。
  - `node --experimental-strip-types --test tests/lib/unified-translation-scheduler.test.ts`: 5/5 通过。

---

## 阶段 3：SQLite 持久化与旧数据迁移 (Phase 3)
- **状态**: 已完成并通过真实数据库集成测试
- **修改文件**:
  - `frontend/src-tauri/migrations/20260920000000_add_translation_to_transcripts.sql` [NEW]
  - `frontend/src-tauri/src/database/models.rs`
  - `frontend/src-tauri/src/api/api.rs`
  - `frontend/src-tauri/src/database/repositories/transcript.rs`
  - `frontend/src-tauri/src/database/repositories/meeting.rs`
  - `frontend/src-tauri/src/lib.rs`
  - `frontend/src/types/index.ts`
  - `frontend/src/hooks/usePaginatedTranscripts.ts`
  - `frontend/src/components/VirtualizedTranscriptView.tsx`
  - `frontend/src/services/storageService.ts`
  - `frontend/src/hooks/useRecordingStop.ts`
  - `frontend/src/services/legacyTranslationMigration.ts` [NEW]
  - `frontend/src/components/MeetingDetails/TranscriptPanel.tsx`
  - `frontend/tests/lib/legacy-translation-migration.test.ts` [NEW]
  - `frontend/tests/lib/sqlite-translation-integration.test.ts` [NEW]
- **实际验证结果**:
  - `pnpm tsc --noEmit`: 退出码 0。
  - `node --experimental-strip-types --test tests/lib/legacy-translation-migration.test.ts`: 4/4 通过。
  - `node --experimental-strip-types --test tests/lib/sqlite-translation-integration.test.ts`: 6/6 通过（真实 SQLite 旧库升级、隔离、幂等）。

---

## 阶段 4：密钥存储与明确云端授权 (Phase 4)
- **状态**: **已完成并通过安全验收测试（含最终 #[cfg(test)] 整改）**
- **修复与安全实现**:
  1. **按目标平台显式配置 `keyring 3.6.3` 依赖**:
     - Windows: `features = ["windows-native"]` → Windows Credential Manager
     - macOS: `features = ["apple-native"]` → Apple Keychain Services
     - Linux: `features = ["sync-secret-service", "crypto-rust"]` → Freedesktop Secret Service（纯 Rust 加密，消除 `libssl-dev` 依赖）
     - `Cargo.lock` 100% 对齐，不升级 `keyring 4`。
  2. **原子迁移与核验回滚**:
     - 写入候选密钥 → 回读 → 常量时间比较核验 → 失败则回滚至旧凭据并返回 Err
     - 前端仅在收到 `Ok(())` 后清除 localStorage，失败时原值完整保留
  3. **无明文路径**:
     - API Key 不出现在 SQLite、localStorage、日志、错误消息、`Debug` 输出或前端状态中
     - API Key 未实现 `Debug`、`Serialize`；未传入任何 `log!`/`info!`/`debug!` 宏
  4. **`#[cfg(test)]` 边界整改**（最终轮完成）:
     - `MockFailureMode`、`MockStoreState`、`MOCK_STORE`、`USE_MOCK_STORE` 及三个 mock 控制方法全部移入 `#[cfg(test)]` 作用域
     - `set_raw_sync`/`get_raw_sync`/`delete_raw_sync` 中 mock 分支以 `#[cfg(test)] if ...` 隔离，release 构建静态消除
     - **release 构建验证**: `cargo check --release` 退出码 0，release 产物不含任何 mock 代码
- **修改文件**:
  - `frontend/src-tauri/Cargo.toml`
  - `frontend/src-tauri/src/credentials.rs` [NEW]
  - `frontend/src-tauri/src/lib.rs`
  - `frontend/src-tauri/src/api/api.rs`
  - `frontend/src/services/geminiTranslationService.ts`
  - `frontend/src/components/GeminiSettings.tsx` [NEW]
  - `frontend/tests/lib/gemini-authorization-and-storage.test.ts` [NEW]
- **实际验证结果**:
  - `cargo check --release`: **退出码 0**。
  - `cargo test ... credentials`: **10/10 全部通过 (Exit Code 0)**。
  - `pnpm tsc --noEmit`: 退出码 0。
  - `node --experimental-strip-types --test tests/lib/gemini-authorization-and-storage.test.ts`: **11/11 全部通过**。

---

## 阶段 5：界面与性能收尾 (Phase 5)
- **状态**: 已完成
- **修改文件**:
  - `frontend/src/components/GeminiSettings.tsx`
  - `frontend/src/components/VirtualizedTranscriptView.tsx`
  - `frontend/src/hooks/meeting-details/useCopyOperations.ts`
  - `frontend/src/components/MeetingDetails/TranscriptPanel.tsx`
- **实际验证结果**:
  - `pnpm tsc --noEmit`: 退出码 0，全量类型检查通过。
  - 翻译相关 5 个 Node 测试套件（31 项）100% 通过。全量 Rust 测试 248 passed / 7 failed（7 项为既有 VAD 失败，**全仓库测试未全部通过**）。macOS/Linux 仍未构建和运行验证。

---

## 自动化测试结果汇总（最终）

| 命令 | 退出码 | 结果 |
| :--- | :--- | :--- |
| `cargo check --release` (Windows x86_64) | **0** ✅ | 通过，含 9 个既有 lint 警告；mock 代码在 release 产物中已完全移除 |
| `cargo check` (debug) | **0** ✅ | 通过 |
| `cargo test ... credentials` | **0** ✅ | **10 passed, 0 failed** |
| `cargo test ...`（全量） | **1** ⚠️ | 248 passed, **7 failed**（全仓库测试**未全部通过**；7 项均为既有 `audio::vad` 失败，与本次整改无关） |
| `pnpm tsc --noEmit` | **0** ✅ | 0 类型错误 |
| Node 翻译相关 5 套件（31 项） | **0** ✅ | **31 passed, 0 failed** |
| macOS/Linux 原生构建与凭据运行时 | **未验证** ⚠️ | 仅 Windows x86_64 验证，macOS/Linux 待 CI 或对应系统验证 |

---

## 平台 Feature 映射与打包依赖报告

| 目标平台 | Cargo.toml 依赖配置 | 底层凭据提供者 | 编译构建依赖 | 运行时依赖 |
| :--- | :--- | :--- | :--- | :--- |
| **Windows** | `keyring = { version = "3.6.3", default-features = false, features = ["windows-native"] }` | Windows Credential Manager (`windows-sys`) | 无需额外 C/C++ 依赖 | Windows 7+ 系统自带凭据管理器 |
| **macOS** | `keyring = { version = "3.6.3", default-features = false, features = ["apple-native"] }` | Apple Keychain (`security-framework`) | macOS SDK (`Security.framework`) | macOS 系统自带钥匙串服务 |
| **Linux** | `keyring = { version = "3.6.3", default-features = false, features = ["sync-secret-service", "crypto-rust"] }` | Freedesktop Secret Service (`zbus`) | **纯 Rust 编译**（消除 `libssl-dev`） | `dbus-user-session` + Secret Service 守护者（`gnome-keyring`、`ksecretservice` 或 `keepassxc`） |

---

## Windows 手工冒烟测试清单

> **说明**
> - **A 节（离线凭据验证）**：使用假 Key（如 `smoke-test-fake-key-20260920`）即可，不涉及真实外网请求。验证保存、无明文泄露、重启持久性、删除与旧值迁移逻辑。
> - **B 节（翻译流量验证）**：使用假 Key 触发翻译仍会向 `generativelanguage.googleapis.com` 发出真实 HTTP 请求（将收到 401），**不属于「未调用真实 Gemini API」的范围**。此节须**单独执行**，仅在用户明确授权并提供自己的有效 Key 后进行，且只使用合成英文文本（如 `"Hello, this is a test."`），不得发送真实会议内容。

### A. 离线凭据功能验证（假 Key，无真实 API 调用）

#### A-1. 保存 API Key
- [ ] 打开应用 → 设置 → Gemini 设置
- [ ] 在输入框中填入假 Key（如 `smoke-test-fake-key-20260920`），点击"保存"
- [ ] 验证 UI 显示"已配置（系统凭据库）"，输入框已清空
- [ ] 打开 Windows 凭据管理器（"控制面板 → 凭据管理器 → Windows 凭据"），确认存在服务名 `meetily`、用户名 `gemini_api_key` 的条目

#### A-2. 验证无明文泄露
- [ ] 打开 DevTools（`Ctrl+Shift+I`）→ Application → Local Storage，确认无 `gemini_api_key` 键
- [ ] DevTools → Application → Session Storage，确认无 `gemini_api_key` 键
- [ ] 使用 DB Browser for SQLite 打开 `%APPDATA%\Meetily Bilingual (Dev)\meetily.db`，查询 `SELECT * FROM settings`，确认无密钥明文
- [ ] 查看 Tauri 日志（DevTools Console 或终端），确认无密钥明文或密钥长度打印

#### A-3. 重启持久性验证
- [ ] 完全关闭并重启应用
- [ ] 打开设置，确认状态仍显示"已配置"（凭据从 Windows Credential Manager 读取）

#### A-4. 关闭云翻译（无 API 调用验证）
- [ ] 将"启用云端翻译"开关切换为关闭
- [ ] 打开 DevTools Network 标签，确认无 Gemini API 请求发出（队列已清空）

#### A-5. 删除 API Key
- [ ] 设置页面点击"清除 API Key"按钮，确认 UI 状态恢复"未配置"
- [ ] 打开 Windows 凭据管理器，确认 `meetily` / `gemini_api_key` 条目已删除
- [ ] 完全重启应用，确认设置页面显示"未配置"

#### A-6. 旧 localStorage Key 迁移验证
- [ ] 在 DevTools Console 中设置旧值：`localStorage.setItem('gemini_api_key', 'legacy-fake-key-abc')`
- [ ] 重新打开设置页面触发迁移
- [ ] 迁移成功时：确认 Windows 凭据管理器中写入条目，且 localStorage 的 `gemini_api_key` 键已被删除
- [ ] 迁移失败时：确认 localStorage 原值 `legacy-fake-key-abc` **仍保留**，UI 显示失败提示，未静默丢失

### B. 端到端翻译验证（需用户明确授权 + 有效 Key，单独执行）

> ⚠️ **本节发出真实外网 HTTP 请求。仅在用户明确授权并提供自己的有效 Key 后执行。只发送合成英文文本，不发送真实会议内容。**

- [ ] 用户提供有效 Key 并在设置中保存（Key 存入 Windows Credential Manager）
- [ ] 确认"启用云端翻译"开关已开启
- [ ] 触发一条合成英文文本的翻译请求（如输入 `"Hello, this is a smoke test."`）
- [ ] DevTools Network：确认请求目标为 `https://generativelanguage.googleapis.com`，收到 200 响应，译文显示在 UI 中
- [ ] 确认 DevTools Network Response 中无 API Key 明文泄露
- [ ] 测试完毕后删除 Key，确认"未配置"状态

---

## 未验证项与环境约束清单

1. **Rust 后端 Windows 本地编译器与凭据单元测试**:
   - 状态: **已在 Windows 本地完成验证 (Verified on Windows)**
   - `cargo check --release` 退出码 0，`cargo check` 退出码 0，`cargo test ... credentials` 10/10 通过。
   - 依赖方案: 终端会话 `$env:LIBCLANG_PATH="C:\Users\huang\llvm-18\bin"`，未修改系统环境变量。

2. **macOS / Linux 跨平台原生运行时与编译器验证**:
   - 状态: **配置审查完成，宿主机原生编译未验证**
   - 当前宿主机为 Windows x86_64。`apple-native` 与 `sync-secret-service` + `crypto-rust` 依赖 feature 已与官方文档严格核实并锁定，但未在 macOS/Linux 真实系统上进行二进制编译与真实 keyring 守护进程交互验证。
   - Linux 打包说明：需在目标机器安装 `dbus-user-session` 并启动 Secret Service 守护进程（GNOME Keyring / KSecretService / KeePassXC），无需安装 `libssl-dev`。

3. **真实 Gemini API 端到端网络调用**:
   - 状态: **未验证，须用户授权后单独执行 (Not yet run)**
   - 所有自动化验证均在 mock、合成数据与本地 SQLite/Keyring mock 环境中执行，未消耗真实账号配额。使用假 Key 触发翻译会产生真实 HTTP 请求（收到 401），因此即使是冒烟测试的翻译步骤也不属于「未调用真实 Gemini API」。端到端翻译验证（冒烟测试 B 节）须用户提供自己的有效 Key 并明确授权后，仅发送合成英文文本进行验证。

4. **既有 VAD 测试失败（非本次整改引入）**:
   - 状态: **已知，保留（Existing, Preserved by scope constraint）**
   - 7 项 `audio::vad::tests` 因本地 `onnxruntime.dll` 1.17.1 与 `ort 2.0.0-rc.10` 不匹配失败，与本次双语翻译整改无关。严格遵守不修改音频/VAD 代码的约束，未作修改。

---

## git status（最终）

```
On branch feature/live-translation
Changes not staged for commit:
  modified:   Cargo.lock
  modified:   frontend/pnpm-lock.yaml
  modified:   frontend/src-tauri/Cargo.toml
  modified:   frontend/src-tauri/src/api/api.rs
  modified:   frontend/src-tauri/src/audio/common.rs
  modified:   frontend/src-tauri/src/audio/import.rs
  modified:   frontend/src-tauri/src/audio/recording_preferences.rs
  modified:   frontend/src-tauri/src/database/models.rs
  modified:   frontend/src-tauri/src/database/repositories/meeting.rs
  modified:   frontend/src-tauri/src/database/repositories/transcript.rs
  modified:   frontend/src-tauri/src/lib.rs
  modified:   frontend/src-tauri/src/notifications/settings.rs
  modified:   frontend/src-tauri/tauri.conf.json
  modified:   frontend/src/app/_components/TranscriptPanel.tsx
  modified:   frontend/src/components/MeetingDetails/TranscriptButtonGroup.tsx
  modified:   frontend/src/components/MeetingDetails/TranscriptPanel.tsx
  modified:   frontend/src/components/PreferenceSettings.tsx
  modified:   frontend/src/components/VirtualizedTranscriptView.tsx
  modified:   frontend/src/contexts/TranscriptContext.tsx
  modified:   frontend/src/hooks/meeting-details/useCopyOperations.ts
  modified:   frontend/src/hooks/usePaginatedTranscripts.ts
  modified:   frontend/src/hooks/useRecordingStop.ts
  modified:   frontend/src/services/storageService.ts
  modified:   frontend/src/types/index.ts
  modified:   frontend/tsconfig.json

Untracked files:
  AGENTS.md
  GEMINI_REMEDIATION_PLAN.md
  GEMINI_REMEDIATION_PROGRESS.md
  frontend/src-tauri/migrations/20260920000000_add_translation_to_transcripts.sql
  frontend/src-tauri/src/credentials.rs
  frontend/src/components/GeminiSettings.tsx
  frontend/src/services/geminiTranslationService.ts
  frontend/src/services/legacyTranslationMigration.ts
  frontend/src/services/translationSessionTracker.ts
  frontend/src/services/unifiedTranslationScheduler.ts
  frontend/tests/lib/gemini-authorization-and-storage.test.ts
  frontend/tests/lib/legacy-translation-migration.test.ts
  frontend/tests/lib/sqlite-translation-integration.test.ts
  frontend/tests/lib/translation-session-tracker.test.ts
  frontend/tests/lib/unified-translation-scheduler.test.ts

no changes added to commit
```
