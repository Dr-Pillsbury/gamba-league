import { easternDate } from './rules.js';

const root = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
const teamCode = (code) => ({ LAR: 'LA', WSH: 'WAS' }[code] ?? code);

export function sameDaySunday(game, now) {
  const day = easternDate(now);
  return new Date(day + 'T12:00:00Z').getUTCDay() === 0 &&
    easternDate(Date.parse(game.commence_time)) === day &&
    now >= Date.parse(game.commence_time);
}

// Never infer a final from elapsed time or from a live score. All paths are
// constructed locally; provider-supplied URLs are not followed.
export async function verifySundayFinal(game, now, fetchImpl = fetch) {
  if (!sameDaySunday(game, now) || !/^\d+$/.test(game.espnId ?? '')) return game;
  const base = `${root}/events/${game.espnId}/competitions/${game.espnId}`;
  const read = async (url) => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error(`Sunday final check failed (HTTP ${response.status}).`);
    return response.json();
  };
  const status = await read(base + '/status');
  if (status.type?.completed !== true || status.type?.state !== 'post' ||
      !['STATUS_FINAL', 'STATUS_FINAL_OVERTIME'].includes(status.type?.name)) return game;
  const competition = await read(base);
  if (competition.id !== game.espnId ||
      Date.parse(competition.date) !== Date.parse(game.commence_time) ||
      competition.competitors?.length !== 2) throw Error('Sunday final game identity did not match.');
  const scores = await Promise.all(['home', 'away'].map(async (side) => {
    const competitor = competition.competitors.find((c) => c.homeAway === side);
    if (!/^\d+$/.test(competitor?.id ?? '')) throw Error('Sunday final team is missing.');
    const [team, score] = await Promise.all([
      read(`${root}/seasons/${game.season}/teams/${competitor.id}`),
      read(`${base}/competitors/${competitor.id}/score`),
    ]);
    if (teamCode(team.abbreviation) !== game[side + 'TeamId'] ||
        !Number.isSafeInteger(score.value) || score.value < 0) throw Error('Sunday final team or score did not match.');
    return { name: game[side + '_team'], score: score.value };
  }));
  return { ...game, scores, completed: true, status: 'FT',
    finalSource: 'espn', finalVerifiedAt: now, finalCheckError: '' };
}
