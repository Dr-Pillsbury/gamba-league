import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv,
  kickoff,
  normalizeSchedule,
  normalizeNflverseRosters,
  normalizeNflverseStats,
  syncNflverse,
  SOURCES,
} from '../functions/nflverse.js';
import { gradeProp } from '../functions/football.js';
const row = {
  game_id: '2026_01_BUF_LA',
  season: '2026',
  game_type: 'REG',
  week: '1',
  gameday: '2026-09-10',
  gametime: '20:20',
  away_team: 'BUF',
  home_team: 'LA',
  away_score: '21',
  home_score: '24',
  stadium: 'Stadium',
};
const nextDay = Date.parse('2026-09-11T14:00:00Z');
void test('CSV preserves commas, escaped quotes, newlines and rejects incomplete data', () => {
  assert.deepEqual(parseCsv('id,name\r\n1,"A, ""B""\nC"\r\n'), [
    { id: '1', name: 'A, "B"\nC' },
  ]);
  assert.throws(() => parseCsv('a,b\n1'));
  assert.throws(() => parseCsv('a,b\n1,"unfinished'));
});
void test('Eastern kickoff handles summer and winter offsets', () => {
  assert.equal(
    kickoff('2026-09-10', '20:20'),
    Date.parse('2026-09-11T00:20:00Z'),
  );
  assert.equal(
    kickoff('2026-11-08', '13:00'),
    Date.parse('2026-11-08T18:00:00Z'),
  );
  assert.equal(kickoff('2026-09-10', ''), null);
});
void test('scores settle next day only, missing scores and wrong seasons remain ineligible', () => {
  assert.equal(
    normalizeSchedule([row], 2026, Date.parse('2026-09-11T03:59:00Z'))[0]
      .completed,
    false,
  );
  assert.equal(normalizeSchedule([row], 2026, nextDay)[0].completed, true);
  assert.equal(
    normalizeSchedule([{ ...row, home_score: '' }], 2026, nextDay)[0].completed,
    false,
  );
  assert.equal(normalizeSchedule([row], 2025, nextDay).length, 0);
});
void test('rosters retain active GSIS identities and reject old season or inactive entries', () => {
  const p = {
    season: '2026',
    team: 'BUF',
    gsis_id: '00-0030000',
    full_name: 'Player',
    position: 'QB',
    status: 'ACT',
    jersey_number: '1',
  };
  assert.equal(
    normalizeNflverseRosters(
      [p, p, { ...p, status: 'RES' }, { ...p, season: '2025' }],
      2026,
    ).BUF.length,
    1,
  );
});
void test('game and player IDs prevent cross-game grading; explicit zero grades, missing stats do not', () => {
  const game = normalizeSchedule([row], 2026, nextDay)[0];
  const stat = {
    game_id: row.game_id,
    season: '2026',
    season_type: 'REG',
    team: 'BUF',
    player_id: '00-0030000',
    player_display_name: 'Player',
    passing_tds: '0',
    receiving_yards: '',
    def_sacks: '0.5',
  };
  const players = normalizeNflverseStats(
    [stat, { ...stat, game_id: '2026_02_BUF_LA' }],
    game,
  );
  const b = {
    market: 'Player prop',
    gradingRule: 'full-game',
    playerId: stat.player_id,
    propKey: 'passing_tds',
    side: 'under',
    line: 0.5,
  };
  assert.equal(gradeProp(b, game, { players }), 'won');
  assert.equal(
    gradeProp({ ...b, propKey: 'receiving_yards' }, game, { players }),
    null,
  );
  assert.equal(players[stat.player_id].values.sacks, 0.5);
  assert.equal(players[stat.player_id].values.total_tackles, undefined);
  assert.throws(() => normalizeNflverseStats([stat, stat], game));
});
void test('import caches rosters and treats unpublished season stats as pending', async () => {
  const data = new Map([
    ['sync/nflverse', { season: 2026, rostersAt: nextDay }],
  ]);
  const csv = Object.keys(row).join(',') + '\n' + Object.values(row).join(',');
  const calls = [];
  const store = {
    get: async (p) => data.get(p),
    set: async (p, v) => data.set(p, v),
  };
  const result = await syncNflverse({
    store,
    season: 2026,
    now: nextDay,
    pendingBets: [
      {
        eventId: 'nv_' + row.game_id,
        status: 'pending',
        market: 'Player prop',
      },
    ],
    fetchImpl: async (url) => {
      calls.push(url);
      return url === SOURCES.games
        ? new Response(csv)
        : new Response('', { status: 404 });
    },
  });
  assert.equal(result.games, 1);
  assert.equal(result.rosters, 0);
  assert.equal(calls.length, 2);
  assert.equal(data.get('gameStats/nv_' + row.game_id).hasStats, false);
});

void test('Sunday imports settle verified finals and retain them through an endpoint outage', async () => {
  const now = Date.parse('2026-09-13T20:00:00Z');
  const sunday = { ...row, game_id: '2026_01_BUF_LA', gameday: '2026-09-13', gametime: '13:00', espn: '123' };
  const csv = Object.keys(sunday).join(',') + '\n' + Object.values(sunday).join(',');
  const data = new Map([['sync/nflverse', { season: 2026, rostersAt: now }]]);
  const store = { get: async p => data.get(p), set: async (p, v) => data.set(p, v) };
  let unavailable = false;
  const fetchImpl = async url => {
    if (url === SOURCES.games) return new Response(csv);
    if (unavailable) throw Error('Provider unavailable');
    let value;
    if (url.endsWith('/status')) value = { type: { completed: true, state: 'post', name: 'STATUS_FINAL' } };
    else if (url.endsWith('/competitions/123')) value = { id: '123', date: '2026-09-13T17:00:00Z', competitors: [{id:'1', homeAway:'home'}, {id:'2', homeAway:'away'}] };
    else if (url.includes('/teams/')) value = { abbreviation: url.endsWith('/1') ? 'LAR' : 'BUF' };
    else value = { value: url.includes('/competitors/1/') ? 24 : 21 };
    return Response.json(value);
  };
  await syncNflverse({ store, season: 2026, now, fetchImpl });
  const path = 'events/nv_' + sunday.game_id;
  assert.equal(data.get(path).completed, true);
  assert.equal(data.get(path).finalSource, 'espn');
  unavailable = true;
  await syncNflverse({ store, season: 2026, now: now + 3600000, fetchImpl });
  assert.equal(data.get(path).completed, true);
  assert.deepEqual(data.get(path).scores, [{name:'LA', score:24}, {name:'BUF', score:21}]);
  data.delete(path);
  await syncNflverse({ store, season: 2026, now, fetchImpl });
  assert.equal(data.get(path).completed, false);
  assert.match(data.get(path).finalCheckError, /Provider unavailable/);
});
