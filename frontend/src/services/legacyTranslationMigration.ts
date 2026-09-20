/**
 * Legacy Translation Migration Service
 *
 * Migrates translations previously stored in localStorage ('meetily_translations_*')
 * into SQLite database ('transcripts.translation' column) idempotently and safely.
 *
 * Rules:
 * 1. Idempotent: Never re-migrates already migrated meetings.
 * 2. Safe: Old localStorage data is ONLY removed AFTER verified database commit.
 * 3. Corrupted / unmapped data is preserved and reported.
 */

export interface MigrationReport {
  totalMeetingsFound: number;
  migratedMeetings: number;
  failedMeetings: number;
  corruptedCount: number;
  totalTranslationsMigrated: number;
  skippedAlreadyMigrated: number;
}

const STORAGE_KEY_PREFIX = 'meetily_translations_';
const MIGRATED_FLAG_PREFIX = 'meetily_translations_migrated_';

export function hasLegacyTranslations(meetingId: string): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  const key = `${STORAGE_KEY_PREFIX}${meetingId}`;
  const migratedKey = `${MIGRATED_FLAG_PREFIX}${meetingId}`;
  return localStorage.getItem(key) !== null && localStorage.getItem(migratedKey) !== 'true';
}

export async function migrateMeetingLegacyTranslations(
  meetingId: string,
  batchSaveFn?: (meetingId: string, pairs: [string, string][]) => Promise<number>
): Promise<number> {
  if (!hasLegacyTranslations(meetingId)) return 0;
  const saveFn = batchSaveFn ?? (async (mId, pairs) => {
    const { storageService } = await import('./storageService');
    return storageService.batchSaveTranslations(mId, pairs);
  });

  const key = `${STORAGE_KEY_PREFIX}${meetingId}`;
  const migratedKey = `${MIGRATED_FLAG_PREFIX}${meetingId}`;
  const rawData = localStorage.getItem(key);
  if (!rawData) return 0;

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(rawData);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Not an object');
    }
  } catch {
    console.warn(`[TranslationMigration] Corrupted JSON in ${key}, preserving data without deleting`);
    return 0;
  }

  const pairs: [string, string][] = [];
  for (const [textOrSeq, translation] of Object.entries(parsed)) {
    if (typeof translation === 'string' && translation.trim()) {
      const textKey = textOrSeq.trim();
      if (textKey && isNaN(Number(textKey))) {
        pairs.push([textKey, translation.trim()]);
      }
    }
  }

  if (pairs.length === 0) {
    localStorage.setItem(migratedKey, 'true');
    localStorage.removeItem(key);
    return 0;
  }

  try {
    const count = await saveFn(meetingId, pairs);
    localStorage.setItem(migratedKey, 'true');
    localStorage.removeItem(key);
    console.log(`[TranslationMigration] Successfully migrated ${count} translations for meeting ${meetingId}`);
    return count;
  } catch (err) {
    console.error(`[TranslationMigration] Failed to migrate translations for meeting ${meetingId}:`, err);
    return 0;
  }
}

export async function migrateLegacyTranslations(
  batchSaveFn?: (meetingId: string, pairs: [string, string][]) => Promise<number>
): Promise<MigrationReport> {
  const saveFn = batchSaveFn ?? (async (meetingId, pairs) => {
    const { storageService } = await import('./storageService');
    return storageService.batchSaveTranslations(meetingId, pairs);
  });
  const report: MigrationReport = {
    totalMeetingsFound: 0,
    migratedMeetings: 0,
    failedMeetings: 0,
    corruptedCount: 0,
    totalTranslationsMigrated: 0,
    skippedAlreadyMigrated: 0,
  };

  if (typeof window === 'undefined' || !window.localStorage) {
    return report;
  }

  const keysToProcess: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEY_PREFIX) && !key.startsWith(MIGRATED_FLAG_PREFIX)) {
        keysToProcess.push(key);
      }
    }
  } catch (err) {
    console.error('[TranslationMigration] Failed to inspect localStorage:', err);
    return report;
  }

  report.totalMeetingsFound = keysToProcess.length;

  for (const key of keysToProcess) {
    const meetingId = key.replace(STORAGE_KEY_PREFIX, '').trim();
    if (!meetingId) continue;

    // Check if already migrated
    const migratedKey = `${MIGRATED_FLAG_PREFIX}${meetingId}`;
    if (localStorage.getItem(migratedKey) === 'true') {
      report.skippedAlreadyMigrated++;
      // Safe to clean up legacy key if migrated flag is present
      localStorage.removeItem(key);
      continue;
    }

    const rawData = localStorage.getItem(key);
    if (!rawData) continue;

    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(rawData);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Not an object');
      }
    } catch {
      console.warn(`[TranslationMigration] Corrupted JSON in ${key}, preserving data without deleting`);
      report.corruptedCount++;
      report.failedMeetings++;
      continue;
    }

    // Extract text -> translation pairs
    const pairs: [string, string][] = [];
    for (const [textOrSeq, translation] of Object.entries(parsed)) {
      if (typeof translation === 'string' && translation.trim()) {
        const textKey = textOrSeq.trim();
        // Only consider non-empty string keys that look like text (avoid pure sequence numbers if ambiguous)
        if (textKey && isNaN(Number(textKey))) {
          pairs.push([textKey, translation.trim()]);
        }
      }
    }

    if (pairs.length === 0) {
      // Nothing to migrate, mark done and remove
      localStorage.setItem(migratedKey, 'true');
      localStorage.removeItem(key);
      report.migratedMeetings++;
      continue;
    }

    try {
      const count = await saveFn(meetingId, pairs);
      // Verify commit
      localStorage.setItem(migratedKey, 'true');
      localStorage.removeItem(key);
      report.migratedMeetings++;
      report.totalTranslationsMigrated += count;
      console.log(`[TranslationMigration] Successfully migrated ${count} translations for meeting ${meetingId}`);
    } catch (err) {
      console.error(`[TranslationMigration] Failed to migrate translations for meeting ${meetingId}:`, err);
      report.failedMeetings++;
      // DO NOT delete key on failure! Keep original data intact.
    }
  }

  return report;
}
