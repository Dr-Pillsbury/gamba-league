import { readWeeklyStakes, weeklyStakePatch } from './weekly-summary.js';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { propsForPosition, gradeProp } from './football.js';
import { runNflImport } from './nfl-sync.js';
import { createReview, LEAGUE_RULES } from './reviews.js';
import { deletePendingBet } from './delete-bet.js';
import {
  normalizeParlayLeg,
  validateParlayLegs,
  gradeParlay,
  MAX_LEGS,
  parlaySettlementOdds,
} from './parlay.js';
import {
  INITIAL,
  weekAt,
  weekEnd,
  lateJoinBankroll,
  minimumShortfall,
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
    new Date(c.startDate + 'T00:00:00Z').getUTCDay() !== 2
  )
    throw new HttpsError(
      'failed-precondition',
      'Season start must be a Tuesday.',
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
  const at = Date.now(),
    late = at >= weekEnd(c.startDate, 1);
  if (!lateJoinBankroll(at, c.startDate)) throw Error('This season has ended.');
  await db.runTransaction(async (tx) => {
    const member = db.doc('members/' + id),
      handle = db.doc('usernames/' + name.toLowerCase());
    const [m, h] = await Promise.all([tx.get(member), tx.get(handle)]);
    if (m.exists) return;
    if (h.exists) throw Error('That username is taken.');
    if (late) {
      const request = db.doc('joinRequests/' + id),
        previous = await tx.get(request);
      if (previous.data()?.status === 'pending') return;
      tx.set(request, {
        uid: id,
        username: name,
        status: 'pending',
        requestedAt: at,
      });
      return;
    }
    tx.create(handle, { uid: id });
    tx.create(member, {
      username: name,
      balance: INITIAL,
      weeklyStakesVersion: 1,
      weeklyStakes: {},
      joinedAt: Date.now(),
    });
  });
  return { ok: true };
});
export const reviewJoinRequest = clean(async (req) => {
  const actor = uid(req),
    c = await config();
  admin(actor, c);
  const { requestId, approve, bankroll } = req.data ?? {};
  if (
    typeof requestId !== 'string' ||
    !requestId ||
    requestId.includes('/') ||
    typeof approve !== 'boolean'
  )
    throw Error('Invalid entry request.');
  const at = Date.now(),
    allocation = bankroll ?? lateJoinBankroll(at, c.startDate);
  if (
    approve &&
    (!Number.isSafeInteger(allocation) ||
      allocation < 0 ||
      allocation > 100000000)
  )
    throw Error('Enter a bankroll from $0 to $1,000,000 in whole cents.');
  await db.runTransaction(async (tx) => {
    const ref = db.doc('joinRequests/' + requestId),
      r = await tx.get(ref);
    if (!r.exists || r.data().status !== 'pending')
      throw Error('Request is no longer pending.');
    const data = r.data(),
      member = db.doc('members/' + requestId),
      handle = db.doc('usernames/' + data.username.toLowerCase());
    const [m, h] = await Promise.all([tx.get(member), tx.get(handle)]);
    if (approve) {
      if (!lateJoinBankroll(at, c.startDate))
        throw Error('This season has ended.');
      if (m.exists || h.exists)
        throw Error(
          'Player already joined or username is taken. Ask the player to request a different name.',
        );
      tx.create(handle, { uid: requestId });
      tx.create(member, {
        username: data.username,
        balance: allocation,
        weeklyStakesVersion: 1,
        weeklyStakes: {},
        joinedAt: at,
        startingBankroll: allocation,
        approvedBy: actor,
      });
      tx.create(db.collection('ledger').doc(), {
        uid: requestId,
        delta: allocation - INITIAL,
        at,
        kind: 'late entry allocation',
        week: Math.max(1, weekAt(at, c.startDate)),
        stakeDelta: 0,
      });
    }
    tx.update(ref, {
      status: approve ? 'approved' : 'declined',
      resolvedAt: at,
      resolvedBy: actor,
      ...(approve ? { bankroll: allocation } : {}),
    });
    tx.create(db.collection('audit').doc(), {
      username: data.username,
      selection: 'Late league entry',
      from: 'pending',
      to: approve ? 'approved' : 'declined',
      actor,
      reason: approve
        ? 'Commissioner allotted starting bankroll'
        : 'Commissioner declined entry',
      delta: approve ? allocation : 0,
      at,
    });
  });
  return { ok: true };
});
export const placeBet = clean(async (req) => {
  const id = uid(req),
    c = await config();
  if (c.backendEnabled !== true)
    throw new HttpsError(
      'failed-precondition',
      'Betting is paused by the commissioner.',
    );
  const input = req.data ?? {};
  if (
    typeof input.requestId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(input.requestId)
  )
    throw Error('Missing request identifier.');
  const ref = db.doc('bets/' + id + '_' + input.requestId);
  await db.runTransaction(async (tx) => {
    const now = Date.now();
    const [existing, m, removed] = await Promise.all([
      tx.get(ref),
      tx.get(db.doc('members/' + id)),
      tx.get(db.doc('deletedBets/' + ref.id)),
    ]);
    if (existing.exists || removed.exists) return;
    if (!m.exists) throw Error('Join the league first.');
    const week = weekAt(now, c.startDate);
    const weeklyStakes = await readWeeklyStakes(db, tx, m);
    const staked = weeklyStakes[week] ?? 0;
    let event = null;
    if (input.eventId && input.market !== 'Parlay') {
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
      rules: LEAGUE_RULES,
      market: input.market,
      odds: input.odds,
      stake: input.stake,
      startsAt: event ? Date.parse(event.commence_time) : input.startsAt,
      eventId: event ? input.eventId : null,
      side: input.side ?? null,
      line: input.line ?? null,
      gradingRule: 'full-game',
      playerId: null,
      propKey: null,
    };
    if (event?.provider === 'nflverse' && event.status !== 'NS')
      throw Error('Only scheduled, not-started games can accept bets.');
    if (event?.provider === 'nflverse' && bet.market === 'Player prop') {
      if (
        !/^00-\d{7}$/.test(String(input.playerId)) ||
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
      if (prop.key === 'anytime_td') {
        bet.side = 'over';
        bet.line = 0.5;
      }
      bet.selection =
        player.name +
        ' ' +
        bet.side +
        ' ' +
        bet.line +
        ' ' +
        prop.label.toLowerCase();
      if (prop.key === 'anytime_td')
        bet.selection = player.name + ' anytime touchdown';
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
    if (bet.market === 'Parlay') {
      if (
        !Array.isArray(input.legs) ||
        input.legs.length < 2 ||
        input.legs.length > MAX_LEGS
      )
        throw Error(`Add between 2 and ${MAX_LEGS} parlay legs.`);
      bet.legs = [];
      for (const raw of input.legs) {
        if (
          !raw ||
          (raw.eventId &&
            (typeof raw.eventId !== 'string' ||
              !/^[a-zA-Z0-9_-]{1,100}$/.test(raw.eventId)))
        )
          throw Error('Invalid parlay game identifier.');
        const gameDoc = raw.eventId
          ? await tx.get(db.doc('events/' + raw.eventId))
          : null;
        if (raw.eventId && !gameDoc?.exists)
          throw Error('A parlay game is no longer available.');
        const game = gameDoc?.data();
        const rosters =
          game && raw.market === 'Player prop'
            ? await Promise.all(
                [game.homeTeamId, game.awayTeamId].map((team) =>
                  tx.get(db.doc(`rosters/${game.season}_${team}`)),
                ),
              )
            : [];
        bet.legs.push(
          normalizeParlayLeg(
            raw,
            game,
            rosters.flatMap((r) => r.data()?.players ?? []),
            now,
            c,
          ),
        );
      }
      validateParlayLegs(bet.legs);
      bet.startsAt = Math.min(...bet.legs.map((l) => l.startsAt));
      bet.eventId = null;
      bet.side = null;
      bet.line = null;
      bet.selection = `${bet.legs.length}-leg parlay`;
    }
    validateBet(bet, now, c, m.data().balance, 0, staked);
    tx.create(ref, {
      ...bet,
      uid: id,
      username: m.data().username,
      week,
      status: 'pending',
      paid: 0,
      createdAt: now,
      autoEligible:
        bet.market === 'Parlay' ||
        (!!event &&
          bet.gradingRule === 'full-game' &&
          (['Moneyline', 'Spread', 'Total'].includes(bet.market) ||
            !!bet.propKey)),
      manualOverride: false,
    });
    tx.update(m.ref, {
      balance: m.data().balance - bet.stake,
      ...weeklyStakePatch(weeklyStakes, week, bet.stake),
    });
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
export const deleteBet = clean(async (req) => {
  await deletePendingBet(db, uid(req), req.data?.betId);
  return { ok: true };
});
async function settle(
  betId,
  result,
  actor,
  reason,
  automatic = false,
  adjustedOdds = null,
) {
  if (
    !(automatic && result === null) &&
    !['won', 'lost', 'push', 'void'].includes(result)
  )
    throw Error('Choose win, loss, push, or void.');
  await db.runTransaction(async (tx) => {
    const ref = db.doc('bets/' + betId),
      b = await tx.get(ref);
    if (!b.exists) {
      if (automatic) return;
      throw Error('Bet not found.');
    }
    const bet = b.data();
    if (automatic && (bet.status !== 'pending' || bet.manualOverride)) return;
    let gradedLegs;
    if (automatic && bet.market === 'Parlay') {
      const eventIds = [
        ...new Set(bet.legs.map((l) => l.eventId).filter(Boolean)),
      ];
      const eventDocs = await Promise.all(
        eventIds.map((eventId) => tx.get(db.doc('events/' + eventId))),
      );
      const statDocs = await Promise.all(
        eventIds.map((eventId) => tx.get(db.doc('gameStats/' + eventId))),
      );
      const grading = gradeParlay(
        bet,
        Object.fromEntries(eventDocs.map((d) => [d.id, d.data()])),
        Object.fromEntries(statDocs.map((d) => [d.id, d.data()])),
      );
      result = grading.result;
      gradedLegs = grading.legs;
      if (!result) {
        tx.update(ref, {
          legs: gradedLegs,
          reviewReason: grading.needsOddsReview
            ? 'A parlay leg pushed or was void. Commissioner must verify revised odds and payout.'
            : '',
        });
        return;
      }
    }
    if (Date.now() < bet.startsAt && result !== 'void')
      throw Error('Wait until the event has started.');
    const m = await tx.get(db.doc('members/' + bet.uid));
    if (!m.exists) throw Error('Player not found.');
    const weeklyStakes = await readWeeklyStakes(db, tx, m);
    const settlementOdds = parlaySettlementOdds(bet, adjustedOdds);
    if (
      bet.status === result &&
      settlementOdds === bet.odds &&
      (automatic || bet.review?.status !== 'open')
    )
      return;
    const paid = payout(bet.stake, settlementOdds, result),
      delta = paid - bet.paid,
      at = Date.now();
    tx.update(m.ref, {
      balance: m.data().balance + delta,
      ...weeklyStakePatch(
        weeklyStakes,
        bet.week,
        (result === 'void' ? -bet.stake : 0) +
          (bet.status === 'void' ? bet.stake : 0),
      ),
    });
    tx.update(ref, {
      status: result,
      paid,
      settledAt: at,
      manualOverride: !automatic,
      settledBy: actor,
      settlementReason: reason,
      odds: settlementOdds,
      ...(settlementOdds !== bet.odds
        ? { originalOdds: bet.originalOdds ?? bet.odds }
        : {}),
      reviewReason: '',
      ...(gradedLegs ? { legs: gradedLegs } : {}),
      ...(!automatic && bet.review?.status === 'open'
        ? {
            review: {
              ...bet.review,
              status: 'resolved',
              resolution: reason,
              resolvedBy: actor,
              resolvedAt: at,
              settledAt: at,
            },
          }
        : {}),
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
      previousOdds: bet.odds,
      odds: settlementOdds,
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
  const { betId, result, reason, adjustedOdds } = req.data ?? {};
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
  await settle(betId, result, id, reason.trim(), false, adjustedOdds);
  return { ok: true };
});
export const verifyParlayLeg = clean(async (req) => {
  const actor = uid(req);
  admin(actor, await config());
  const { betId, legIndex, result, reason } = req.data ?? {};
  if (
    typeof betId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,160}$/.test(betId) ||
    !Number.isInteger(legIndex) ||
    !['won', 'lost', 'push', 'void'].includes(result) ||
    typeof reason !== 'string' ||
    reason.trim().length < 3 ||
    reason.length > 500
  )
    throw Error('Choose a leg result and provide a verification reason.');
  await db.runTransaction(async (tx) => {
    const ref = db.doc('bets/' + betId),
      snapshot = await tx.get(ref);
    const bet = snapshot.data(),
      leg = bet?.legs?.[legIndex];
    if (
      bet?.market !== 'Parlay' ||
      bet.status !== 'pending' ||
      bet.manualOverride ||
      leg?.market !== 'Other'
    )
      throw Error('Choose an Other leg in a pending parlay.');
    if (Date.now() < leg.startsAt && result !== 'void')
      throw Error('Wait until the leg has started.');
    const at = Date.now();
    const legs = bet.legs.map((l, i) =>
      i === legIndex
        ? {
            ...l,
            status: result,
            verifiedBy: actor,
            verifiedAt: at,
            verificationReason: reason.trim(),
          }
        : l,
    );
    tx.update(ref, { legs });
    tx.create(db.collection('audit').doc(), {
      betId,
      username: bet.username,
      selection: leg.selection,
      from: leg.status,
      to: result,
      actor,
      reason: reason.trim(),
      delta: 0,
      at,
    });
  });
  await settle(
    betId,
    null,
    'parlay verification',
    'Parlay results checked after Other leg verification.',
    true,
  );
  return { ok: true };
});
export const flagBet = clean(async (req) => {
  const actor = uid(req);
  const { betId, reason } = req.data ?? {};
  if (typeof betId !== 'string' || !betId || betId.includes('/'))
    throw Error('Invalid bet.');
  await db.runTransaction(async (tx) => {
    const ref = db.doc('bets/' + betId),
      snapshot = await tx.get(ref);
    if (!snapshot.exists) throw Error('Bet not found.');
    const bet = snapshot.data(),
      at = Date.now();
    const review = createReview(bet, actor, reason, at);
    tx.update(ref, { review });
    tx.create(db.collection('audit').doc(), {
      betId,
      username: bet.username,
      selection: bet.selection,
      from: bet.status,
      to: 'review requested',
      actor,
      reason: review.reason,
      delta: 0,
      at,
    });
  });
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
      const [ms, ls] = await Promise.all([
        tx.get(db.collection('members')),
        tx.get(db.collection('ledger')),
      ]);
      const cutoff = weekEnd(c.startDate, week);
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
          const minimumPenalty = minimumShortfall(staked);
          if (minimumPenalty > 0) {
            tx.update(m.ref, { balance: m.data().balance - minimumPenalty });
            tx.create(db.collection('ledger').doc(), {
              uid: m.id,
              delta: -minimumPenalty,
              at: cutoff,
              kind: 'missed weekly minimum',
              week,
              stakeDelta: 0,
              minimumShortfall: minimumPenalty,
            });
          }
          return {
            uid: m.id,
            username: m.data().username,
            balance: balance - minimumPenalty,
            staked,
            minimumMet: staked >= 1000,
            minimumPenalty,
          };
        })
        .sort((a, b) => b.balance - a.balance);
      tx.create(ref, { week, cutoff, createdAt: now, rows });
    });
  }
}
export const closeLeagueWeeks = onSchedule(
  {
    schedule: '15 10 * * 2',
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
export const syncFootballScores = onSchedule(
  {
    schedule: '0 10 * * *',
    timeZone: 'America/New_York',
    region: 'us-central1',
    retryCount: 0,
    timeoutSeconds: 540,
    maxInstances: 1,
  },
  async () => {
    const c = await config();
    if (!c.dataSyncEnabled) return;
    try {
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
        season: Number(c.startDate.slice(0, 4)),
        pendingBets: pending.docs.map((d) => d.data()),
      });
      if (!c.autoSettlementEnabled) return;
      for (const doc of pending.docs) {
        const b = doc.data();
        if (
          b.market === 'Parlay' &&
          Array.isArray(b.legs) &&
          b.autoEligible &&
          !b.manualOverride
        ) {
          await settle(
            doc.id,
            null,
            'nflverse',
            'Parlay legs checked against final scores, player statistics and verified Other results.',
            true,
          );
          continue;
        }
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
            'nflverse',
            'nflverse next-day final ' +
              (b.market === 'Player prop' ? 'player statistic' : 'score') +
              ' · full game including overtime',
            true,
          );
        else
          await db.runTransaction(async (tx) => {
            const current = await tx.get(doc.ref);
            if (!current.exists || current.data().status !== 'pending') return;
            tx.update(doc.ref, {
              pendingState: 'stats',
              reviewReason:
                'Required statistics or participation evidence are missing. Commissioner review under FanDuel Connecticut rules is needed.',
            });
          });
      }
      await configRef.update({
        lastSettlementAt: Date.now(),
        settlementError: '',
      });
    } catch (error) {
      await configRef.update({
        settlementError: error.message,
        lastSettlementFailedAt: Date.now(),
      });
      throw error;
    }
  },
);
