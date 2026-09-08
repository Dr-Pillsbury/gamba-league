import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { propsForPosition, gradeProp } from './football.js';
import { runNflImport } from './nfl-sync.js';
import {
  INITIAL,
  weekAt,
  weekStart,
  validateBet,
  payout,
  grade,
} from './rules.js';
initializeApp();
const db = getFirestore();
const configRef = db.doc('config/league');
function uid(req) {
  if (!req.auth || req.auth.token.firebase?.sign_in_provider !== 'google.com')
    throw new HttpsError('unauthenticated', 'Sign in with Google.');
  return req.auth.uid;
}
async function config() {
  const s = await configRef.get();
  if (!s.exists)
    throw new HttpsError(
      'failed-precondition',
      'The commissioner has not configured the league yet.',
    );
  const c = s.data();
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(c.startDate) ||
    new Date(c.startDate + 'T00:00:00Z').getUTCDay() !== 3
  )
    throw new HttpsError(
      'failed-precondition',
      'Season start must be a Wednesday.',
    );
  return c;
}
function admin(id, c) {
  if (!c.commissionerUids?.includes(id))
    throw new HttpsError('permission-denied', 'Commissioner access required.');
}
function clean(fn) {
  return onCall({ region: 'us-central1', maxInstances: 10 }, async (req) => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error(e);
      throw new HttpsError(
        'invalid-argument',
        e.message || 'Unable to complete the request.',
      );
    }
  });
}
export const joinLeague = clean(async (req) => {
  const id = uid(req),
    c = await config(),
    name = String(req.data?.username ?? '').trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(name))
    throw Error('Use 3–20 letters, numbers, or underscores.');
  if (weekAt(Date.now(), c.startDate) > 1)
    throw Error(
      'League entry closed after Week 1. Ask your commissioner about next season.',
    );
  await db.runTransaction(async (tx) => {
    const member = db.doc('members/' + id),
      handle = db.doc('usernames/' + name.toLowerCase());
    const [m, h] = await Promise.all([tx.get(member), tx.get(handle)]);
    if (m.exists) return;
    if (h.exists) throw Error('That username is taken.');
    tx.create(handle, { uid: id });
    tx.create(member, {
      username: name,
      balance: INITIAL,
      joinedAt: Date.now(),
    });
  });
  return { ok: true };
});
export const placeBet = clean(async (req) => {
  const id = uid(req),
    c = await config();
  const input = req.data ?? {};
  if (
    typeof input.requestId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(input.requestId)
  )
    throw Error('Missing request identifier.');
  const ref = db.doc('bets/' + id + '_' + input.requestId);
  await db.runTransaction(async (tx) => {
    const now = Date.now();
    const [existing, m, ls, bs] = await Promise.all([
      tx.get(ref),
      tx.get(db.doc('members/' + id)),
      tx.get(db.collection('ledger').where('uid', '==', id)),
      tx.get(db.collection('bets').where('uid', '==', id)),
    ]);
    if (existing.exists) return;
    if (!m.exists) throw Error('Join the league first.');
    const week = weekAt(now, c.startDate),
      start = weekStart(c.startDate, week);
    const opening =
      INITIAL +
      ls.docs.reduce(
        (n, d) => n + (d.data().at < start ? d.data().delta : 0),
        0,
      );
    const staked = bs.docs.reduce(
      (n, d) =>
        n +
        (d.data().week === week && d.data().status !== 'void'
          ? d.data().stake
          : 0),
      0,
    );
    let event = null;
    if (input.eventId) {
      if (
        typeof input.eventId !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(input.eventId)
      )
        throw Error('Invalid game identifier.');
      const ev = await tx.get(db.doc('events/' + String(input.eventId)));
      if (!ev.exists) throw Error('Game is no longer available.');
      event = ev.data();
      if (event.completed) throw Error('That game has finished.');
    }
    const bet = {
      selection: String(input.selection ?? '').trim(),
      sportsbook: String(input.sportsbook ?? '').trim(),
      market: input.market,
      odds: input.odds,
      stake: input.stake,
      startsAt: event ? Date.parse(event.commence_time) : input.startsAt,
      eventId: event ? input.eventId : null,
      side: input.side ?? null,
      line: input.line ?? null,
      gradingRule: input.gradingRule ?? 'full-game',
      gradingNotes: String(input.gradingNotes ?? '').trim(),
      playerId: null,
      propKey: null,
    };
    if (
      !['full-game', 'custom'].includes(bet.gradingRule) ||
      bet.gradingNotes.length > 500
    )
      throw Error('Choose a grading rule and limit notes to 500 characters.');
    if (bet.gradingRule === 'custom' && bet.gradingNotes.length < 3)
      throw Error(
        'Describe the sportsbook rule that needs commissioner review.',
      );
    if (event?.provider === 'api-nfl' && event.status !== 'NS')
      throw Error('Only scheduled, not-started games can accept bets.');
    if (event?.provider === 'api-nfl' && bet.market === 'Player prop') {
      if (
        !/^\d+$/.test(String(input.playerId)) ||
        !['over', 'under'].includes(bet.side)
      )
        throw Error('Choose a player and over/under.');
      if (
        !Number.isFinite(bet.line) ||
        bet.line < 0 ||
        bet.line > 10000 ||
        !Number.isInteger(bet.line * 2)
      )
        throw Error('Enter a nonnegative whole or half-point prop line.');
      const rosters = await Promise.all(
        [event.homeTeamId, event.awayTeamId].map((id) =>
          tx.get(db.doc('rosters/' + event.season + '_' + id)),
        ),
      );
      const player = rosters
        .flatMap((r) => r.data()?.players ?? [])
        .find((p) => p.id === String(input.playerId));
      const prop =
        player &&
        propsForPosition(player.position).find((p) => p.key === input.propKey);
      if (!player || !prop)
        throw Error(
          'Choose a supported player and position-specific prop from this game.',
        );
      bet.playerId = String(input.playerId);
      bet.propKey = prop.key;
      bet.selection =
        player.name +
        ' ' +
        bet.side +
        ' ' +
        bet.line +
        ' ' +
        prop.label.toLowerCase();
    }
    if (event && ['Moneyline', 'Spread', 'Total'].includes(bet.market)) {
      const sides =
        bet.market === 'Total' ? ['over', 'under'] : ['home', 'away'];
      if (!sides.includes(bet.side))
        throw Error('Choose a side for automatic settlement.');
      if (
        bet.market !== 'Moneyline' &&
        (!Number.isFinite(bet.line) ||
          Math.abs(bet.line) > 1000 ||
          !Number.isInteger(bet.line * 2))
      )
        throw Error('Enter a whole or half-point line.');
      const selected =
        bet.side === 'home'
          ? event.home_team
          : bet.side === 'away'
            ? event.away_team
            : bet.side;
      bet.selection =
        selected +
        (bet.market === 'Moneyline' ? ' moneyline' : ' ' + bet.line) +
        ' · ' +
        event.away_team +
        ' @ ' +
        event.home_team;
    }
    validateBet(bet, now, c, m.data().balance, opening, staked);
    tx.create(ref, {
      ...bet,
      uid: id,
      username: m.data().username,
      week,
      status: 'pending',
      paid: 0,
      createdAt: now,
      autoEligible:
        !!event &&
        bet.gradingRule === 'full-game' &&
        (['Moneyline', 'Spread', 'Total'].includes(bet.market) ||
          !!bet.propKey),
      manualOverride: false,
    });
    tx.update(m.ref, { balance: m.data().balance - bet.stake });
    tx.create(db.collection('ledger').doc(), {
      uid: id,
      betId: ref.id,
      delta: -bet.stake,
      at: now,
      kind: 'stake',
      week,
      stakeDelta: bet.stake,
    });
  });
  return { ok: true };
});
async function settle(betId, result, actor, reason, automatic = false) {
  if (!['won', 'lost', 'push', 'void'].includes(result))
    throw Error('Choose win, loss, push, or void.');
  await db.runTransaction(async (tx) => {
    const ref = db.doc('bets/' + betId),
      b = await tx.get(ref);
    if (!b.exists) throw Error('Bet not found.');
    const bet = b.data();
    if (automatic && (bet.status !== 'pending' || bet.manualOverride)) return;
    if (Date.now() < bet.startsAt && result !== 'void')
      throw Error('Wait until the event has started.');
    const m = await tx.get(db.doc('members/' + bet.uid));
    if (!m.exists) throw Error('Player not found.');
    if (bet.status === result) return;
    const paid = payout(bet.stake, bet.odds, result),
      delta = paid - bet.paid,
      at = Date.now();
    tx.update(m.ref, { balance: m.data().balance + delta });
    tx.update(ref, {
      status: result,
      paid,
      settledAt: at,
      manualOverride: !automatic,
      settledBy: actor,
      settlementReason: reason,
    });
    tx.create(db.collection('ledger').doc(), {
      uid: bet.uid,
      betId,
      delta,
      at,
      kind: automatic ? 'automatic result' : 'commissioner result',
      week: bet.week,
      stakeDelta:
        (result === 'void' ? -bet.stake : 0) +
        (bet.status === 'void' ? bet.stake : 0),
    });
    tx.create(db.collection('audit').doc(), {
      betId,
      username: bet.username,
      selection: bet.selection,
      from: bet.status,
      to: result,
      actor,
      reason,
      delta,
      at,
    });
  });
}
export const settleBet = clean(async (req) => {
  const id = uid(req),
    c = await config();
  admin(id, c);
  const { betId, result, reason } = req.data ?? {};
  if (
    typeof reason !== 'string' ||
    reason.trim().length < 3 ||
    reason.length > 500
  )
    throw Error(
      'Include a result source or correction reason (3–500 characters).',
    );
  if (typeof betId !== 'string' || betId.includes('/'))
    throw Error('Invalid bet.');
  await settle(betId, result, id, reason.trim());
  return { ok: true };
});
async function closeWeeks() {
  const c = await config(),
    now = Date.now(),
    current = weekAt(now, c.startDate);
  for (let week = 1; week < Math.min(current, 19); week++) {
    const ref = db.doc('snapshots/' + week);
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) return;
      const [ms, ls, bs] = await Promise.all([
        tx.get(db.collection('members')),
        tx.get(db.collection('ledger')),
        tx.get(db.collection('bets')),
      ]);
      const cutoff = weekStart(c.startDate, week + 1);
      const rows = ms.docs
        .filter((m) => m.data().joinedAt < cutoff)
        .map((m) => {
          const balance =
            INITIAL +
            ls.docs.reduce(
              (n, d) =>
                n +
                (d.data().uid === m.id && d.data().at < cutoff
                  ? d.data().delta
                  : 0),
              0,
            );
          const staked = ls.docs.reduce((n, d) => {
            const v = d.data();
            return (
              n +
              (v.uid === m.id && v.week === week && v.at < cutoff
                ? (v.stakeDelta ?? 0)
                : 0)
            );
          }, 0);
          return {
            uid: m.id,
            username: m.data().username,
            balance,
            staked,
            minimumMet: staked >= 1000,
          };
        })
        .sort((a, b) => b.balance - a.balance);
      tx.create(ref, { week, cutoff, createdAt: now, rows });
    });
  }
}
export const closeLeagueWeeks = onSchedule(
  {
    schedule: '5 0 * * 3',
    timeZone: 'America/New_York',
    region: 'us-central1',
  },
  closeWeeks,
);
export const refreshStandings = clean(async (req) => {
  const id = uid(req);
  admin(id, await config());
  await closeWeeks();
  return { ok: true };
});
const scoresKey = defineSecret('API_SPORTS_KEY');
export const syncFootballScores = onSchedule(
  {
    schedule: 'every 6 hours',
    timeZone: 'America/New_York',
    region: 'us-central1',
    secrets: [scoresKey],
    retryCount: 0,
    timeoutSeconds: 540,
    maxInstances: 1,
  },
  async () => {
    const c = await config();
    if (!c.dataSyncEnabled) return;
    const store = {
      get: async (path) => (await db.doc(path).get()).data() ?? null,
      set: async (path, value) => {
        await db.doc(path).set(value);
      },
      update: (path, fn) =>
        db.runTransaction(async (tx) => {
          const ref = db.doc(path),
            current = await tx.get(ref);
          tx.set(ref, fn(current.data() ?? null));
        }),
    };
    const pending = await db
      .collection('bets')
      .where('status', '==', 'pending')
      .get();
    await runNflImport({
      store,
      key: scoresKey.value(),
      season: Number(c.startDate.slice(0, 4)),
      pendingBets: pending.docs.map((d) => d.data()),
    });
    if (!c.autoSettlementEnabled) return;
    for (const doc of pending.docs) {
      const b = doc.data();
      if (
        !b.autoEligible ||
        b.manualOverride ||
        !b.eventId ||
        b.gradingRule !== 'full-game'
      )
        continue;
      const event = await store.get('events/' + b.eventId);
      if (!event?.completed) continue;
      const stats =
        b.market === 'Player prop'
          ? await store.get('gameStats/' + b.eventId)
          : null;
      const result =
        b.market === 'Player prop'
          ? gradeProp(b, event, stats)
          : grade(b, event);
      if (result)
        await settle(
          doc.id,
          result,
          'api-nfl',
          'API-NFL final ' +
            (b.market === 'Player prop' ? 'player statistic' : 'score') +
            ' · full game including overtime',
          true,
        );
      else
        await doc.ref.update({
          reviewReason:
            'Final game, but the required statistic is not available. Commissioner review needed.',
        });
    }
  },
);
