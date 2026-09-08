import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGame,
  normalizePlayerStats,
  normalizeRoster,
  gradeProp,
  propsForPosition,
  numericStat,
} from '../functions/football.js';
import { grade } from '../functions/rules.js';
// Synthetic contract fixtures; live provider validation is separately required.
const gameRow = {
  game: {
    id: 1,
    date: { timestamp: 1789070400 },
    stage: 'Regular Season',
    week: 'Week 1',
    status: { short: 'FT' },
  },
  league: { id: 1, season: 2026 },
  teams: { home: { id: 2, name: 'Home' }, away: { id: 3, name: 'Away' } },
  scores: { home: { total: 24 }, away: { total: 21 } },
};
const statsRows = [
  {
    team: { id: 2 },
    groups: [
      {
        name: 'Passing',
        players: [
          {
            player: { id: 8, name: 'Quarterback' },
            statistics: [
              { name: 'yards', value: '250' },
              { name: 'passing touch downs', value: '0' },
            ],
          },
        ],
      },
      {
        name: 'Defensive',
        players: [
          {
            player: { id: 9, name: 'Defender' },
            statistics: [
              { name: 'total tackles', value: '9' },
              { name: 'unassisted tackles', value: '6' },
              { name: 'sacks', value: '0.5' },
            ],
          },
        ],
      },
    ],
  },
];
test('NFL game normalization keeps stable provider IDs and final scores', () => {
  const g = normalizeGame(gameRow);
  assert.equal(g.id, 'nfl_1');
  assert.equal(g.completed, true);
  assert.equal(grade({ market: 'Spread', side: 'home', line: -3 }, g), 'push');
});
test('null final scores, postponed and canceled games do not auto-grade', () => {
  for (const status of ['PST', 'CANC', 'NS', 'Q4'])
    assert.equal(
      normalizeGame({
        ...gameRow,
        game: { ...gameRow.game, status: { short: status } },
      }).completed,
      false,
    );
  const g = normalizeGame({
    ...gameRow,
    scores: { home: { total: null }, away: { total: 21 } },
  });
  assert.equal(g.completed, false);
  assert.equal(
    grade({ market: 'Moneyline', side: 'home' }, { ...g, completed: true }),
    null,
  );
});
test('zero is a real stat; null, blank and malformed values are missing', () => {
  for (const value of [null, undefined, '', ' ', '-', '1/2', '9 yards'])
    assert.equal(numericStat(value), null);
  assert.equal(numericStat('0'), 0);
  assert.equal(numericStat('0.5'), 0.5);
});
test('props match position and separate passing TDs from scoring TDs', () => {
  assert.ok(propsForPosition('QB').some((p) => p.key === 'passing_tds'));
  assert.ok(!propsForPosition('WR').some((p) => p.key === 'passing_tds'));
  assert.ok(propsForPosition('LB').some((p) => p.key === 'total_tackles'));
});
test('player prop win/loss/push uses the chosen exact stat and side', () => {
  const event = normalizeGame(gameRow),
    stats = { players: normalizePlayerStats(statsRows) },
    base = {
      market: 'Player prop',
      gradingRule: 'full-game',
      playerId: '8',
      propKey: 'passing_yards',
      side: 'over',
      line: 249.5,
    };
  assert.equal(gradeProp(base, event, stats), 'won');
  assert.equal(gradeProp({ ...base, side: 'under' }, event, stats), 'lost');
  assert.equal(gradeProp({ ...base, line: 250 }, event, stats), 'push');
  assert.equal(
    gradeProp(
      { ...base, propKey: 'passing_tds', line: 0.5, side: 'under' },
      event,
      stats,
    ),
    'won',
  );
});
test('missing players and unknown stats never grade as zero; custom rules require review', () => {
  const event = normalizeGame(gameRow),
    stats = { players: normalizePlayerStats(statsRows) },
    b = {
      market: 'Player prop',
      gradingRule: 'full-game',
      playerId: '8',
      propKey: 'receiving_yards',
      side: 'under',
      line: 5,
    };
  assert.equal(gradeProp(b, event, stats), null);
  assert.equal(gradeProp({ ...b, playerId: '404' }, event, stats), null);
  assert.equal(
    gradeProp(
      { ...b, propKey: 'passing_yards', gradingRule: 'custom' },
      event,
      stats,
    ),
    null,
  );
});
test('solo and total tackles stay distinct, and fractional sacks are retained', () => {
  const p = normalizePlayerStats(statsRows)['9'];
  assert.equal(p.values.total_tackles, 9);
  assert.equal(p.values.solo_tackles, 6);
  assert.equal(p.values.sacks, 0.5);
});
