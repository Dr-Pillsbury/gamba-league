import test from 'node:test';
import assert from 'node:assert/strict';
import { sameDaySunday, verifySundayFinal } from '../functions/sunday-finals.js';
import { grade } from '../functions/rules.js';

const now = Date.parse('2026-09-13T20:00:00Z');
const game = { espnId: '123', season: 2026, commence_time: '2026-09-13T17:00:00Z',
  home_team: 'LA', away_team: 'BUF', homeTeamId: 'LA', awayTeamId: 'BUF', completed: false };
function source({ final = true, team = 'LAR', score = 24, date = game.commence_time, missing = false } = {}) {
  return async (url) => ({ ok: !missing, status: missing ? 503 : 200, json: async () => {
    if (url.endsWith('/status')) return { type: { completed: final, state: final ? 'post' : 'in', name: final ? 'STATUS_FINAL' : 'STATUS_IN_PROGRESS' } };
    if (url.endsWith('/competitions/123')) return { id: '123', date,
      competitors: [{ id: '1', homeAway: 'home' }, { id: '2', homeAway: 'away' }] };
    if (url.includes('/teams/')) return { abbreviation: url.endsWith('/1') ? team : 'BUF' };
    return { value: url.includes('/competitors/1/') ? score : 21 };
  } });
}
void test('Sunday confirmed final enables same-day full-game grading', async () => {
  const final = await verifySundayFinal(game, now, source());
  assert.equal(final.completed, true);
  assert.equal(final.finalSource, 'espn');
  assert.equal(grade({ market: 'Moneyline', side: 'home' }, final), 'won');
  assert.equal(grade({ market: 'Spread', side: 'home', line: -3 }, final), 'push');
  assert.equal(grade({ market: 'Total', side: 'over', line: 44.5 }, final), 'won');
});
void test('three hours elapsed never substitutes for a final status', async () => {
  assert.equal((await verifySundayFinal(game, now, source({ final: false }))).completed, false);
});
void test('missing data, mismatched teams, wrong kickoff and invalid scores fail closed', async () => {
  for (const options of [{ missing: true }, { team: 'NYJ' }, { score: null }, { score: -1 }, { date: '2026-09-12T17:00:00Z' }]) {
    await assert.rejects(verifySundayFinal(game, now, source(options)));
  }
});
void test('only same-day Eastern Sundays fetch finals, including DST and UTC Monday', async () => {
  assert.equal(sameDaySunday(game, now), true);
  assert.equal(sameDaySunday(game, Date.parse('2026-09-13T16:59:59Z')), false);
  assert.equal(sameDaySunday(game, Date.parse('2026-09-14T00:00:00Z')), true);
  assert.equal(sameDaySunday(game, Date.parse('2026-09-14T04:00:00Z')), false);
  assert.equal(sameDaySunday({ ...game, commence_time: '2026-11-08T18:00:00Z' }, Date.parse('2026-11-09T01:00:00Z')), true);
  const noFetch = () => { throw Error('unexpected fetch'); };
  assert.equal(await verifySundayFinal(game, Date.parse('2026-09-14T14:00:00Z'), noFetch), game);
  assert.equal(await verifySundayFinal({ ...game, espnId: null }, now, noFetch).then(g => g.completed), false);
});
