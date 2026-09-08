import {
  normalizeGame,
  normalizeRoster,
  normalizePlayerStats,
} from './football.js';

export function createApiNflClient({
  key,
  reserveRequest,
  recordRemaining,
  fetchImpl = fetch,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
}) {
  let last = 0,
    runCalls = 0;
  return async function request(path, params) {
    if (!key?.trim()) throw Error('API_SPORTS_KEY is not configured.');
    if (runCalls >= 20)
      throw Error(
        'This refresh reached its 20-request allowance. Cached results are preserved.',
      );
    const delay = 6500 - (now() - last);
    if (last && delay > 0) await pause(delay);
    await reserveRequest();
    runCalls++;
    last = now();
    const url = new URL('https://v1.american-football.api-sports.io/' + path);
    for (const [k, v] of Object.entries(params ?? {}))
      url.searchParams.set(k, String(v));
    const res = await fetchImpl(url, {
      headers: { 'x-apisports-key': key.trim() },
      signal: AbortSignal.timeout(20000),
    });
    const remaining = res.headers.get('x-ratelimit-requests-remaining');
    if (remaining !== null && /^\d+$/.test(remaining))
      await recordRemaining(Number(remaining));
    if (!res.ok)
      throw Error(
        'API-NFL returned HTTP ' +
          res.status +
          '. Refresh stopped; no rapid retries.',
      );
    const data = await res.json();
    if (typeof data.errors?.plan === 'string' && /season/i.test(data.errors.plan))
      throw Error(
        'API-NFL subscription does not include the requested season. The supplied free account permits 2022–2024 only; 2026 data is unavailable.',
      );
    if (data.errors && Object.keys(data.errors).length)
      throw Error(
        'API-NFL rejected the request. Check your plan, season access, or quota in its dashboard.',
      );
    if (!Array.isArray(data.response))
      throw Error('API-NFL returned an unexpected response shape.');
    if (data.paging?.total > 1)
      throw Error(
        'API-NFL returned multiple pages. Import paused to avoid using an incomplete roster or statistics.',
      );
    return data.response;
  };
}

// Store abstraction supports a local owner-run import and a future Cloud Function.
export async function syncNfl({
  store,
  request,
  season,
  now = Date.now(),
  pendingBets = [],
}) {
  const old = await store.get('sync/nfl');
  let coverage = old?.season === season ? old.coverage : null;
  if (!coverage || now - (old?.coverageAt ?? 0) > 7 * 86400000) {
    const leagues = await request('leagues', { id: 1, season });
    coverage = leagues
      .find((l) => l.league?.id === 1)
      ?.seasons?.find((s) => Number(s.year) === season)?.coverage;
    if (!coverage)
      throw Error(
        'API-NFL does not report coverage for the configured season on this account.',
      );
    await store.set('sync/nfl', {
      ...(old ?? {}),
      season,
      coverage,
      coverageAt: now,
    });
  }
  const rows = await request('games', { league: 1, season });
  const games = rows
    .map((r) => normalizeGame(r, now))
    .filter((g) => g && g.season === season && g.stage === 'Regular Season');
  if (!games.length)
    throw Error(
      'No regular-season schedule is available for this season; previous data was preserved.',
    );
  for (const game of games) await store.set('events/' + game.id, game);
  const upcoming = games.filter(
    (g) =>
      !g.completed &&
      ['NS'].includes(g.status) &&
      Date.parse(g.commence_time) > now &&
      Date.parse(g.commence_time) < now + 8 * 86400000,
  );
  // Settle-needed box scores take priority over roster enrichment.
  const statGames = games.filter(
    (g) =>
      g.completed &&
      pendingBets.some(
        (b) =>
          b.eventId === g.id &&
          b.market === 'Player prop' &&
          b.status === 'pending',
      ),
  );
  let statCount = 0,
    rosterCount = 0;
  const playerStatsCovered =
    coverage.games?.statistics?.players ?? coverage.games?.statisitcs?.players;
  if (playerStatsCovered)
    for (const game of statGames.slice(0, 8)) {
      const path = 'gameStats/' + game.id,
        cached = await store.get(path);
      if (cached && now - cached.syncedAt < 6 * 3600000) continue;
      const raw = await request('games/statistics/players', {
        id: game.providerId,
      });
      const players = normalizePlayerStats(raw);
      await store.set(path, {
        eventId: game.id,
        players,
        syncedAt: now,
        hasStats: Object.keys(players).length > 0,
      });
      statCount++;
    }
  if (coverage.players)
    for (const teamId of [
      ...new Set(upcoming.flatMap((g) => [g.homeTeamId, g.awayTeamId])),
    ].slice(0, 32)) {
      const path = 'rosters/' + season + '_' + teamId,
        cached = await store.get(path);
      if (cached && now - cached.syncedAt < 7 * 86400000) continue;
      if (rosterCount + statCount >= 16) break;
      const players = normalizeRoster(
        await request('players', { team: teamId, season }),
        teamId,
        season,
      );
      if (players.length)
        await store.set(path, { teamId, season, players, syncedAt: now });
      rosterCount++;
    }
  return {
    games: games.length,
    rosters: rosterCount,
    boxScores: statCount,
    refreshedAt: now,
  };
}
