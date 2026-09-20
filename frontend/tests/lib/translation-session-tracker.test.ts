import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TranslationSessionTracker } from '../../src/services/translationSessionTracker.ts';

describe('TranslationSessionTracker (Phase 1 Acceptance Tests)', () => {
  it('partial -> final: ignores partial transcripts and only requests final', () => {
    const tracker = new TranslationSessionTracker('session-1');

    // Partial update should NOT trigger request
    const partialReq = tracker.shouldRequest(1, 'Hello wor', true);
    assert.equal(partialReq.shouldRequest, false);
    assert.equal(tracker.hasInFlight(), false);

    // Final update should trigger request
    const finalReq = tracker.shouldRequest(1, 'Hello world', false);
    assert.equal(finalReq.shouldRequest, true);
    assert.equal(finalReq.version, 1);
    assert.equal(tracker.hasInFlight(), true);
  });

  it('duplicate final: identical text and sequence_id are deduplicated', () => {
    const tracker = new TranslationSessionTracker('session-1');

    const first = tracker.shouldRequest(1, 'Hello world', false);
    assert.equal(first.shouldRequest, true);

    // Duplicate arrival while in-flight
    const duplicateInFlight = tracker.shouldRequest(1, 'Hello world', false);
    assert.equal(duplicateInFlight.shouldRequest, false);

    // Complete the first request
    const committed = tracker.commitResult('session-1', 1, first.version, '你好世界');
    assert.equal(committed, true);
    assert.equal(tracker.getTranslation(1), '你好世界');

    // Duplicate arrival after completion
    const duplicateCompleted = tracker.shouldRequest(1, 'Hello world', false);
    assert.equal(duplicateCompleted.shouldRequest, false);
  });

  it('revised text: higher version supersedes older version, old slow response is discarded', () => {
    const tracker = new TranslationSessionTracker('session-1');

    // Initial version
    const reqV1 = tracker.shouldRequest(1, 'We should start', false);
    assert.equal(reqV1.version, 1);

    // Revised final text arrives for same sequence_id
    const reqV2 = tracker.shouldRequest(1, 'We should start now', false);
    assert.equal(reqV2.shouldRequest, true);
    assert.equal(reqV2.version, 2);

    // Old slow response arrives from v1
    const v1Committed = tracker.commitResult('session-1', 1, reqV1.version, '我们应该开始');
    assert.equal(v1Committed, false, 'Old response should be rejected');

    // New response arrives from v2
    const v2Committed = tracker.commitResult('session-1', 1, reqV2.version, '我们现在应该开始');
    assert.equal(v2Committed, true, 'Newest response should be accepted');
    assert.equal(tracker.getTranslation(1), '我们现在应该开始');
  });

  it('session switch: old responses from previous session are rejected and do not pollute new session', () => {
    const tracker = new TranslationSessionTracker('meeting-A');

    const reqA = tracker.shouldRequest(1, 'Meeting A content', false);
    assert.equal(reqA.sessionId, 'meeting-A');

    // User switches to Meeting B
    tracker.resetSession('meeting-B');
    assert.equal(tracker.getSessionId(), 'meeting-B');

    // Late response for Meeting A arrives
    const committedA = tracker.commitResult('meeting-A', 1, reqA.version, '会议A内容');
    assert.equal(committedA, false, 'Meeting A response must not be accepted in Meeting B');
    assert.equal(tracker.getTranslation(1), undefined);

    // Meeting B request with same sequenceId 1
    const reqB = tracker.shouldRequest(1, 'Meeting B content', false);
    assert.equal(reqB.sessionId, 'meeting-B');
    const committedB = tracker.commitResult('meeting-B', 1, reqB.version, '会议B内容');
    assert.equal(committedB, true);
    assert.equal(tracker.getTranslation(1), '会议B内容');
  });

  it('failure retry limit: stops re-requesting after 3 failed attempts', () => {
    const tracker = new TranslationSessionTracker('session-1', 3);

    // Attempt 1
    const req1 = tracker.shouldRequest(1, 'Network fail test', false);
    assert.equal(req1.shouldRequest, true);
    tracker.commitResult('session-1', 1, req1.version, null); // Failed

    // Attempt 2
    const req2 = tracker.shouldRequest(1, 'Network fail test', false);
    assert.equal(req2.shouldRequest, true);
    tracker.commitResult('session-1', 1, req2.version, null); // Failed

    // Attempt 3
    const req3 = tracker.shouldRequest(1, 'Network fail test', false);
    assert.equal(req3.shouldRequest, true);
    tracker.commitResult('session-1', 1, req3.version, null); // Failed

    // Attempt 4: Should NOT request anymore
    const req4 = tracker.shouldRequest(1, 'Network fail test', false);
    assert.equal(req4.shouldRequest, false);
  });
});
