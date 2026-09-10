import test from 'node:test';
import assert from 'node:assert/strict';
import {
  funds,
  bankrollAdjustment,
  isGameLive,
  payout,
  weekAt,
  weekStart,
  weekEnd,
  bettingOpen,
  lateJoinBankroll,
  minimumShortfall,
  validateBet,
  grade,
} from '../functions/rules.js';
const c = { startDate: '2026-09-08' },
  now = Date.parse('2026-09-10T15:00:00Z');
const bet = {
  stake: 1000,
  odds: -110,
  startsAt: now + 3600000,
  selection: 'Home −3.5',
  sportsbook: 'FanDuel',
  market: 'Spread',
};
void test('bets accept kickoff and active games until exactly three hours after start', () => {
  for (const elapsed of [0, 3600000, 3 * 3600000 - 1]) {
    assert.equal(validateBet({ ...bet, startsAt: now - elapsed }, now, c, 1000, 1000, 0), 1);
  }
  for (const elapsed of [3 * 3600000, 3 * 3600000 + 1]) {
    assert.throws(() => validateBet({ ...bet, startsAt: now - elapsed }, now, c, 1000, 1000, 0));
  }
  const opening = weekStart(c.startDate, 1);
  assert.throws(() => validateBet({ ...bet, startsAt: opening - 1 }, opening, c, 1000, 1000, 0));
});
void test('late entry defaults count only betting weeks still available', () => {
  assert.equal(
    lateJoinBankroll(Date.parse('2026-09-15T14:00:00Z'), c.startDate),
    1000,
  );
  assert.equal(
    lateJoinBankroll(Date.parse('2026-09-15T05:00:00Z'), c.startDate),
    1000,
  );
  assert.equal(lateJoinBankroll(weekStart(c.startDate, 18), c.startDate), 1000);
  assert.equal(lateJoinBankroll(weekEnd(c.startDate, 18), c.startDate), 0);
});
void test('week one makes the entire $10 bankroll spendable', () => {
  assert.deepEqual(funds(1000, 1000, 0, 1), {
    reserve: 0,
    available: 1000,
    needed: 1000,
  });
  assert.equal(funds(1909, 1000, 1000, 1).available, 1909);
  assert.equal(
    validateBet({ ...bet, stake: 1909 }, now, c, 1909, 1000, 1000),
    1,
  );
  assert.throws(() =>
    validateBet({ ...bet, stake: 1910 }, now, c, 1909, 1000, 1000),
  );
  assert.throws(() =>
    validateBet({ ...bet, stake: 1001 }, now, c, 1000, 1000, 0),
  );
});
void test('next week unlocks prior profit and next $10 allocation', () =>
  assert.equal(funds(2909, 2909, 0, 2).available, 2909));
