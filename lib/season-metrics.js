export function seasonMetrics(member, bets, ledger, snapshots) {
  const initial = member.startingBankroll ?? 1000;
  const record = { won: 0, lost: 0, push: 0, void: 0, pending: 0 };
  for (const bet of bets) if (bet.status in record) record[bet.status]++;
  // An allocation entry adjusts the $10 base. Start the chart at the
  // actual allocation, so a late entry is never displayed as a gambling loss.
  let balance = initial;
  const trend = [{ at: member.joinedAt, balance, label: 'Joined' }];
  for (const row of [...ledger, ...(member.weeklyDeposits ?? [])].sort(
    (a, b) => a.at - b.at || a.id.localeCompare(b.id),
  )) {
    if (row.kind === 'late entry allocation') continue;
    balance += row.delta;
    trend.push({ at: row.at, balance, label: row.kind });
  }
  const finishes = [...snapshots]
    .sort((a, b) => a.week - b.week)
    .flatMap((s) => {
      const row = s.rows?.find((r) => r.uid === member.id);
      return row
        ? [
            {
              week: s.week,
              balance: row.balance,
              rank: 1 + s.rows.filter((r) => r.balance > row.balance).length,
            },
          ]
        : [];
    });
  return {
    record,
    trend,
    finishes,
    net: member.balance - initial,
    pendingStake: bets
      .filter((b) => b.status === 'pending')
      .reduce((n, b) => n + b.stake, 0),
  };
}

export function pendingExplanation(bet, events, now) {
  if (bet.status !== 'pending') return '';
  if (bet.reviewReason)
    return 'Commissioner action required: ' + bet.reviewReason;
  if (now < bet.startsAt) return 'Game has not started.';
  if (!bet.autoEligible)
    return 'Commissioner action required: this custom market needs a verified result.';
  if (bet.market === 'Parlay') {
    if (bet.legs?.some((l) => l.market === 'Other' && !l.verifiedBy))
      return 'Commissioner action required: an Other leg needs verification.';
    return 'Waiting for remaining leg results and the next settlement run.';
  }
  const event = events.find((e) => e.id === bet.eventId);
  if (
    bet.pendingState === 'stats' ||
    (event?.completed && bet.market === 'Player prop')
  )
    return 'Waiting for player statistics or participation evidence. Missing data is never graded as zero.';
  if (event?.completed)
    return 'Final score received. Waiting for the next settlement run.';
  return 'Waiting for a final game result. Results are checked daily at 10 a.m. and Sundays at 1 p.m., 4 p.m. and 8 p.m. Eastern. Sunday games can settle the same day after final scores are verified; player props wait for published statistics.';
}

export function healthQueue(bets, now) {
  return bets
    .flatMap((b) => {
      const review = b.review?.status === 'open';
      const manual =
        b.status === 'pending' &&
        now >= b.startsAt &&
        (b.reviewReason ||
          !b.autoEligible ||
          b.legs?.some(
            (l) => l.market === 'Other' && !l.verifiedBy && now >= l.startsAt,
          ));
      const aged = b.status === 'pending' && now - b.startsAt >= 36 * 3600000;
      return review || manual || aged
        ? [
            {
              ...b,
              priority: review ? 0 : manual ? 1 : 2,
              attentionAt: review ? b.review.requestedAt : b.startsAt,
              attention: review
                ? 'Player review'
                : manual
                  ? 'Commissioner action'
                  : 'Pending over 36 hours',
            },
          ]
        : [];
    })
    .sort((a, b) => a.priority - b.priority || a.attentionAt - b.attentionAt);
}
