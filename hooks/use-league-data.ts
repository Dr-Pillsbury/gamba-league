'use client';
import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  collection,
  doc,
  documentId,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryConstraint,
  type WhereFilterOp,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { createSubscriptionStore } from '@/lib/subscription-store';
import { bankrollAdjustment, weekAt, weekStart, weekEnd } from '@/functions/rules.js';
export type RecordData = DocumentData & { id: string };

type Constraint =
  | ['where', string, WhereFilterOp, string | number | string[]]
  | ['orderBy', string, 'asc' | 'desc']
  | ['limit', number];
type Source = {
  collection: string;
  document?: string;
  constraints?: Constraint[];
};
type SourceState = {
  records: RecordData[];
  loaded: boolean;
  serverReady: boolean;
  error: string;
};

// Query identity depends on values rather than freshly allocated arrays or
// User/config objects. A new key exposes empty state immediately; React then
// disconnects the previous listener and connects the new one after commit.
function useSource(uid: string | null, source: Source | null) {
  const key = JSON.stringify(uid && source ? [uid, source] : null);
  const store = useMemo(() => {
    const initial: SourceState = {
      records: [],
      loaded: false,
      serverReady: false,
      error: '',
    };
    const descriptor = JSON.parse(key) as [string, Source] | null;
    return createSubscriptionStore(initial, (publish) => {
      if (!descriptor) return () => {};
      const [, spec] = descriptor;
      const receive = (records: RecordData[], fromCache: boolean) =>
        publish((previous) => ({
          records,
          loaded: true,
          serverReady: previous.serverReady || !fromCache,
          error: '',
        }));
      const fail = (error: Error) =>
        publish((previous) => ({
          ...previous,
          loaded: true,
          error: 'Unable to load league data. ' + error.message,
        }));
      try {
        if (spec.document !== undefined) {
          return onSnapshot(
            doc(db, spec.collection, spec.document),
            { includeMetadataChanges: true },
            (snapshot) =>
              receive(
                snapshot.exists()
                  ? [{ ...snapshot.data(), id: snapshot.id }]
                  : [],
                snapshot.metadata.fromCache,
              ),
            fail,
          );
        }
        const constraints = (spec.constraints ?? []).map(
          (constraint): QueryConstraint => {
            switch (constraint[0]) {
              case 'where':
                return where(
                  constraint[1] === '__name__' ? documentId() : constraint[1],
                  constraint[2],
                  constraint[3],
                );
              case 'orderBy':
                return orderBy(constraint[1], constraint[2]);
              case 'limit':
                return limit(constraint[1]);
            }
          },
        );
        return onSnapshot(
          query(collection(db, spec.collection), ...constraints),
          { includeMetadataChanges: true },
          (snapshot) =>
            receive(
              snapshot.docs.map((record) => ({
                ...record.data(),
                id: record.id,
              })),
              snapshot.metadata.fromCache,
            ),
          fail,
        );
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return () => {};
      }
    });
  }, [key]);
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
}

// A changed scope resets pagination before a subscription can use the old limit.
function usePageSize(key: string, size: number) {
  const [page, setPage] = useState({ key, count: size });
  if (page.key !== key) setPage({ key, count: size });
  const count = page.key === key ? page.count : size;
  return [
    count,
    () =>
      setPage((previous) => ({
        key,
        count: (previous.key === key ? previous.count : size) + size,
      })),
  ] as const;
}

