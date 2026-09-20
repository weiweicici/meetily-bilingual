import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore - node:sqlite is built into Node 24 runtime
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  migrateLegacyTranslations,
  migrateMeetingLegacyTranslations,
} from '../../src/services/legacyTranslationMigration.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsDir = join(__dirname, '..', '..', 'src-tauri', 'migrations');
const initialSchemaPath = join(migrationsDir, '20250916100000_initial_schema.sql');
const addTranslationMigrationPath = join(migrationsDir, '20260920000000_add_translation_to_transcripts.sql');

// Mock localStorage for legacy migration testing
class MockLocalStorage {
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }

  get length(): number {
    return Object.keys(this.store).length;
  }

  key(index: number): string | null {
    const keys = Object.keys(this.store);
    return keys[index] ?? null;
  }
}

describe('SQLite Translation Persistence & Migration (Real Database Integration Tests)', () => {
  let db: DatabaseSync;
  let mockStorage: MockLocalStorage;

  beforeEach(() => {
    // 1. Create a fresh in-memory SQLite database
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');

    // 2. Setup mock localStorage
    mockStorage = new MockLocalStorage();
    (globalThis as unknown as { localStorage: MockLocalStorage }).localStorage = mockStorage;
    (globalThis as unknown as { window: { localStorage: MockLocalStorage } }).window = {
      localStorage: mockStorage,
    };
  });

  test('1. 旧库升级 (Schema Migration): adds translation column to transcripts table without data loss', () => {
    // Step A: Apply initial schema (old version without translation column)
    const initialSql = readFileSync(initialSchemaPath, 'utf-8');
    db.exec(initialSql);

    // Verify initial table does not have 'translation'
    const initialCols = db.prepare("PRAGMA table_info('transcripts')").all() as Array<{ name: string }>;
    assert.equal(initialCols.some(c => c.name === 'translation'), false);

    // Insert pre-migration existing data
    db.exec(`
      INSERT INTO meetings (id, title, created_at, updated_at)
      VALUES ('m-pre', 'Pre-migration Meeting', '2026-09-01T10:00:00Z', '2026-09-01T10:00:00Z');
      INSERT INTO transcripts (id, meeting_id, transcript, timestamp)
      VALUES ('t-pre', 'm-pre', 'Existing speech text before migration', '2026-09-01T10:00:05Z');
    `);

    // Step B: Run the translation migration SQL
    const migrationSql = readFileSync(addTranslationMigrationPath, 'utf-8');
    db.exec(migrationSql);

    // Step C: Verify 'translation' column now exists
    const upgradedCols = db.prepare("PRAGMA table_info('transcripts')").all() as Array<{ name: string }>;
    assert.equal(upgradedCols.some(c => c.name === 'translation'), true);

    // Step D: Verify existing data was preserved with translation as NULL
    const row = db.prepare("SELECT id, transcript, translation FROM transcripts WHERE id = 't-pre'").get() as {
      id: string;
      transcript: string;
      translation: string | null;
    };
    assert.equal(row.id, 't-pre');
    assert.equal(row.transcript, 'Existing speech text before migration');
    assert.equal(row.translation, null);
  });

  test('2. 保存并重新读取译文 (Save and Re-read Translation)', () => {
    // Setup full schema
    const initialSql = readFileSync(initialSchemaPath, 'utf-8');
    const migrationSql = readFileSync(addTranslationMigrationPath, 'utf-8');
    db.exec(initialSql);
    db.exec(migrationSql);

    // Insert meeting and transcript with translation
    db.exec(`
      INSERT INTO meetings (id, title, created_at, updated_at)
      VALUES ('m1', 'Test Meeting 1', '2026-09-20T10:00:00Z', '2026-09-20T10:00:00Z');
      INSERT INTO transcripts (id, meeting_id, transcript, timestamp, translation)
      VALUES ('t1', 'm1', 'Good morning team.', '2026-09-20T10:00:05Z', '大家早上好。');
    `);

    // Re-read from database
    const row = db.prepare("SELECT transcript, translation FROM transcripts WHERE id = 't1'").get() as {
      transcript: string;
      translation: string;
    };

    assert.equal(row.transcript, 'Good morning team.');
    assert.equal(row.translation, '大家早上好。');
  });

  test('3. 跨会议相同 sequence_id 隔离 (Cross-meeting sequence_id isolation)', () => {
    const initialSql = readFileSync(initialSchemaPath, 'utf-8');
    const migrationSql = readFileSync(addTranslationMigrationPath, 'utf-8');
    db.exec(initialSql);
    db.exec(migrationSql);

    // Insert two different meetings
    db.exec(`
      INSERT INTO meetings (id, title, created_at, updated_at)
      VALUES 
        ('m-alpha', 'Meeting Alpha', '2026-09-20T10:00:00Z', '2026-09-20T10:00:00Z'),
        ('m-beta', 'Meeting Beta', '2026-09-20T11:00:00Z', '2026-09-20T11:00:00Z');
      
      -- Both have segment with identical text and sequence_id 1
      INSERT INTO transcripts (id, meeting_id, transcript, timestamp, translation)
      VALUES 
        ('t-alpha-1', 'm-alpha', 'Let us begin.', '2026-09-20T10:00:05Z', '让我们开始会议 Alpha。'),
        ('t-beta-1', 'm-beta', 'Let us begin.', '2026-09-20T11:00:05Z', '让我们开始会议 Beta。');
    `);

    // Update only meeting Alpha's translation
    const updateStmt = db.prepare(`
      UPDATE transcripts 
      SET translation = 'Alpha更新翻译'
      WHERE meeting_id = 'm-alpha' AND transcript = 'Let us begin.'
    `);
    updateStmt.run();

    // Verify Alpha was updated
    const alphaRow = db.prepare("SELECT translation FROM transcripts WHERE id = 't-alpha-1'").get() as { translation: string };
    assert.equal(alphaRow.translation, 'Alpha更新翻译');

    // Verify Beta remains completely untouched
    const betaRow = db.prepare("SELECT translation FROM transcripts WHERE id = 't-beta-1'").get() as { translation: string };
    assert.equal(betaRow.translation, '让我们开始会议 Beta。');
  });

  test('4. 删除会议级联清理 (Cascade Delete on Meeting Deletion)', () => {
    const initialSql = readFileSync(initialSchemaPath, 'utf-8');
    const migrationSql = readFileSync(addTranslationMigrationPath, 'utf-8');
    db.exec(initialSql);
    db.exec(migrationSql);

    db.exec(`
      INSERT INTO meetings (id, title, created_at, updated_at)
      VALUES ('m-del', 'To Be Deleted', '2026-09-20T10:00:00Z', '2026-09-20T10:00:00Z');
      INSERT INTO transcripts (id, meeting_id, transcript, timestamp, translation)
      VALUES 
        ('t-del-1', 'm-del', 'Segment 1', '2026-09-20T10:00:01Z', '片段 1'),
        ('t-del-2', 'm-del', 'Segment 2', '2026-09-20T10:00:02Z', '片段 2');
    `);

    // Ensure transcripts exist before deletion
    const countBefore = db.prepare("SELECT COUNT(*) as cnt FROM transcripts WHERE meeting_id = 'm-del'").get() as { cnt: number };
    assert.equal(countBefore.cnt, 2);

    // Delete meeting
    db.exec("DELETE FROM meetings WHERE id = 'm-del'");

    // Ensure all associated transcripts and translations were cascaded and deleted
    const countAfter = db.prepare("SELECT COUNT(*) as cnt FROM transcripts WHERE meeting_id = 'm-del'").get() as { cnt: number };
    assert.equal(countAfter.cnt, 0);
  });

  test('5. 重复迁移幂等性 (Idempotent / Repeated Migration with Real SQLite DB)', async () => {
    const initialSql = readFileSync(initialSchemaPath, 'utf-8');
    const migrationSql = readFileSync(addTranslationMigrationPath, 'utf-8');
    db.exec(initialSql);
    db.exec(migrationSql);

    db.exec(`
      INSERT INTO meetings (id, title, created_at, updated_at)
      VALUES ('m-legacy', 'Legacy Meeting', '2026-09-20T10:00:00Z', '2026-09-20T10:00:00Z');
      INSERT INTO transcripts (id, meeting_id, transcript, timestamp)
      VALUES ('t-legacy-1', 'm-legacy', 'Hello legacy world', '2026-09-20T10:00:01Z');
    `);

    // Setup localStorage with legacy translations
    mockStorage.setItem(
      'meetily_translations_m-legacy',
      JSON.stringify({
        'Hello legacy world': '你好遗留世界',
      })
    );

    // Batch save function that writes to real SQLite
    const realDbBatchSave = async (meetingId: string, pairs: [string, string][]): Promise<number> => {
      let updated = 0;
      const stmt = db.prepare(`
        UPDATE transcripts
        SET translation = ?
        WHERE meeting_id = ? AND transcript = ?
      `);
      for (const [text, trans] of pairs) {
        const res = stmt.run(trans, meetingId, text);
        if (res.changes > 0) updated += res.changes;
      }
      return updated;
    };

    // First migration run
    const report1 = await migrateLegacyTranslations(realDbBatchSave);
    assert.equal(report1.migratedMeetings, 1);
    assert.equal(report1.totalTranslationsMigrated, 1);

    // Verify translation in SQLite
    const row = db.prepare("SELECT translation FROM transcripts WHERE id = 't-legacy-1'").get() as { translation: string };
    assert.equal(row.translation, '你好遗留世界');

    // Verify localStorage key was safely removed after verified commit
    assert.equal(mockStorage.getItem('meetily_translations_m-legacy'), null);
    assert.equal(mockStorage.getItem('meetily_translations_migrated_m-legacy'), 'true');

    // Second migration run (idempotency check)
    const report2 = await migrateLegacyTranslations(realDbBatchSave);
    assert.equal(report2.migratedMeetings, 0);
    assert.equal(report2.totalTranslationsMigrated, 0);
    assert.equal(report2.skippedAlreadyMigrated, 0);
  });

  test('6. 写入失败保留旧数据 (Write Failure Retains Legacy Data)', async () => {
    mockStorage.setItem(
      'meetily_translations_m-error',
      JSON.stringify({
        'Important speech': '重要发言',
      })
    );

    // Batch save function that throws an error (e.g. database failure)
    const failingBatchSave = async (): Promise<number> => {
      throw new Error('SQLite database disk I/O error');
    };

    const report = await migrateLegacyTranslations(failingBatchSave);
    assert.equal(report.failedMeetings, 1);

    // Critical assertion: localStorage data must NOT be deleted when database write fails
    assert.notEqual(mockStorage.getItem('meetily_translations_m-error'), null);
    assert.equal(mockStorage.getItem('meetily_translations_migrated_m-error'), null);
  });
});
