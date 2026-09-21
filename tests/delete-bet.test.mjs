import test from 'node:test';
import assert from 'node:assert/strict';
import { deletePendingBet } from '../functions/delete-bet.js';

function fixture(status = 'pending') {
  const records = new Map([
    [
      'bets/pick',
      {
        uid: 'player',
        username: 'Player',
        selection: 'Pick',
        status,
        stake: 400,
        week: 1,
        paid: 0,
        startsAt: Date.now() + 3600000,
      },
    ],
    [
      'members/player',
      { balance: 17600, weeklyStakesVersion: 1, weeklyStakes: { 1: 400 } },
    ],
  ]);
  let sequence = 0;
  const db = {
    doc: (path) => ({ path }),
    collection: (path) => ({ doc: () => ({ path: `${path}/${++sequence}` }) }),
    runTransaction: async (fn) => {
      const staged = new Map(records);
      const result = await fn({
        get: async (ref) => ({
          ref,
          exists: staged.has(ref.path),
          data: () => staged.get(ref.path),
        }),
        update: (ref, data) =>
          staged.set(ref.path, { ...staged.get(ref.path), ...data }),
        create: (ref, data) => {
          assert.equal(staged.has(ref.path), false);
          staged.set(ref.path, data);
        },
        delete: (ref) => staged.delete(ref.path),
      });
      records.clear();
      for (const entry of staged) records.set(...entry);
      return result;
    },
  };
  return { db, records };
}

void test('pending deletion refunds stake, reverses weekly stake and retains history; retry does not refund twice', async () => {
  const { db, records } = fixture();
  await deletePendingBet(db, 'player', 'pick');
  assert.equal(records.has('bets/pick'), false);
  assert.equal(records.get('members/player').balance, 18000);
  assert.equal(records.get('deletedBets/pick').uid, 'player');
  const ledger = [...records]
    .filter(([path]) => path.startsWith('ledger/'))
    .map(([, data]) => data);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].delta, 400);
  assert.equal(ledger[0].stakeDelta, -400);
  assert.equal(ledger[0].week, 1);
  await deletePendingBet(db, 'player', 'pick');
  assert.equal(records.get('members/player').balance, 18000);
  assert.equal(records.size, 4);
  await assert.rejects(deletePendingBet(db, 'other', 'pick'), /own bets/);
});

void test('other players and settled bets cannot be deleted', async () => {
  const { db, records } = fixture();
  await assert.rejects(deletePendingBet(db, 'other', 'pick'), /own bets/);
  assert.equal(records.get('members/player').balance, 17600);
  for (const status of ['won', 'lost', 'push', 'void']) {
    const f = fixture(status);
    await assert.rejects(
      deletePendingBet(f.db, 'player', 'pick'),
      /Only pending/,
    );
    assert.equal(f.records.has('bets/pick'), true);
    assert.equal(f.records.get('members/player').balance, 17600);
  }
});

void test('missing and invalid bet IDs are rejected', async () => {
  const { db } = fixture();
  for (const id of ['', null, 'bets/pick'])
    await assert.rejects(deletePendingBet(db, 'player', id), /Invalid bet/);
  await assert.rejects(deletePendingBet(db, 'player', 'missing'), /not found/);
});

void test('kickoff locks old bets while new bets have exactly three minutes, without wallet changes on rejection', async (t) => {
  const now = 1800000000000;
  t.mock.method(Date, 'now', () => now);
  for (const [label, patch, allowed] of [
    ['before kickoff', { startsAt: now + 1, createdAt: now - 86400000 }, true],
    ['at kickoff', { startsAt: now, createdAt: now - 180000 }, false],
    [
      'live fresh bet',
      { startsAt: now - 3600000, createdAt: now - 179999 },
      true,
    ],
    [
      'grace expires',
      { startsAt: now - 3600000, createdAt: now - 180000 },
      false,
    ],
    ['past grace', { startsAt: now - 3600000, createdAt: now - 180001 }, false],
    ['legacy missing placement time', { startsAt: now - 1 }, false],
    ['invalid start', { startsAt: null }, false],
    ['future placement time', { startsAt: now - 1, createdAt: now + 1 }, false],
    [
      'parlay earliest leg started',
      {
        startsAt: now + 3600000,
        createdAt: now - 180000,
        legs: [{ startsAt: now }, { startsAt: now + 3600000 }],
      },
      false,
    ],
    [
      'parlay grace',
      { startsAt: now, createdAt: now - 1000, legs: [{ startsAt: now }] },
      true,
    ],
  ]) {
    const { db, records } = fixture();
    Object.assign(records.get('bets/pick'), patch);
    const before = structuredClone(records);
    if (allowed) {
      await deletePendingBet(db, 'player', 'pick');
      assert.equal(records.has('bets/pick'), false, label);
      assert.equal(records.get('members/player').balance, 18000, label);
    } else {
      await assert.rejects(
        deletePendingBet(db, 'player', 'pick'),
        /locked/,
        label,
      );
      assert.deepEqual(records, before, label);
    }
  }
});