// Every listener has a bounded purpose and is removed when its view closes.
export function useLeagueData(
  user: User | null,
  now: number,
  tab: string,
  viewWeek: string,
  filter: string,
  rosterEventIds: string[],
) {
  const uid = user?.uid ?? null;
  const configSource = useSource(uid, {
    collection: 'config',
    document: 'league',
  });
  const membersSource = useSource(uid, { collection: 'members' });
  const config = configSource.records[0] ?? null;
  const members: RecordData[] = membersSource.records.map((m) => ({
    ...m,
    weeklyDeposits: Array.from({ length: Math.max(0, Math.min(18, weekAt(now || weekStart(config?.startDate ?? '2026-09-08', 1), config?.startDate ?? '2026-09-08')) - Math.max(1, weekAt(m.joinedAt, config?.startDate ?? '2026-09-08'))) }, (_, i) => {
      const depositWeek = Math.max(1, weekAt(m.joinedAt, config?.startDate ?? '2026-09-08')) + i + 1;
      return { id: 'deposit-' + depositWeek, at: weekStart(config?.startDate ?? '2026-09-08', depositWeek), delta: 1000, kind: 'weekly deposit' };
    }),
    balance: m.balance + bankrollAdjustment(m, now || weekStart(config?.startDate ?? '2026-09-08', 1), config?.startDate ?? '2026-09-08'),
    startingBankroll: m.bankrollVersion === 2 ? (m.startingBankroll ?? 1000) :
      (m.startingBankroll ?? 18000) - (18 - Math.max(1, Math.min(18, weekAt(m.joinedAt, config?.startDate ?? '2026-09-08')))) * 1000,
  }));
  const me = members.find((member) => member.id === uid);
  const commissioner = !!uid && !!config?.commissionerUids?.includes(uid);
  const member = !!me || commissioner;
  const summarized =
    members.length > 0 && members.every((m) => m.weeklyStakesVersion === 1);
  const start = config?.startDate ?? '2026-09-08';
  const week = Math.max(1, Math.min(18, now ? weekAt(now, start) : 1));
  const weeklySource = useSource(
    uid,
    member && !summarized
      ? {
          collection: 'bets',
          constraints: [['where', 'week', '==', week]],
        }
      : null,
  );
  const snapshotsSource = useSource(
    uid,
    member
      ? {
          collection: 'snapshots',
          constraints: [
            ['orderBy', 'week', 'desc'],
            ['limit', 18],
          ],
        }
      : null,
  );
  const eventsSource = useSource(
    uid,
    config
      ? {
          collection: 'events',
          constraints: [
            [
              'where',
              'commence_time',
              '>=',
              new Date(weekStart(start, week)).toISOString(),
            ],
            [
              'where',
              'commence_time',
              '<',
              new Date(weekEnd(start, week)).toISOString(),
            ],
            ['orderBy', 'commence_time', 'asc'],
          ],
        }
      : null,
  );
  const events = eventsSource.records;
  const rosterIds = [
    ...new Set(
      events
        .filter((event) => rosterEventIds.includes(event.id))
        .flatMap((event) => [
          `${event.season}_${event.homeTeamId}`,
          `${event.season}_${event.awayTeamId}`,
        ]),
    ),
  ].sort();
  const rostersSource = useSource(
    uid,
    rosterIds.length
      ? {
          collection: 'rosters',
          constraints: [['where', '__name__', 'in', rosterIds.slice(0, 30)]],
        }
      : null,
  );
  // Twenty supported legs can reference forty teams. Firestore permits only
  // thirty IDs per `in` query; keep the overflow listener independently scoped.
  const extraRostersSource = useSource(
    uid,
    rosterIds.length > 30
      ? {
          collection: 'rosters',
          constraints: [['where', '__name__', 'in', rosterIds.slice(30)]],
        }
      : null,
  );
  const [feedCount, loadMore] = usePageSize(
    JSON.stringify([uid, viewWeek, filter]),
    30,
  );
  const [adminCount, loadMoreAdmin] = usePageSize(JSON.stringify(uid), 50);
  const feedActive = !!uid && member && tab === 'bets';
  const feedConstraints: Constraint[] = [];
  if (viewWeek !== 'live')
    feedConstraints.push(['where', 'week', '==', Number(viewWeek)]);
  if (filter === 'mine' && uid)
    feedConstraints.push(['where', 'uid', '==', uid]);
  else if (filter !== 'all' && filter !== 'mine')
    feedConstraints.push(['where', 'status', '==', filter]);
  const feedSource = useSource(
    uid,
    feedActive
      ? {
          collection: 'bets',
          constraints: [
            ...feedConstraints,
            ['orderBy', 'createdAt', 'desc'],
            ['limit', feedCount + 1],
          ],
        }
      : null,
  );
  const seasonActive = member && tab === 'season';
  const seasonSource = useSource(
    uid,
    seasonActive && uid
      ? {
          collection: 'bets',
          constraints: [['where', 'uid', '==', uid]],
        }
      : null,
  );
  const ledgerSource = useSource(
    uid,
    seasonActive && uid
      ? {
          collection: 'ledger',
          constraints: [['where', 'uid', '==', uid]],
        }
      : null,
  );
  const adminActive = commissioner && tab === 'commissioner';
  const adminSource = useSource(
    uid,
    adminActive
      ? {
          collection: 'bets',
          constraints: [
            ['orderBy', 'createdAt', 'desc'],
            ['limit', adminCount + 1],
          ],
        }
      : null,
  );
  const pendingSource = useSource(
    uid,
    adminActive
      ? {
          collection: 'bets',
          constraints: [['where', 'status', '==', 'pending']],
        }
      : null,
  );
  const reviewsSource = useSource(
    uid,
    adminActive
      ? {
          collection: 'bets',
          constraints: [['where', 'review.status', '==', 'open']],
        }
      : null,
  );
  const auditSource = useSource(
    uid,
    adminActive
      ? {
          collection: 'audit',
          constraints: [
            ['orderBy', 'at', 'desc'],
            ['limit', 30],
          ],
        }
      : null,
  );
  const joinsSource = useSource(
    uid,
    adminActive
      ? {
          collection: 'joinRequests',
          constraints: [['where', 'status', '==', 'pending']],
        }
      : null,
  );
  const ownJoinSource = useSource(
    uid,
    uid && !me
      ? {
          collection: 'joinRequests',
          document: uid,
        }
      : null,
  );
  const bets = useMemo(
    () => [
      ...new Map(
        [
          ...weeklySource.records,
          ...adminSource.records.slice(0, adminCount),
          ...pendingSource.records,
          ...reviewsSource.records,
        ].map((bet) => [bet.id, bet]),
      ).values(),
    ],
    [
      weeklySource.records,
      adminSource.records,
      pendingSource.records,
      reviewsSource.records,
      adminCount,
    ],
  );
  const sources = [
    configSource,
    membersSource,
    weeklySource,
    snapshotsSource,
    eventsSource,
    rostersSource,
    extraRostersSource,
    feedSource,
    seasonSource,
    ledgerSource,
    adminSource,
    pendingSource,
    reviewsSource,
    auditSource,
    joinsSource,
    ownJoinSource,
  ];
  return {
    config,
    members,
    me,
    commissioner,
    events,
    rosters: [...rostersSource.records, ...extraRostersSource.records],
    bets,
    ledger: ledgerSource.records,
    snapshots: snapshotsSource.records,
    audit: auditSource.records,
    joinRequests: joinsSource.records,
    ownJoinRequest: ownJoinSource.records[0] ?? null,
    shownBets: feedSource.records.slice(0, feedCount),
    feedLoading: feedActive && !feedSource.loaded,
    hasMore: feedSource.records.length > feedCount,
    loadMore,
    adminHasMore: adminSource.records.length > adminCount,
    loadMoreAdmin,
    seasonBets: seasonSource.records,
    seasonReady:
      seasonSource.loaded &&
      ledgerSource.loaded &&
      !seasonSource.error &&
      !ledgerSource.error,
    balancesReady:
      !uid ||
      (configSource.serverReady &&
        membersSource.serverReady &&
        (!member || summarized || weeklySource.serverReady)),
    balanceLoadFailed: !!(
      configSource.error ||
      membersSource.error ||
      weeklySource.error
    ),
    dataError: [
      ...new Set(sources.map((source) => source.error).filter(Boolean)),
    ].join(' '),
  };
}
