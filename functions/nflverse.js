import { sameDaySunday, verifySundayFinal } from './sunday-finals.js';
import { numericStat } from './football.js';
import { easternDate } from './rules.js';

export const SOURCES = {
  games:
    'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv',
  rosters: (season) =>
    `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv`,
  stats: (season) =>
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`,
};

// RFC 4180 fields, including escaped quotes and embedded newlines.
export function parseCsv(text) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if (c === '\n' && !quoted) {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw Error('Incomplete nflverse CSV.');
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  const headers = rows.shift();
  if (!headers?.length || new Set(headers).size !== headers.length)
    throw Error('Invalid CSV headers.');
  return rows
    .filter((r) => r.some(Boolean))
    .map((r) => {
      if (r.length !== headers.length)
        throw Error('Incomplete nflverse CSV row.');
      return Object.fromEntries(headers.map((h, i) => [h, r[i]]));
    });
}

export function kickoff(day, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time))
    return null;
  const utc = Date.parse(`${day}T${time}:00Z`);
  // Determine New York's offset at noon; NFL kickoff times are outside DST transitions.
  const noon = Date.parse(`${day}T12:00:00Z`);
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(noon),
  );
  return utc + (12 - hour) * 3600000;
}

export function normalizeSchedule(rows, season, now = Date.now()) {
  return rows
    .filter((r) => Number(r.season) === season && r.game_type === 'REG')
    .map((r) => {
      const at = kickoff(r.gameday, r.gametime);
      if (
        !/^\d{4}_\d{2}_[A-Z]+_[A-Z]+$/.test(r.game_id) ||
        at === null ||
        !r.home_team ||
        !r.away_team
      )
        return null;
      const home = numericStat(r.home_score),
        away = numericStat(r.away_score);
      const completed =
        home !== null &&
        away !== null &&
        easternDate(now) > r.gameday &&
        now >= at + 8 * 3600000;
      return {
        id: 'nv_' + r.game_id,
        provider: 'nflverse',
        providerId: r.game_id,
        espnId: /^\d+$/.test(r.espn ?? '') ? r.espn : null,
        season,
        home_team: r.home_team,
        away_team: r.away_team,
        homeTeamId: r.home_team,
        awayTeamId: r.away_team,
        commence_time: new Date(at).toISOString(),
        venue: r.stadium || '',
        stage: 'Regular Season',
        footballWeek: Number(r.week),
        status: completed ? 'FT' : at > now ? 'NS' : 'Awaiting final data',
        completed,
        scores: [
          { name: r.home_team, score: home },
          { name: r.away_team, score: away },
        ],
        syncedAt: now,
      };
    })
    .filter(Boolean);
}

export function normalizeNflverseRosters(rows, season) {
  const teams = {};
  for (const r of rows) {
    if (
      Number(r.season) !== season ||
      !r.gsis_id ||
      !r.full_name ||
      !r.team ||
      r.status !== 'ACT'
    )
      continue;
    const players = (teams[r.team] ??= new Map());
    players.set(r.gsis_id, {
      id: r.gsis_id,
      name: r.full_name,
      position: r.position,
      number: numericStat(r.jersey_number),
      teamId: r.team,
      season,
    });
  }
  return Object.fromEntries(
    Object.entries(teams).map(([team, players]) => [
      team,
      [...players.values()],
    ]),
  );
}

const STAT_FIELDS = {
  passing_yards: 'passing_yards',
  passing_tds: 'passing_tds',
  passing_interceptions: 'passing_interceptions',
  rushing_yards: 'rushing_yards',
  rushing_tds: 'rushing_tds',
  receiving_yards: 'receiving_yards',
  receiving_tds: 'receiving_tds',
  receptions: 'receptions',
  solo_tackles: 'def_tackles_solo',
  sacks: 'def_sacks',
};
export function normalizeNflverseStats(rows, game) {
  const players = {};
  for (const r of rows) {
    if (
      r.game_id !== game.providerId ||
      Number(r.season) !== game.season ||
      r.season_type !== 'REG' ||
      !r.player_id ||
      ![game.homeTeamId, game.awayTeamId].includes(r.team)
    )
      continue;
    const values = {};
    for (const [key, field] of Object.entries(STAT_FIELDS)) {
      const n = numericStat(r[field]);
      if (n !== null) values[key] = n;
    }
    // Total tackles stays pending until the source's assisted-tackle semantics are verified.
    if (players[r.player_id])
      throw Error('Duplicate nflverse player/game statistic row.');
    const participated = [
      'attempts',
      'carries',
      'targets',
      'sacks_suffered',
      'def_tackles_solo',
      'def_tackles_with_assist',
      'def_tackle_assists',
      'def_sacks',
      'def_interceptions',
      'def_pass_defended',
      'kickoff_returns',
      'punt_returns',
    ].some((field) => (numericStat(r[field]) ?? 0) > 0);
    players[r.player_id] = {
      id: r.player_id,
      name: r.player_display_name,
      teamId: r.team,
      participated,
      values,
    };
  }
  return players;
}

export async function syncNflverse({
  store,
  season,
  now = Date.now(),
  pendingBets = [],
  fetchImpl = fetch,
}) {
  const read = async (url, optional = false) => {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(60000) });
    if (optional && r.status === 404) return [];
    if (!r.ok)
      throw Error(
        `nflverse data download failed (HTTP ${r.status}). Cached data is preserved.`,
      );
    return parseCsv(await r.text());
  };
  const games = normalizeSchedule(await read(SOURCES.games), season, now);
  if (!games.length)
    throw Error('nflverse has no usable schedule for this season.');
  for (let i = 0; i < games.length; i++) {
    let game = games[i];
    if (sameDaySunday(game, now)) {
      const previous = await store.get('events/' + game.id);
      // Retain an already verified final if a later refresh is unavailable.
      if (previous?.completed && previous.finalSource === 'espn' &&
          previous.espnId === game.espnId && previous.commence_time === game.commence_time &&
          previous.homeTeamId === game.homeTeamId && previous.awayTeamId === game.awayTeamId) {
        game = { ...game, scores: previous.scores, completed: true, status: 'FT',
          finalSource: 'espn', finalVerifiedAt: previous.finalVerifiedAt };
      }
      if (!game.completed) {
        try { game = await verifySundayFinal(game, now, fetchImpl); }
        catch (error) { game = { ...game, finalCheckError: error.message }; }
      }
    }
    games[i] = game;
    await store.set('events/' + game.id, game);
  }
  const cached = await store.get('sync/nflverse');
  let rosterCount = 0;
  if (
    cached?.season !== season ||
    !cached?.rostersAt ||
    now - cached.rostersAt >= 86400000
  ) {
    const teams = normalizeNflverseRosters(
      await read(SOURCES.rosters(season)),
      season,
    );
    if (!Object.keys(teams).length)
      throw Error('nflverse has no active rosters for this season.');
    for (const [teamId, players] of Object.entries(teams)) {
      await store.set(`rosters/${season}_${teamId}`, {
        teamId,
        season,
        players,
        syncedAt: now,
      });
      rosterCount++;
    }
    await store.set('sync/nflverse', { season, rostersAt: now });
  }
  const propBets = pendingBets
    .filter((b) => b.status === 'pending')
    .flatMap((b) => (b.market === 'Parlay' ? (b.legs ?? []) : [b]));
  const needed = games.filter(
    (g) =>
      g.completed &&
      propBets.some((b) => b.eventId === g.id && b.market === 'Player prop'),
  );
  if (needed.length) {
    const rows = await read(SOURCES.stats(season), true);
    for (const g of needed) {
      const players = normalizeNflverseStats(rows, g);
      await store.set('gameStats/' + g.id, {
        eventId: g.id,
        players,
        syncedAt: now,
        hasStats: Object.keys(players).length > 0,
      });
    }
  }
  return {
    games: games.length,
    rosters: rosterCount,
    boxScores: needed.length,
    refreshedAt: now,
  };
}