void test('split stakes count toward the minimum and cannot spend pending returns', () => {
  assert.equal(funds(400, 1000, 600, 1).available, 400);
  assert.equal(funds(400, 1000, 600, 1).needed, 400);
  assert.throws(() =>
    validateBet({ ...bet, stake: 401 }, now, c, 400, 1000, 600),
  );
});
void test('American odds round payout to cents with stake included', () => {
  assert.equal(payout(1000, -110, 'won'), 1909);
  assert.equal(payout(1000, 150, 'won'), 2500);
  assert.equal(payout(15, 410, 'won'), 77);
  assert.equal(payout(15, -410, 'won'), 19);
  assert.equal(payout(1000, -110, 'push'), 1000);
  assert.equal(payout(1000, -110, 'void'), 1000);
  assert.equal(payout(1000, -110, 'lost'), 0);
});
void test('missed weekly minimum charges only the amount still short', () => {
  assert.equal(minimumShortfall(1000), 0);
  assert.equal(minimumShortfall(750), 250);
  assert.equal(minimumShortfall(0), 1000);
});
void test('Monday closes at midnight; Tuesday 10am opens the next week', () => {
  assert.equal(
    bettingOpen(Date.parse('2026-09-15T03:59:59Z'), c.startDate),
    true,
  );
  assert.equal(
    bettingOpen(Date.parse('2026-09-15T04:00:00Z'), c.startDate),
    false,
  );
  assert.equal(weekAt(Date.parse('2026-09-15T13:59:59Z'), c.startDate), 1);
  assert.equal(
    bettingOpen(Date.parse('2026-09-15T13:59:59Z'), c.startDate),
    false,
  );
  assert.equal(weekAt(Date.parse('2026-09-15T14:00:00Z'), c.startDate), 2);
  assert.equal(
    bettingOpen(Date.parse('2026-09-15T14:00:00Z'), c.startDate),
    true,
  );
  assert.equal(weekEnd(c.startDate, 1), Date.parse('2026-09-15T04:00:00Z'));
  assert.throws(() =>
    validateBet(
      { ...bet, startsAt: Date.parse('2026-09-15T15:00:00Z') },
      Date.parse('2026-09-15T13:00:00Z'),
      c,
      1000,
      1000,
      0,
    ),
  );
});
void test('Eastern boundary respects the November daylight-saving change', () => {
  assert.equal(
    new Date(weekStart(c.startDate, 8)).toISOString(),
    '2026-10-27T14:00:00.000Z',
  );
  assert.equal(
    new Date(weekStart(c.startDate, 9)).toISOString(),
    '2026-11-03T15:00:00.000Z',
  );
});
void test('invalid stakes, odds, past games, next-week games, and closed seasons rejected', () => {
  for (const change of [
    { stake: 0 },
    { stake: -1 },
    { stake: 1.5 },
    { odds: 0 },
    { odds: 99 },
    { odds: 110.5 },
    { startsAt: now - 3 * 3600000 },
    { startsAt: weekStart(c.startDate, 2) },
  ])
    assert.throws(() =>
      validateBet({ ...bet, ...change }, now, c, 1000, 1000, 0),
    );
  assert.throws(() =>
    validateBet(bet, weekStart(c.startDate, 19), c, 1000, 1000, 0),
  );
});
void test('result corrections use the payout difference, never award twice', () => {
  const paid = payout(1000, -110, 'won');
  assert.equal(payout(1000, -110, 'lost') - paid, -1909);
  assert.equal(payout(1000, -110, 'won') - paid, 0);
});
const event = {
  completed: true,
  home_team: 'Home',
  away_team: 'Away',
  scores: [
    { name: 'Home', score: '24' },
    { name: 'Away', score: '21' },
  ],
};
void test('full-game automatic settlement grades home/away spread and total pushes', () => {
  assert.equal(
    grade({ market: 'Spread', side: 'home', line: -3 }, event),
    'push',
  );
  assert.equal(
    grade({ market: 'Spread', side: 'away', line: 3.5 }, event),
    'won',
  );
  assert.equal(
    grade({ market: 'Total', side: 'over', line: 45.5 }, event),
    'lost',
  );
  assert.equal(grade({ market: 'Moneyline', side: 'home' }, event), 'won');
});
void test('incomplete games, missing scores and unsupported props require review', () => {
  assert.equal(grade({ market: 'Player prop' }, event), null);
  assert.equal(
    grade(
      { market: 'Moneyline', side: 'home' },
      { ...event, completed: false },
    ),
    null,
  );
  assert.equal(
    grade({ market: 'Moneyline', side: 'home' }, { ...event, scores: [] }),
    null,
  );
});
void test('negative bankroll freezes new spending', () =>
  assert.equal(funds(-100, 1000, 0, 1).available, 0));

void test('weekly ladder credits are automatic, capped and preserve legacy winnings', () => {
  const member = { balance: 1000, bankrollVersion: 2, joinedAt: now };
  assert.equal(bankrollAdjustment(member, now, c.startDate), 0);
  assert.equal(bankrollAdjustment(member, weekStart(c.startDate, 2) - 1, c.startDate), 0);
  assert.equal(bankrollAdjustment(member, weekStart(c.startDate, 2), c.startDate), 1000);
  assert.equal(bankrollAdjustment(member, weekStart(c.startDate, 20), c.startDate), 17000);
  assert.equal(18909 + bankrollAdjustment({ joinedAt: now }, now, c.startDate), 1909);
  const game = { commence_time: new Date(now).toISOString(), completed: false };
  assert.equal(isGameLive(game, now - 1), false);
  assert.equal(isGameLive(game, now), true);
  assert.equal(isGameLive(game, now + 10800000 - 1), true);
  assert.equal(isGameLive(game, now + 10800000), false);
  assert.equal(isGameLive({ ...game, completed: true }, now), false);
});
