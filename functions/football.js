// Shared, pure football normalization and grading. Missing data is never zero.
export const PROP_MARKETS = [
  {
    key: 'anytime_td',
    label: 'Anytime touchdown',
    group: 'scoring',
    fields: [],
    positions: ['QB', 'RB', 'FB', 'WR', 'TE'],
  },
  {
    key: 'passing_yards',
    label: 'Passing yards',
    group: 'passing',
    fields: ['yards'],
    positions: ['QB'],
  },
  {
    key: 'passing_tds',
    label: 'Passing touchdowns',
    group: 'passing',
    fields: ['passing touch downs', 'touchdowns', 'td'],
    positions: ['QB'],
  },
  {
    key: 'passing_interceptions',
    label: 'Interceptions thrown',
    group: 'passing',
    fields: ['interceptions', 'int'],
    positions: ['QB'],
  },
  {
    key: 'rushing_yards',
    label: 'Rushing yards',
    group: 'rushing',
    fields: ['yards'],
    positions: ['QB', 'RB', 'FB', 'WR'],
  },
  {
    key: 'rushing_tds',
    label: 'Rushing touchdowns',
    group: 'rushing',
    fields: ['rushing touch downs', 'touchdowns', 'td'],
    positions: ['QB', 'RB', 'FB', 'WR'],
  },
  {
    key: 'receiving_yards',
    label: 'Receiving yards',
    group: 'receiving',
    fields: ['yards'],
    positions: ['RB', 'FB', 'WR', 'TE'],
  },
  {
    key: 'receptions',
    label: 'Receptions',
    group: 'receiving',
    fields: ['total receptions', 'receptions', 'rec'],
    positions: ['RB', 'FB', 'WR', 'TE'],
  },
  {
    key: 'receiving_tds',
    label: 'Receiving touchdowns',
    group: 'receiving',
    fields: ['receiving touch downs', 'touchdowns', 'td'],
    positions: ['RB', 'FB', 'WR', 'TE'],
  },
  {
    key: 'solo_tackles',
    label: 'Solo tackles',
    group: 'defensive',
    fields: ['unassisted tackles', 'solo tackles', 'solo'],
    positions: [
      'LB',
      'ILB',
      'OLB',
      'MLB',
      'CB',
      'DB',
      'S',
      'SS',
      'FS',
      'DE',
      'DT',
      'DL',
      'NT',
      'EDGE',
    ],
  },
  {
    key: 'total_tackles',
    label: 'Total tackles (solo + assists)',
    group: 'defensive',
    fields: ['total tackles', 'total'],
    positions: [
      'LB',
      'ILB',
      'OLB',
      'MLB',
      'CB',
      'DB',
      'S',
      'SS',
      'FS',
      'DE',
      'DT',
      'DL',
      'NT',
      'EDGE',
    ],
  },
  {
    key: 'sacks',
    label: 'Sacks',
    group: 'defensive',
    fields: ['sacks'],
    positions: ['LB', 'ILB', 'OLB', 'MLB', 'DE', 'DT', 'DL', 'NT', 'EDGE'],
  },
];
export function propsForPosition(position) {
  return PROP_MARKETS.filter((p) =>
    p.positions.includes(String(position).toUpperCase()),
  );
}
export function numericStat(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value.trim()))
    return null;
  return Number(value);
}
export function normalizeGame(row, now = Date.now()) {
  const { game, teams, scores, league } = row ?? {};
  if (
    !Number.isInteger(game?.id) ||
    !Number.isFinite(game?.date?.timestamp) ||
    !teams?.home?.name ||
    !teams?.away?.name
  )
    return null;
  const status = game.status?.short;
  const home = numericStat(scores?.home?.total),
    away = numericStat(scores?.away?.total);
  return {
    id: 'nfl_' + game.id,
    provider: 'api-nfl',
    providerId: game.id,
    season: Number(league?.season),
    home_team: teams.home.name,
    away_team: teams.away.name,
    homeTeamId: teams.home.id,
    awayTeamId: teams.away.id,
    commence_time: new Date(game.date.timestamp * 1000).toISOString(),
    venue: game.venue?.name ?? '',
    stage: game.stage ?? '',
    footballWeek: game.week ?? '',
    status: status ?? 'unknown',
    completed: ['FT', 'AOT'].includes(status) && home !== null && away !== null,
    scores: [
      { name: teams.home.name, score: home },
      { name: teams.away.name, score: away },
    ],
    syncedAt: now,
  };
}
export function normalizeRoster(rows, teamId, season) {
  return rows
    .filter((p) => Number.isInteger(p.id) && typeof p.name === 'string')
    .map((p) => ({
      id: String(p.id),
      name: p.name,
      position: p.position ?? '',
      number: p.number ?? null,
      rosterGroup: p.group ?? '',
      teamId,
      season,
    }));
}
const normalized = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
// API-NFL groups individual game statistics by team, then named statistic group.
// Keep unknown labels out of the grading map until their meaning is verified.
export function normalizePlayerStats(rows) {
  const players = {};
  for (const team of rows) {
    for (const group of team.groups ?? []) {
      const category = normalized(group.name);
      for (const entry of group.players ?? []) {
        const id = entry.player?.id;
        if (!Number.isInteger(id)) continue;
        const player = (players[id] ??= {
          id: String(id),
          name: entry.player.name ?? '',
          teamId: team.team?.id ?? null,
          values: {},
        });
        for (const market of PROP_MARKETS.filter((p) => p.group === category)) {
          const matches = (entry.statistics ?? []).filter((s) =>
            market.fields.includes(normalized(s.name)),
          );
          if (matches.length !== 1) continue;
          const value = numericStat(matches[0].value);
          if (value !== null) player.values[market.key] = value;
        }
      }
    }
  }
  return players;
}
export function gradeProp(bet, event, stats) {
  if (
    !event.completed ||
    bet.gradingRule !== 'full-game' ||
    bet.market !== 'Player prop' ||
    !PROP_MARKETS.some((p) => p.key === bet.propKey)
  )
    return null;
  if (!Number.isFinite(bet.line) || !['over', 'under'].includes(bet.side))
    return null;
  const value = stats?.players?.[bet.playerId]?.values?.[bet.propKey];
  if (bet.rules?.provider === 'FanDuel' && !stats?.players?.[bet.playerId]?.participated) return null;
  if (bet.propKey === 'anytime_td') {
    if (bet.side !== 'over' || bet.line !== 0.5) return null;
    const values = stats?.players?.[bet.playerId]?.values;
    const touchdowns = [values?.rushing_tds, values?.receiving_tds];
    if (touchdowns.some((n) => Number.isFinite(n) && n >= 1)) return 'won';
    return touchdowns.every((n) => n === 0) ? 'lost' : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const margin = bet.side === 'over' ? value - bet.line : bet.line - value;
  return margin === 0 ? 'push' : margin > 0 ? 'won' : 'lost';
}
