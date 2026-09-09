import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  seasonMetrics,
  pendingExplanation,
  healthQueue,
} from '../lib/season-metrics.js';
import { weeklyStakePatch } from '../functions/weekly-summary.js';
await test('late-entry stats use actual allocation and preserve tied finishes', () => {
  const m = seasonMetrics(
    { id: 'a', startingBankroll: 12000, balance: 11900, joinedAt: 1 },
    [{ status: 'pending', stake: 100 }],
    [
      { id: '1', at: 1, delta: -6000, kind: 'late entry allocation' },
      { id: '2', at: 2, delta: -100, kind: 'stake' },
    ],
    [
      {
        week: 2,
        rows: [
          { uid: 'a', balance: 12000 },
          { uid: 'b', balance: 12000 },
          { uid: 'c', balance: 13000 },
        ],
      },
    ],
  );
  assert.equal(m.net, -100);
  assert.equal(m.pendingStake, 100);
  assert.equal(m.trend.at(-1).balance, 11900);
  assert.equal(m.finishes[0].rank, 2);
});
await test('summaries preserve other weeks and reject impossible negative progress', () => {
  assert.deepEqual(weeklyStakePatch({ 1: 500, 2: 400 }, 1, -500).weeklyStakes, {
    1: 0,
    2: 400,
  });
  assert.throws(() => weeklyStakePatch({ 1: 100 }, 1, -200), /reconciliation/);
});
await test('pending explanations distinguish future, custom, stats and parlay results', () => {
  const b = {
    status: 'pending',
    startsAt: 100,
    autoEligible: true,
    market: 'Moneyline',
  };
  assert.match(pendingExplanation(b, [], 0), /not started/);
  assert.match(
    pendingExplanation({ ...b, autoEligible: false }, [], 200),
    /Commissioner/,
  );
  assert.match(
    pendingExplanation({ ...b, pendingState: 'stats' }, [], 200),
    /Missing data is never graded as zero/,
  );
  assert.match(
    pendingExplanation(
      { ...b, market: 'Parlay', legs: [{ market: 'Other' }] },
      [],
      200,
    ),
    /verification/,
  );
});
await test('health queue prioritizes reviews then manual results then aging picks', () => {
  const now = 40 * 3600000;
  const queue = healthQueue(
    [
      { id: 'aged', startsAt: 0, status: 'pending', autoEligible: true },
      { id: 'manual', startsAt: 1, status: 'pending' },
      {
        id: 'review',
        status: 'won',
        review: { status: 'open', requestedAt: 2 },
      },
      { id: 'future', startsAt: now + 1000, status: 'pending' },
    ],
    now,
  );
  assert.deepEqual(
    queue.map((b) => b.id),
    ['review', 'manual', 'aged'],
  );
});
