import { readWeeklyStakes, weeklyStakePatch } from './weekly-summary.js';
import { canDeleteBet } from './bet-deletion.js';
export async function deletePendingBet(db, actor, betId) {
  if (typeof betId !== 'string' || !betId || betId.includes('/'))
    throw Error('Invalid bet.');
  return db.runTransaction(async (tx) => {
    const ref = db.doc('bets/' + betId),
      removedRef = db.doc('deletedBets/' + betId);
    const [snapshot, removed] = await Promise.all([
      tx.get(ref),
      tx.get(removedRef),
    ]);
    if (removed.exists) {
      if (removed.data().uid !== actor)
        throw Error('You can only delete your own bets.');
      return;
    }
    if (!snapshot.exists) throw Error('Bet not found.');
    const bet = snapshot.data();
    if (bet.uid !== actor) throw Error('You can only delete your own bets.');
    if (bet.status !== 'pending')
      throw Error('Only pending bets can be deleted.');
    const member = await tx.get(db.doc('members/' + actor));
    if (!member.exists) throw Error('Player not found.');
    const weeklyStakes = await readWeeklyStakes(db, tx, member);
    const at = Date.now();
    if (!canDeleteBet(bet, at))
      throw Error(
        'This bet is locked. After a game starts, bets can only be deleted within 3 minutes of placement.',
      );
    tx.update(member.ref, {
      balance: member.data().balance + bet.stake,
      ...weeklyStakePatch(weeklyStakes, bet.week, -bet.stake),
    });
    tx.create(removedRef, { ...bet, deletedAt: at, deletedBy: actor });
    tx.delete(ref);
    tx.create(db.collection('ledger').doc(), {
      uid: actor,
      betId,
      delta: bet.stake,
      at,
      kind: 'bet deletion',
      week: bet.week,
      stakeDelta: -bet.stake,
    });
    tx.create(db.collection('audit').doc(), {
      betId,
      username: bet.username,
      selection: bet.selection,
      from: 'pending',
      to: 'deleted',
      actor,
      reason: 'Player deleted pending bet',
      delta: bet.stake,
      at,
    });
  });
}
