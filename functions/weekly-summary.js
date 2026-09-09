// Read before any transaction writes. Existing accounts are upgraded on their
// first mutation; subsequent placements need only the member document.
export async function readWeeklyStakes(db, tx, member) {
  const data = member.data();
  if (data.weeklyStakesVersion === 1) return { ...data.weeklyStakes };
  const bets = await tx.get(
    db
      .collection('bets')
      .where('uid', '==', member.id ?? member.ref.path.split('/').at(-1)),
  );
  return bets.docs.reduce((totals, doc) => {
    const bet = doc.data();
    if (bet.status !== 'void')
      totals[bet.week] = (totals[bet.week] ?? 0) + bet.stake;
    return totals;
  }, {});
}

export function weeklyStakePatch(totals, week, delta) {
  const value = (totals[week] ?? 0) + delta;
  if (!Number.isSafeInteger(value) || value < 0)
    throw Error('Weekly stake summary requires reconciliation.');
  return { weeklyStakesVersion: 1, weeklyStakes: { ...totals, [week]: value } };
}
