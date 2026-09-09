import { db, projectId, googleUser, seasonStart } from './local-firebase.mjs';
import { weekStart, weekEnd, payout } from '../functions/rules.js';
if (!process.argv.includes('--reset'))
  throw Error(
    'Pass --reset to replace only the disposable demo-gamba-league emulator fixtures.',
  );
const response = await fetch(
  `http://127.0.0.1:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`,
  { method: 'DELETE' },
);
if (!response.ok) throw Error('Start the local Firestore emulator first.');
const now = Date.now();
const start = new Date(Date.parse(seasonStart() + 'T00:00:00Z') - 14 * 86400000)
  .toISOString()
  .slice(0, 10);
const commissioner = await googleUser('commissioner'),
  player = await googleUser('player'),
  rival = await googleUser('rival');
const batch = db.batch();
const put = (path, data) => batch.set(db.doc(path), data);
put('config/league', {
  startDate: start,
  commissionerUids: [commissioner.uid],
  backendEnabled: true,
  dataSyncEnabled: true,
  autoSettlementEnabled: true,
  dataProvider: 'nflverse',
  lastScoresSyncAt: now - 3600000,
  dataSyncStatus: 'ready',
  dataSyncError: '',
});
const begins = Math.min(now + 86400000, weekEnd(start, 3) - 3600000);
for (const [id, home, away] of [
  ['demo-game', 'BUF', 'KC'],
  ['demo-game-2', 'PHI', 'DAL'],
]) {
  put('events/' + id, {
    provider: 'nflverse',
    season: Number(start.slice(0, 4)),
    homeTeamId: home,
    awayTeamId: away,
    home_team: home,
    away_team: away,
    status: 'NS',
    completed: false,
    commence_time: new Date(begins).toISOString(),
    venue: 'Local demo stadium',
  });
  for (const team of [home, away])
    put(`rosters/${start.slice(0, 4)}_${team}`, {
      season: Number(start.slice(0, 4)),
      teamId: team,
      players: [
        {
          id:
            team === 'BUF'
              ? '00-0000001'
              : team === 'KC'
                ? '00-0000002'
                : team === 'PHI'
                  ? '00-0000003'
                  : '00-0000004',
          name: team + ' Demo Quarterback',
          position: 'QB',
          teamId: team,
        },
        {
          id:
            team === 'BUF'
              ? '00-0000011'
              : team === 'KC'
                ? '00-0000012'
                : team === 'PHI'
                  ? '00-0000013'
                  : '00-0000014',
          name: team + ' Demo Receiver',
          position: 'WR',
          teamId: team,
        },
      ],
    });
}
const snapshotRows = { 1: [], 2: [] };
for (const { person, username } of [
  { person: commissioner, username: 'Commissioner' },
  { person: player, username: 'Player' },
  { person: rival, username: 'Rival' },
]) {
  let balance = 18000;
  const weeklyStakes = {};
  for (let i = 0; i < 14; i++) {
    const week = i < 4 ? 1 : i < 8 ? 2 : 3;
    const status = [
      'won',
      'lost',
      'push',
      'void',
      'won',
      'lost',
      'won',
      'lost',
      'pending',
      'pending',
      'won',
      'lost',
      'pending',
      'won',
    ][i];
    const createdAt = weekStart(start, week) + (i + 1) * 10000;
    const at = createdAt + 5000,
      stake = 100,
      odds = 100;
    const id = `demo-${username}-${i}`,
      paid = payout(stake, odds, status);
    const startsAt =
      status === 'pending' && i === 8 ? begins : createdAt + 1000;
    const review =
      i === 13
        ? {
            status: 'open',
            reason: 'Demo review: please check the final statistic.',
            requestedAt: now - 2 * 3600000,
            settledAt: at,
          }
        : null;
    put('bets/' + id, {
      uid: person.uid,
      username,
      selection:
        i === 12
          ? 'Demo player yards awaiting stats'
          : `Demo pick ${i + 1} · ${username}`,
      market: i === 12 ? 'Player prop' : 'Moneyline',
      eventId: 'demo-game',
      stake,
      odds,
      paid,
      status,
      startsAt,
      createdAt,
      week,
      autoEligible: true,
      gradingRule: 'full-game',
      manualOverride: false,
      side: 'home',
      ...(i === 12 ? { pendingState: 'stats' } : {}),
      ...(status !== 'pending' ? { settledAt: at } : {}),
      ...(review ? { review } : {}),
    });
    put('ledger/' + id + '-stake', {
      uid: person.uid,
      betId: id,
      at: createdAt,
      delta: -stake,
      kind: 'stake',
      week,
      stakeDelta: stake,
    });
    balance -= stake;
    if (status !== 'pending') {
      put('ledger/' + id + '-result', {
        uid: person.uid,
        betId: id,
        at,
        delta: paid,
        kind: 'automatic result',
        week,
        stakeDelta: status === 'void' ? -stake : 0,
      });
      balance += paid;
    }
    if (status !== 'void')
      weeklyStakes[week] = (weeklyStakes[week] ?? 0) + stake;
    if (i === 3 || i === 7)
      snapshotRows[week].push({
        uid: person.uid,
        username,
        balance,
        staked: weeklyStakes[week],
        minimumMet: false,
      });
  }
  put('members/' + person.uid, {
    username,
    balance,
    joinedAt: weekStart(start, 1),
    weeklyStakesVersion: 1,
    weeklyStakes,
  });
  put('usernames/' + username.toLowerCase(), { uid: person.uid });
}
for (const week of [1, 2])
  put('snapshots/' + week, {
    week,
    cutoff: weekEnd(start, week),
    createdAt: weekEnd(start, week) + 1000,
    rows: snapshotRows[week],
  });
put('audit/demo', {
  at: now - 3600000,
  username: 'Player',
  selection: 'Demo correction history',
  from: 'lost',
  to: 'won',
  reason: 'Demo verified result',
  delta: 200,
});
await batch.commit();
console.log(
  'Local demo ready: 3 members, 42 picks, two games, player rosters, and weekly history. Use the emulator Google sign-in and choose commissioner@example.test or player@example.test.',
);
await db.terminate();
