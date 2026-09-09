import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeProp, propsForPosition } from '../functions/football.js';
import { normalizeNflverseStats } from '../functions/nflverse.js';

const game = {
  completed: true,
  providerId: '2026_01_BUF_LA',
  season: 2026,
  homeTeamId: 'LA',
  awayTeamId: 'BUF',
};
const bet = {
  market: 'Player prop',
  gradingRule: 'full-game',
  playerId: '00-0030000',
  propKey: 'anytime_td',
  side: 'over',
  line: 0.5,
  rules: { provider: 'FanDuel' },
};
function grade(values, overrides = {}, event = game) {
  const players = normalizeNflverseStats(
    [
      {
        game_id: game.providerId,
        season: '2026',
        season_type: 'REG',
        team: 'BUF',
        player_id: bet.playerId,
        carries: '1',
        ...values,
      },
    ],
    game,
  );
  return gradeProp({ ...bet, ...overrides }, event, { players });
}

void test('anytime touchdown is available for offensive scoring positions', () => {
  for (const position of ['QB', 'RB', 'FB', 'WR', 'TE'])
    assert.ok(propsForPosition(position).some((p) => p.key === bet.propKey));
});

void test('rushing, receiving, and multiple touchdowns all win', () => {
  for (const [rushing_tds, receiving_tds] of [
    ['1', '0'],
    ['0', '1'],
    ['2', '1'],
    ['1', ''],
    ['', '1'],
  ])
    assert.equal(grade({ rushing_tds, receiving_tds }), 'won');
});

void test('zero rushing and receiving touchdowns lose even when passing or return TDs exist', () => {
  assert.equal(
    grade({
      rushing_tds: '0',
      receiving_tds: '0',
      passing_tds: '3',
      punt_return_tds: '1',
    }),
    'lost',
  );
});

void test('missing or malformed stats cannot produce a loss', () => {
  for (const values of [
    {},
    { rushing_tds: '0' },
    { receiving_tds: '0' },
    { rushing_tds: '0', receiving_tds: 'bad' },
  ])
    assert.equal(grade(values), null);
});

void test('unfinished games, absent participation and malformed anytime picks stay pending', () => {
  const values = { rushing_tds: '1', receiving_tds: '0' };
  assert.equal(grade(values, {}, { ...game, completed: false }), null);
  assert.equal(grade({ ...values, carries: '0' }), null);
  assert.equal(grade(values, { side: 'under' }), null);
  assert.equal(grade(values, { line: 1.5 }), null);
});
