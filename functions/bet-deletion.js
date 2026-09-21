export const BET_DELETION_GRACE_MS = 3 * 60 * 1000;

// Shared with the feed; the transaction always enforces this using server time.
export function canDeleteBet(bet, now) {
  if (bet.status !== 'pending' || !Number.isFinite(now) || now <= 0)
    return false;
  const starts = [bet.startsAt, ...(bet.legs || []).map((leg) => leg.startsAt)];
  const beforeStart = starts.every(
    (start) => Number.isFinite(start) && now < start,
  );
  const withinGrace =
    Number.isFinite(bet.createdAt) &&
    now >= bet.createdAt &&
    now - bet.createdAt < BET_DELETION_GRACE_MS;
  return beforeStart || withinGrace;
}
