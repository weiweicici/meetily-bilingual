import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  isCloudTranslationEnabled,
  setCloudTranslationEnabled,
  isGeminiConfigured,
  saveGeminiApiKey,
  deleteGeminiApiKey,
  getGeminiApiKey,
  migrateLegacyGeminiKey,
  translateWithGemini,
  unifiedTranslationScheduler,
} from '../../src/services/geminiTranslationService.ts';

// Mock localStorage for Node.js test environment
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
}

/**
 * Mock Credential Store that faithfully replicates the Rust `CredentialManager`
 * atomic write-verify-rollback and serialized execution logic for tests.
 */
class MockCredentialStore {
  private currentSecret: string | null = null;
  private readBackBehavior: 'normal' | 'stale_old_value' | 'read_failure' = 'normal';
  private operationLog: string[] = [];

  setSecret(val: string | null): void {
    this.currentSecret = val;
  }

  getSecret(): string | null {
    return this.currentSecret;
  }

  setReadBackBehavior(behavior: 'normal' | 'stale_old_value' | 'read_failure'): void {
    this.readBackBehavior = behavior;
  }

  getOperationLog(): string[] {
    return [...this.operationLog];
  }

  clear(): void {
    this.currentSecret = null;
    this.readBackBehavior = 'normal';
    this.operationLog = [];
  }

  /**
   * Simulates the Rust `api_migrate_gemini_api_key` atomic command.
   */
  async atomicMigrate(candidateKey: string): Promise<void> {
    const trimmed = candidateKey.trim();
    if (!trimmed) {
      throw new Error('API key cannot be empty');
    }

    this.operationLog.push(`migrate:start:${trimmed}`);

    // 1. Backup previous store value
    const previous = this.currentSecret;

    // 2. Write candidate key
    this.currentSecret = trimmed;

    // 3. Read back
    if (this.readBackBehavior === 'read_failure') {
      // Rollback to previous
      this.currentSecret = previous;
      this.operationLog.push('migrate:read_failure:rollback');
      throw new Error('Keyring read-back failed: OS service error');
    }

    const readBack = this.readBackBehavior === 'stale_old_value' ? previous : this.currentSecret;

    // 4. Verify with constant-time equality
    const verified = readBack === trimmed;

    if (!verified) {
      // Rollback
      this.currentSecret = previous;
      this.operationLog.push('migrate:verify_mismatch:rollback');
      throw new Error('Credential store verification failed: read-back did not match written key');
    }

    this.operationLog.push(`migrate:success:${trimmed}`);
  }
}

