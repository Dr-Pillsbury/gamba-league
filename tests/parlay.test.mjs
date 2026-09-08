import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeParlayLeg,
  validateParlayLegs,
  gradeParlay,
} from '../functions/parlay.js';
import { syncNflverse, SOURCES } from '../functions/nflverse.js';
import { payout } from '../functions/rules.js';

const now = Date.parse('2026-09-09T16:00:00Z');
const config = { startDate: '2026-09-08' };
const game = {
  provider: 'nflverse',
  status: 'NS',
  completed: false,
  commence_time: '2026-09-11T00:20:00Z',
  home_team: 'LA',
  away_team: 'BUF',
};
const finished = {
  ...game,
  completed: true,
  scores: [
    { name: 'LA', score: 24 },
    { name: 'BUF', score: 21 },
  ],
};
const moneyline = { market: 'Moneyline', eventId: 'g1', side: 'home' };
const total = { market: 'Total', eventId: 'g2', side: 'over', line: 40.5 };
const normalize = (leg, ev = game, players = []) =>
  normalizeParlayLeg(leg, ev, players, now, config);
const bet = { legs: [normalize(moneyline), normalize(total)] };
const events = { g1: finished, g2: finished };

test('parlays win only when all legs win across their respective games', () => {
  assert.equal(gradeParlay(bet, events, {}).result, 'won');
  assert.equal(gradeParlay(bet, { g1: finished }, {}).result, null);
  assert.equal(gradeParlay(bet, { g1: game, g2: finished }, {}).result, null);
  assert.equal(payout(1000, 260, gradeParlay(bet, events, {}).result), 3600);
});
test('a losing leg loses even with unfinished or unverified legs', () => {
  const losing = {
    ...bet,
    legs: [
      { ...bet.legs[0], side: 'away' },
      { market: 'Other', status: 'pending' },
    ],
  };
  assert.equal(gradeParlay(losing, { g1: finished }, {}).result, 'lost');
});
test('Other legs require commissioner verification and cannot self-report a win', () => {
  const custom = normalize({
    market: 'Other',
    eventId: 'g2',
    selection: 'Custom condition',
    status: 'won',
    verifiedBy: 'spoof',
  });
  assert.equal(custom.status, 'pending');
  assert.equal(custom.verifiedBy, undefined);
  const mixed = { legs: [bet.legs[0], { ...custom, status: 'won' }] };
  assert.equal(gradeParlay(mixed, events, {}).result, null);
  mixed.legs[1].verifiedBy = 'commissioner';
  assert.equal(gradeParlay(mixed, events, {}).result, 'won');
});
test('push and void refund only after every remaining leg resolves without a loss', () => {
  const tied = { ...bet, legs: [bet.legs[0], { ...bet.legs[1], line: 45 }] };
  assert.equal(gradeParlay(tied, events, {}).result, 'push');
  assert.equal(gradeParlay(tied, { g2: finished }, {}).result, null);
  assert.equal(
    gradeParlay(
      { ...tied, legs: [{ ...tied.legs[0], side: 'away' }, tied.legs[1]] },
      events,
      {},
    ).result,
    'lost',
  );
  assert.equal(payout(1000, 260, 'push'), 1000);
  assert.equal(
    gradeParlay(
      {
        legs: [
          bet.legs[0],
          { market: 'Other', status: 'void', verifiedBy: 'commissioner' },
        ],
      },
      events,
      {},
    ).result,
    'push',
  );
});
test('anytime touchdown parlay legs accept rushing or receiving and retain participation checks', () => {
  const prop = normalize(
    {
      market: 'Player prop',
      eventId: 'g2',
      playerId: 'p',
      propKey: 'anytime_td',
    },
    game,
    [{ id: 'p', name: 'Player', position: 'TE' }],
  );
  assert.equal(prop.line, 0.5);
  assert.equal(prop.side, 'over');
  const parlay = { rules: { provider: 'FanDuel' }, legs: [bet.legs[0], prop] };
  for (const values of [{ rushing_tds: 1 }, { receiving_tds: 1 }]) {
    assert.equal(
      gradeParlay(parlay, events, {
        g2: { players: { p: { participated: true, values } } },
      }).result,
      'won',
    );
    assert.equal(
      gradeParlay(parlay, events, { g2: { players: { p: { values } } } })
        .result,
      null,
    );
  }
  assert.equal(gradeParlay(parlay, events, {}).result, null);
});
test('leg validation rejects past, next-week, completed, unknown and malformed picks', () => {
  assert.throws(() => normalize(moneyline, { ...game, completed: true }));
  assert.throws(() =>
    normalize(moneyline, { ...game, commence_time: '2026-09-08T15:00:00Z' }),
  );
  assert.throws(() =>
    normalize(moneyline, { ...game, commence_time: '2026-09-16T15:00:00Z' }),
  );
  assert.throws(() => normalize(moneyline, null));
  assert.throws(() => normalize({ market: 'Parlay' }));
  assert.throws(() => normalize({ ...total, line: null }));
  assert.throws(() => normalize({ ...total, side: 'home' }));
  assert.throws(() => normalize({ market: 'Other', selection: ' ' }));
  assert.throws(() =>
    normalize({
      market: 'Player prop',
      playerId: 'unknown',
      propKey: 'anytime_td',
    }),
  );
  assert.equal(
    normalize(
      { market: 'Other', selection: 'Manual condition', startsAt: now + 10000 },
      null,
    ).eventId,
    null,
  );
});
test('duplicate selections, fewer than two and excessive legs are rejected', () => {
  assert.doesNotThrow(() => validateParlayLegs(bet.legs));
  assert.throws(() => validateParlayLegs([bet.legs[0]]));
  assert.throws(() =>
    validateParlayLegs([
      bet.legs[0],
      { ...bet.legs[0], selection: 'Changed label' },
    ]),
  );
  assert.throws(() => validateParlayLegs(Array(21).fill(bet.legs[0])));
});
test('nflverse imports box scores for player props nested inside pending parlays', async () => {
  const csv =
    'game_id,season,game_type,week,gameday,gametime,away_team,home_team,away_score,home_score,stadium\n2026_01_BUF_LA,2026,REG,1,2026-09-10,20:20,BUF,LA,21,24,Stadium';
  const writes = new Map(),
    calls = [];
  const syncAt = Date.parse('2026-09-11T16:00:00Z');
  const store = {
    get: async () => ({ season: 2026, rostersAt: syncAt }),
    set: async (key, value) => writes.set(key, value),
  };
  await syncNflverse({
    store,
    season: 2026,
    now: syncAt,
    pendingBets: [
      {
        status: 'pending',
        market: 'Parlay',
        legs: [{ eventId: 'nv_2026_01_BUF_LA', market: 'Player prop' }],
      },
    ],
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(url === SOURCES.games ? csv : 'player_id,game_id\n');
    },
  });
  assert.ok(calls.includes(SOURCES.stats(2026)));
  assert.ok(writes.has('gameStats/nv_2026_01_BUF_LA'));
});
