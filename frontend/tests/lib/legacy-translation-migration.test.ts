import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrateLegacyTranslations } from '../../src/services/legacyTranslationMigration.ts';

function installMockLocalStorage() {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: mockStorage,
    },
  });

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: mockStorage,
  });

  return store;
}

describe('LegacyTranslationMigration (Phase 3 Acceptance Tests)', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installMockLocalStorage();
  });

  it('migrates valid meeting translations and cleans up localStorage after verified commit', async () => {
    store.set(
      'meetily_translations_meeting-1',
      JSON.stringify({
        'Hello world': '你好世界',
        'Good morning': '早上好',
      })
    );

    const savedRecords: { meetingId: string; pairs: [string, string][] }[] = [];
    const mockBatchSave = async (meetingId: string, pairs: [string, string][]) => {
      savedRecords.push({ meetingId, pairs });
      return pairs.length;
    };

    const report = await migrateLegacyTranslations(mockBatchSave);
    assert.equal(report.migratedMeetings, 1);
    assert.equal(report.totalTranslationsMigrated, 2);
    assert.equal(savedRecords.length, 1);
    assert.equal(savedRecords[0].meetingId, 'meeting-1');

    // Original key should be cleaned up
    assert.equal(store.has('meetily_translations_meeting-1'), false);
    // Migrated flag should be present
    assert.equal(store.get('meetily_translations_migrated_meeting-1'), 'true');
  });

  it('preserves original data if database save fails', async () => {
    store.set(
      'meetily_translations_meeting-fail',
      JSON.stringify({
        'Important data': '重要数据',
      })
    );

    const failingBatchSave = async () => {
      throw new Error('SQLite write error');
    };

    const report = await migrateLegacyTranslations(failingBatchSave);
    assert.equal(report.failedMeetings, 1);

    // Data MUST NOT be deleted
    assert.ok(store.has('meetily_translations_meeting-fail'));
    assert.equal(store.has('meetily_translations_migrated_meeting-fail'), false);
  });

  it('preserves corrupted JSON and reports corruptedCount without throwing', async () => {
    store.set('meetily_translations_meeting-corrupt', '{ broken json');

    const report = await migrateLegacyTranslations(async () => 0);
    assert.equal(report.corruptedCount, 1);
    assert.equal(report.failedMeetings, 1);

    // Corrupted data MUST be preserved
    assert.equal(store.get('meetily_translations_meeting-corrupt'), '{ broken json');
  });

  it('idempotency: running migration twice skips already migrated meetings', async () => {
    store.set(
      'meetily_translations_meeting-2',
      JSON.stringify({
        'Welcome': '欢迎',
      })
    );

    let callCount = 0;
    const mockBatchSave = async (_id: string, pairs: [string, string][]) => {
      callCount++;
      return pairs.length;
    };

    // First run
    const report1 = await migrateLegacyTranslations(mockBatchSave);
    assert.equal(report1.migratedMeetings, 1);
    assert.equal(callCount, 1);

    // Second run
    const report2 = await migrateLegacyTranslations(mockBatchSave);
    assert.equal(report2.totalMeetingsFound, 0); // Already cleaned up
    assert.equal(callCount, 1); // Not called again
  });
});
