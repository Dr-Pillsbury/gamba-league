import { propsForPosition, gradeProp } from './football.js';
import { grade, weekAt, weekStart, weekEnd, withinBetWindow } from './rules.js';

export const PARLAY_MARKETS = [
  'Moneyline',
  'Spread',
  'Total',
  'Player prop',
  'Other',
];
export const MAX_LEGS = 20;

export function normalizeParlayLeg(input, event, players, now, config) {
  if (!input || !PARLAY_MARKETS.includes(input.market))
    throw Error('Choose a supported market for every leg.');
  if (input.market !== 'Other' && !event)
    throw Error('Select a scheduled game for every automatic leg.');
  if (event?.completed)
    throw Error('Every leg must be a game that has not finished.');
  const startsAt = event ? Date.parse(event.commence_time) : input.startsAt;
  if (
    !withinBetWindow(startsAt, now) ||
    startsAt < weekStart(config.startDate, weekAt(now, config.startDate)) ||
    startsAt >= weekEnd(config.startDate, weekAt(now, config.startDate))
  )
    throw Error(
      'Every parlay leg must start in the current betting week and be less than 3 hours past its start.',
    );
  const leg = {
    market: input.market,
    eventId: event ? input.eventId : null,
    startsAt,
    gradingRule: 'full-game',
    side: input.side ?? null,
    line: input.line ?? null,
    playerId: null,
    propKey: null,
    selection: '',
    status: 'pending',
  };
  if (input.market === 'Other') {
    if (
      typeof input.selection !== 'string' ||
      !input.selection.trim() ||
      input.selection.length > 400
    )
      throw Error('Describe each Other leg (1–400 characters).');
    leg.selection = input.selection.trim();
    leg.side = null;
    leg.line = null;
  } else if (input.market === 'Player prop') {
    if (event.provider !== 'nflverse')
      throw Error('Choose an imported NFL game for player props.');
    const player = players.find((p) => p.id === input.playerId);
    const prop =
      player &&
      propsForPosition(player.position).find((p) => p.key === input.propKey);
    if (!prop)
      throw Error('Choose a supported player and statistic for each prop leg.');
    leg.playerId = player.id;
    leg.propKey = prop.key;
    if (prop.key === 'anytime_td') {
      leg.side = 'over';
      leg.line = 0.5;
    }
    if (
      !['over', 'under'].includes(leg.side) ||
      !Number.isFinite(leg.line) ||
      leg.line < 0 ||
      leg.line > 10000 ||
      !Number.isInteger(leg.line * 2)
    )
      throw Error(
        'Enter a direction and nonnegative whole or half-point prop line.',
      );
    leg.selection =
      player.name +
      (prop.key === 'anytime_td'
        ? ' anytime touchdown'
        : ` ${leg.side} ${leg.line} ${prop.label.toLowerCase()}`);
  } else {
    if (
      !(
        input.market === 'Total' ? ['over', 'under'] : ['home', 'away']
      ).includes(leg.side)
    )
      throw Error('Choose a selection for every parlay leg.');
    if (input.market === 'Moneyline') leg.line = null;
    else if (
      !Number.isFinite(leg.line) ||
      Math.abs(leg.line) > 1000 ||
      !Number.isInteger(leg.line * 2)
    )
      throw Error(
        'Enter a whole or half-point line for every spread or total.',
      );
    leg.selection =
      (leg.side === 'home'
        ? event.home_team
        : leg.side === 'away'
          ? event.away_team
          : leg.side) +
      (input.market === 'Moneyline'
        ? ' moneyline'
        : ` ${input.market.toLowerCase()} ${leg.line}`);
  }
  if (event) leg.selection += ` · ${event.away_team} @ ${event.home_team}`;
  return leg;
}

export function validateParlayLegs(legs) {
  if (!Array.isArray(legs) || legs.length < 2 || legs.length > MAX_LEGS)
    throw Error(`Add between 2 and ${MAX_LEGS} parlay legs.`);
  const keys = legs.map((l) =>
    JSON.stringify([
      l.eventId,
      l.market,
      l.side,
      l.line,
      l.playerId,
      l.propKey,
      l.market === 'Other' ? l.selection.toLowerCase() : null,
    ]),
  );
  if (new Set(keys).size !== keys.length)
    throw Error('Remove duplicate selections from the parlay.');
}

export function gradeParlay(bet, events, stats) {
  if (!Array.isArray(bet.legs) || bet.legs.length < 2)
    return { result: null, legs: bet.legs ?? [] };
  const legs = bet.legs.map((leg) => {
    const event = events[leg.eventId];
    const result =
      leg.market === 'Other'
        ? leg.verifiedBy && ['won', 'lost', 'push', 'void'].includes(leg.status)
          ? leg.status
          : null
        : !event
          ? null
          : leg.market === 'Player prop'
            ? gradeProp({ ...leg, rules: bet.rules }, event, stats[leg.eventId])
            : grade(leg, event);
    return { ...leg, status: result ?? 'pending' };
  });
  const statuses = legs.map((l) => l.status);
  // A losing leg decides the parlay even if other legs are still pending.
  const result = statuses.includes('lost')
    ? 'lost'
    : statuses.includes('pending')
      ? null
      : statuses.every((s) => s === 'won')
        ? 'won'
        : null;
  const needsOddsReview =
    result !== 'lost' && statuses.some((s) => s === 'push' || s === 'void');
  return { result, legs, needsOddsReview };
}

export function parlaySettlementOdds(bet, adjustedOdds) {
  if (adjustedOdds === undefined || adjustedOdds === null) return bet.odds;
  if (
    bet.market !== 'Parlay' ||
    !Number.isInteger(adjustedOdds) ||
    Math.abs(adjustedOdds) < 100 ||
    Math.abs(adjustedOdds) > 100000
  )
    throw Error('Enter valid adjusted American odds for the parlay.');
  return adjustedOdds;
}
