import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  db,
  projectId,
  googleUser,
  callable,
  seasonStart,
} from '../../scripts/local-firebase.mjs';
import { bettingOpen, weekEnd } from '../../functions/rules.js';
let admin, player;
const start = seasonStart();
const input = (stake = 600) => ({
  requestId: randomUUID(),
  market: 'Other',
  selection: 'Local test pick',
  stake,
  odds: 100,
  startsAt: Math.min(Date.now() + 3600000, weekEnd(start, 1) - 1),
});
before(async () => {
  assert.equal(projectId, 'demo-gamba-league');
  assert.ok(
    bettingOpen(Date.now(), start),
    'Run placement integration tests during the league betting window.',
  );
  const cleared = await fetch(
    `http://127.0.0.1:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  assert.equal(cleared.ok, true);
  admin = await googleUser('commissioner');
  player = await googleUser('player');
  await db.doc('config/league').set({
    startDate: start,
    commissionerUids: [admin.uid],
    backendEnabled: true,
    dataSyncEnabled: false,
    autoSettlementEnabled: false,
  });
  await callable('joinLeague', admin, { username: 'Commissioner' });
  await callable('joinLeague', player, { username: 'Player' });
});
after(async () => {
  await db.terminate();
});

void test('paused league rejects new bets without debiting the wallet', async () => {
  const before = (await db.doc('members/' + player.uid).get()).data().balance;
  await db.doc('config/league').update({ backendEnabled: false });
  try {
    await assert.rejects(
      callable('placeBet', player, input()),
      /FAILED_PRECONDITION/,
    );
    assert.equal(
      (await db.doc('members/' + player.uid).get()).data().balance,
      before,
    );
  } finally {
    await db.doc('config/league').update({ backendEnabled: true });
  }
});

void test('concurrent overspend permits one debit; retries are idempotent', async () => {
  const picks = [input(), input()];
  const results = await Promise.allSettled(
    picks.map((p) => callable('placeBet', player, p)),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const accepted = picks[results.findIndex((r) => r.status === 'fulfilled')];
  await callable('placeBet', player, accepted);
  const member = (await db.doc('members/' + player.uid).get()).data();
  assert.equal(member.balance, 17400);
  assert.equal(member.weeklyStakes[1], 600);
  assert.equal(
    (await db.collection('ledger').where('uid', '==', player.uid).get()).size,
    1,
  );
});
void test('deletion and settlement race refunds exactly once and preserves summaries', async () => {
  const person = await googleUser('race');
  await callable('joinLeague', person, { username: 'Race' });
  const pick = input(500);
  await callable('placeBet', person, pick);
  const id = person.uid + '_' + pick.requestId;
  // Void is valid before kickoff, so both operations are legal contenders.
  await Promise.allSettled([
    callable('deleteBet', person, { betId: id }),
    callable('settleBet', admin, {
      betId: id,
      result: 'void',
      reason: 'Local race verification',
    }),
  ]);
  const member = (await db.doc('members/' + person.uid).get()).data();
  assert.equal(member.balance, 18000);
  assert.equal(member.weeklyStakes[1], 0);
  const ledger = await db
    .collection('ledger')
    .where('uid', '==', person.uid)
    .get();
  assert.equal(ledger.size, 2);
  assert.equal(
    ledger.docs.reduce((n, d) => n + d.data().delta, 0),
    0,
  );
  await callable('placeBet', person, pick);
  assert.equal(
    (await db.doc('members/' + person.uid).get()).data().balance,
    18000,
  );
});
void test('void, correction, repeated result and review confirmation reconcile', async () => {
  const person = await googleUser('correction');
  await callable('joinLeague', person, { username: 'Correction' });
  const pick = input(500);
  await callable('placeBet', person, pick);
  const id = person.uid + '_' + pick.requestId;
  await db.doc('bets/' + id).update({ startsAt: Date.now() - 1000 });
  const settle = (result) =>
    callable('settleBet', admin, {
      betId: id,
      result,
      reason: 'Local verified correction',
    });
  await settle('void');
  await settle('won');
  await settle('won');
  let member = (await db.doc('members/' + person.uid).get()).data();
  assert.equal(member.balance, 18500);
  assert.equal(member.weeklyStakes[1], 500);
  await callable('flagBet', person, {
    betId: id,
    reason: 'Please check this local result',
  });
  await settle('won');
  assert.equal(
    (await db.doc('bets/' + id).get()).data().review.status,
    'resolved',
  );
  await settle('lost');
  member = (await db.doc('members/' + person.uid).get()).data();
  assert.equal(member.balance, 17500);
  assert.equal(member.weeklyStakes[1], 500);
  const ledger = await db
    .collection('ledger')
    .where('uid', '==', person.uid)
    .get();
  assert.equal(
    18000 + ledger.docs.reduce((n, d) => n + d.data().delta, 0),
    member.balance,
  );
});
void test('legacy account summary initializes transactionally from all nonvoid bets', async () => {
  const person = await googleUser('legacy');
  await db
    .doc('members/' + person.uid)
    .set({ username: 'Legacy', balance: 17700, joinedAt: Date.now() });
  await db
    .doc('bets/legacy-pick')
    .set({ uid: person.uid, week: 1, status: 'pending', stake: 300 });
  await db
    .doc('bets/legacy-void')
    .set({ uid: person.uid, week: 1, status: 'void', stake: 200 });
  await callable('placeBet', person, input(400));
  const member = (await db.doc('members/' + person.uid).get()).data();
  assert.equal(member.balance, 17300);
  assert.equal(member.weeklyStakesVersion, 1);
  assert.equal(member.weeklyStakes[1], 700);
});
void test('permissions deny direct money writes, nonmembers, unauthenticated calls and noncommissioners', async () => {
  const outsider = await googleUser('outsider');
  const path = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;
  const write = await fetch(path + '/members/' + player.uid, {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer ' + player.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: { balance: { integerValue: '999999' } } }),
  });
  assert.equal(write.status, 403);
  const read = await fetch(path + '/bets', {
    headers: { Authorization: 'Bearer ' + outsider.token },
  });
  assert.equal(read.status, 403);
  await assert.rejects(callable('placeBet', null, input()), /UNAUTHENTICATED/);
  await assert.rejects(
    callable('settleBet', player, {
      betId: 'anything',
      result: 'won',
      reason: 'Not authorized',
    }),
    /PERMISSION_DENIED/,
  );
  const collision = await googleUser('collision');
  await assert.rejects(
    callable('joinLeague', collision, { username: 'pLaYeR' }),
    /taken/,
  );
});
