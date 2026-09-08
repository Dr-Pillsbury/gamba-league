export const INITIAL = 18000,
  MINIMUM = 1000,
  WEEKS = 18;
export function easternDate(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}
export function weekAt(ms, start) {
  const candidate = (
    Math.floor(
      (Date.parse(easternDate(ms) + 'T00:00:00Z') -
        Date.parse(start + 'T00:00:00Z')) /
        604800000,
    ) + 1
  );
  return ms < weekStart(start, candidate) ? candidate - 1 : candidate;
}
export function weekStart(start, week) {
  const day = new Date(
    Date.parse(start + 'T00:00:00Z') + (week - 1) * 604800000,
  )
    .toISOString()
    .slice(0, 10);
  let ms = Date.parse(day + 'T05:00:00Z');
  if (
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(ms)) === '01'
  )
    ms -= 3600000;
  return ms + 10 * 3600000;
}
// Tuesday midnight is the exclusive end of Monday's betting window.
export function weekEnd(start, week) {
  return weekStart(start, week + 1) - 10 * 3600000;
}
export function bettingOpen(ms, start) {
  const week = weekAt(ms, start);
  return week >= 1 && week <= WEEKS && ms >= weekStart(start, week) && ms < weekEnd(start, week);
}
export function lateJoinBankroll(ms, start) {
  const week = Math.max(1, weekAt(ms, start));
  return Math.max(0, WEEKS - week + (ms < weekEnd(start, week) ? 1 : 0)) * MINIMUM;
}
export function payout(stake, odds, status) {
  if (status === 'push' || status === 'void') return stake;
  if (status === 'lost' || status === 'pending') return 0;
  if (status !== 'won') throw Error('Unknown result.');
  return stake + Math.round(stake * (odds > 0 ? odds / 100 : 100 / -odds));
}
export function funds(balance, opening, staked, week) {
  const reserve = Math.max(0, WEEKS - week) * MINIMUM;
  return {
    reserve,
    available: Math.max(0, balance - reserve),
    needed: Math.max(0, MINIMUM - staked),
  };
}
export function validateBet(data, now, config, balance, opening, staked) {
  const week = weekAt(now, config.startDate);
  if (week < 1 || week > 18)
    throw Error('Betting is outside the 18-week season.');
  if (!bettingOpen(now, config.startDate)) throw Error('Betting reopens Tuesday at 10 a.m. Eastern.');
  if (!Number.isSafeInteger(data.stake) || data.stake < 1)
    throw Error('Enter a positive stake with at most two decimal places.');
  if (
    !Number.isInteger(data.odds) ||
    Math.abs(data.odds) < 100 ||
    Math.abs(data.odds) > 100000
  )
    throw Error(
      'American odds must be −100 or lower, or +100 or higher (maximum ±100000).',
    );
  if (data.stake > funds(balance, opening, staked, week).available)
    throw Error(
      'This stake exceeds your weekly allowance or protected balance.',
    );
  if (
    !Number.isFinite(data.startsAt) ||
    data.startsAt <= now ||
    data.startsAt >= weekEnd(config.startDate, week)
  )
    throw Error('Choose a future event within this football week.');
  for (const key of ['selection'])
    if (
      typeof data[key] !== 'string' ||
      !data[key].trim() ||
      data[key].length > 400
    )
      throw Error(
        'Enter a pick (maximum 400 characters).',
      );
  if (
    ![
      'Moneyline',
      'Spread',
      'Total',
      'Player prop',
      'Parlay',
      'Other',
    ].includes(data.market)
  )
    throw Error('Choose a valid market.');
  return week;
}
export function grade(bet, event) {
  if (!event.completed || !Array.isArray(event.scores)) return null;
  if (
    event.scores.some(
      (s) => s.score === null || s.score === undefined || s.score === '',
    )
  )
    return null;
  const home = Number(
      event.scores.find((s) => s.name === event.home_team)?.score,
    ),
    away = Number(event.scores.find((s) => s.name === event.away_team)?.score);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  let margin;
  if (bet.market === 'Moneyline' && ['home', 'away'].includes(bet.side))
    margin = bet.side === 'home' ? home - away : away - home;
  else if (
    bet.market === 'Spread' &&
    Number.isFinite(bet.line) &&
    ['home', 'away'].includes(bet.side)
  )
    margin = (bet.side === 'home' ? home - away : away - home) + bet.line;
  else if (
    bet.market === 'Total' &&
    Number.isFinite(bet.line) &&
    ['over', 'under'].includes(bet.side)
  )
    margin =
      bet.side === 'over' ? home + away - bet.line : bet.line - home - away;
  else return null;
  return margin === 0 ? 'push' : margin > 0 ? 'won' : 'lost';
}