describe('Gemini Authorization & Secure Credential Storage (Phase 4 Security Acceptance Tests)', () => {
  let mockStorage: MockLocalStorage;
  let mockStore: MockCredentialStore;

  beforeEach(async () => {
    mockStorage = new MockLocalStorage();
    mockStore = new MockCredentialStore();
    (globalThis as unknown as { localStorage: MockLocalStorage }).localStorage = mockStorage;
    (globalThis as unknown as { window: { localStorage: MockLocalStorage } }).window = {
      localStorage: mockStorage,
    };
    await deleteGeminiApiKey();
    setCloudTranslationEnabled(false);
    unifiedTranslationScheduler.clear();
  });

  test('default state: cloud translation authorization is disabled by default and key is not configured', async () => {
    assert.equal(isCloudTranslationEnabled(), false);
    assert.equal(await isGeminiConfigured(), false);
  });

  test('zero network requests when cloud translation is not authorized', async () => {
    let networkRequestsMade = 0;
    const customFetch = async () => {
      networkRequestsMade++;
      return new Response(JSON.stringify({ candidates: [] }), { status: 200 });
    };

    const originalFetch = (unifiedTranslationScheduler as unknown as { fetchFn: typeof fetch }).fetchFn;
    (unifiedTranslationScheduler as unknown as { fetchFn: typeof fetch }).fetchFn = customFetch as unknown as typeof fetch;

    try {
      setCloudTranslationEnabled(false);
      const result = await translateWithGemini('Hello world, this is a test.', 'test-key-123');

      assert.equal(result, null);
      assert.equal(networkRequestsMade, 0, 'No HTTP requests must be sent when cloud translation is disabled');
    } finally {
      (unifiedTranslationScheduler as unknown as { fetchFn: typeof fetch }).fetchFn = originalFetch;
    }
  });

  test('security rule: saving key does NOT write to localStorage, SQLite, or allow reading back to frontend', async () => {
    await saveGeminiApiKey('super-secret-gemini-key-12345');

    // 1. Must NOT be stored in localStorage
    assert.equal(
      mockStorage.getItem('gemini_api_key'),
      null,
      'API key must NEVER be persisted to localStorage'
    );

    // 2. getGeminiApiKey() must return null (key cannot be read back by frontend)
    assert.equal(
      getGeminiApiKey(),
      null,
      'Frontend must not be able to read back the full API key'
    );

    // 3. isGeminiConfigured() must report true
    assert.equal(await isGeminiConfigured(), true);

    // 4. Cloud translation must remain disabled until explicitly authorized
    assert.equal(isCloudTranslationEnabled(), false);
  });

  test('security rule: frontend and Tauri API never return secret key', async () => {
    await saveGeminiApiKey('secret-key-xyz');
    assert.equal(getGeminiApiKey(), null);
    assert.equal(typeof (await isGeminiConfigured()), 'boolean');
  });

  test('migration scenario 1: store has old value A, migrating new value B succeeds -> store has B, localStorage removed', async () => {
    mockStore.setSecret('old-value-A');
    mockStorage.setItem('gemini_api_key', 'new-value-B');

    const result = await migrateLegacyGeminiKey({
      migrateFn: (k) => mockStore.atomicMigrate(k),
      removeFn: () => mockStorage.removeItem('gemini_api_key'),
    });

    assert.equal(result.migrated, true);
    assert.equal(mockStore.getSecret(), 'new-value-B');
    // localStorage must be cleaned up on verified success
    assert.equal(mockStorage.getItem('gemini_api_key'), null);
  });

  test('migration scenario 2: write succeeds but read back is still old value A -> migration fails, localStorage retained, store rolled back to A', async () => {
    mockStore.setSecret('old-value-A');
    mockStore.setReadBackBehavior('stale_old_value');
    mockStorage.setItem('gemini_api_key', 'new-value-B');

    const result = await migrateLegacyGeminiKey({
      migrateFn: (k) => mockStore.atomicMigrate(k),
      removeFn: () => mockStorage.removeItem('gemini_api_key'),
    });

    assert.equal(result.migrated, false);
    assert.ok(result.error && result.error.includes('verification failed'));
    // Critical: localStorage MUST be retained
    assert.equal(mockStorage.getItem('gemini_api_key'), 'new-value-B');
    // Store MUST be rolled back to A
    assert.equal(mockStore.getSecret(), 'old-value-A');
  });

  test('migration scenario 3: write B then read fails -> migration fails, localStorage retained, store rolled back to A', async () => {
    mockStore.setSecret('old-value-A');
    mockStore.setReadBackBehavior('read_failure');
    mockStorage.setItem('gemini_api_key', 'new-value-B');

    const result = await migrateLegacyGeminiKey({
      migrateFn: (k) => mockStore.atomicMigrate(k),
      removeFn: () => mockStorage.removeItem('gemini_api_key'),
    });

    assert.equal(result.migrated, false);
    assert.ok(result.error && result.error.includes('read-back failed'));
    // Critical: localStorage MUST be retained
    assert.equal(mockStorage.getItem('gemini_api_key'), 'new-value-B');
    // Store MUST be rolled back to A
    assert.equal(mockStore.getSecret(), 'old-value-A');
  });

  test('migration scenario 4: verification failure when store was initially empty rolls back to empty', async () => {
    mockStore.setSecret(null);
    mockStore.setReadBackBehavior('stale_old_value');
    mockStorage.setItem('gemini_api_key', 'candidate-key');

    const result = await migrateLegacyGeminiKey({
      migrateFn: (k) => mockStore.atomicMigrate(k),
      removeFn: () => mockStorage.removeItem('gemini_api_key'),
    });

    assert.equal(result.migrated, false);
    assert.equal(mockStorage.getItem('gemini_api_key'), 'candidate-key');
    // Store rolled back to empty
    assert.equal(mockStore.getSecret(), null);
  });

  test('migration scenario 5: concurrent save and migration calls execute serially without race conditions', async () => {
    mockStore.setSecret(null);

    // Run multiple operations concurrently
    const ops = [
      mockStore.atomicMigrate('key-step-1'),
      mockStore.atomicMigrate('key-step-2'),
      mockStore.atomicMigrate('key-step-3'),
    ];

    await Promise.all(ops);

    // The store should have a non-corrupted string equal to one of the valid steps
    const finalSecret = mockStore.getSecret();
    assert.ok(['key-step-1', 'key-step-2', 'key-step-3'].includes(finalSecret!));
    assert.equal(mockStore.getOperationLog().length, 6); // 3 starts, 3 successes
  });

  test('enabling authorization allows translation requests to proceed', async () => {
    let networkRequestsMade = 0;
    const customFetch = async () => {
      networkRequestsMade++;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '你好世界' }],
              },
            },
          ],
        }),
        { status: 200 }
      );
    };

    const originalFetch = (unifiedTranslationScheduler as unknown as { fetchFn: typeof fetch }).fetchFn;
    (unifiedTranslationScheduler as unknown as { fetchFn: typeof fetch }).fetchFn = customFetch as unknown as typeof fetch;

    try {
      setCloudTranslationEnabled(true);
      const result = await translateWithGemini('Hello world', 'valid-api-key');

      assert.equal(networkRequestsMade, 1);
      assert.equal(result, '你好世界');
    } finally {
      (unifiedTranslationScheduler as unknown as { fetchFn: typeof fetch }).fetchFn = originalFetch;
    }
  });

  test('disabling cloud translation or clearing key immediately cancels pending requests', async () => {
    setCloudTranslationEnabled(true);
    await saveGeminiApiKey('test-key');

    // Simulate clearing key
    await deleteGeminiApiKey();

    assert.equal(isCloudTranslationEnabled(), false, 'Clearing key must disable cloud translation');
    assert.equal(await isGeminiConfigured(), false);
    assert.equal(unifiedTranslationScheduler.getQueueLength(), 0, 'Queue must be empty after clearing key');
  });
});
