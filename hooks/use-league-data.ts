'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  documentId,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { weekAt, weekStart, weekEnd } from '@/functions/rules.js';
export type RecordData = { id: string; [key: string]: any };

// Every listener has a bounded purpose and is removed when its view closes.
export function useLeagueData(
  user: User | null,
  now: number,
  tab: string,
  viewWeek: string,
  filter: string,
  rosterEventIds: string[],
) {
  const [config, setConfig] = useState<RecordData | null>(null);
  const [members, setMembers] = useState<RecordData[]>([]);
  const [events, setEvents] = useState<RecordData[]>([]);
  const [rosters, setRosters] = useState<RecordData[]>([]);
  const [weeklyBets, setWeeklyBets] = useState<RecordData[]>([]);
  const [feed, setFeed] = useState<RecordData[]>([]);
  const [commissionerBets, setCommissionerBets] = useState<RecordData[]>([]);
  const [pending, setPending] = useState<RecordData[]>([]);
  const [reviews, setReviews] = useState<RecordData[]>([]);
  const [seasonBets, setSeasonBets] = useState<RecordData[]>([]);
  const [ledger, setLedger] = useState<RecordData[]>([]);
  const [snapshots, setSnapshots] = useState<RecordData[]>([]);
  const [audit, setAudit] = useState<RecordData[]>([]);
  const [joinRequests, setJoinRequests] = useState<RecordData[]>([]);
  const [ownJoinRequest, setOwnJoinRequest] = useState<RecordData | null>(null);
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedCount, setFeedCount] = useState(30);
  const [adminCount, setAdminCount] = useState(50);
  const [feedLoading, setFeedLoading] = useState(false);
  const [seasonReady, setSeasonReady] = useState<Record<string, boolean>>({});
  const me = members.find((m) => m.id === user?.uid);
  const commissioner = !!user && !!config?.commissionerUids?.includes(user.uid);
  const member = !!me || commissioner;
  const summarized =
    members.length > 0 && members.every((m) => m.weeklyStakesVersion === 1);
  const start = config?.startDate ?? '2026-09-08';
  const week = Math.max(1, Math.min(18, now ? weekAt(now, start) : 1));
  const fail = (source: string) => (e: Error) =>
    setErrors((previous) => ({
      ...previous,
      [source]: 'Unable to load league data. ' + e.message,
    }));
  const clearError = (source: string) =>
    setErrors((previous) => {
      if (!previous[source]) return previous;
      const next = { ...previous };
      delete next[source];
      return next;
    });
  useEffect(() => {
    setConfig(null);
    setMembers([]);
    setReady({});
    setErrors({});
    if (!user) return;
    const stopConfig = onSnapshot(
      doc(db, 'config', 'league'),
      { includeMetadataChanges: true },
      (s) => {
        clearError('config');
        setConfig(s.exists() ? { id: s.id, ...s.data() } : null);
        if (!s.metadata.fromCache) setReady((r) => ({ ...r, config: true }));
      },
      fail('config'),
    );
    const stopMembers = onSnapshot(
      collection(db, 'members'),
      { includeMetadataChanges: true },
      (s) => {
        clearError('members');
        setMembers(s.docs.map((d) => ({ id: d.id, ...d.data() })));
        if (!s.metadata.fromCache) setReady((r) => ({ ...r, members: true }));
      },
      fail('members'),
    );
    return () => {
      stopConfig();
      stopMembers();
    };
  }, [user?.uid]);
  useEffect(() => {
    setWeeklyBets([]);
    clearError('weekly');
    setSnapshots([]);
    setReady((r) => ({ ...r, weekly: false }));
    if (!user || !member) return;
    const stops = [
      ...(!summarized
        ? [
            onSnapshot(
              query(collection(db, 'bets'), where('week', '==', week)),
              { includeMetadataChanges: true },
              (s) => {
                clearError('weekly');
                setWeeklyBets(s.docs.map((d) => ({ id: d.id, ...d.data() })));
                if (!s.metadata.fromCache)
                  setReady((r) => ({ ...r, weekly: true }));
              },
              fail('weekly'),
            ),
          ]
        : []),
      onSnapshot(
        query(collection(db, 'snapshots'), orderBy('week', 'desc'), limit(18)),
        (s) => {
          clearError('snapshots');
          setSnapshots(s.docs.map((d) => ({ id: d.id, ...d.data() })));
        },
        fail('snapshots'),
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [user?.uid, member, week, summarized]);
  useEffect(() => {
    setEvents([]);
    if (!user || !config) return;
    return onSnapshot(
      query(
        collection(db, 'events'),
        where(
          'commence_time',
          '>=',
          new Date(weekStart(start, week)).toISOString(),
        ),
        where(
          'commence_time',
          '<',
          new Date(weekEnd(start, week)).toISOString(),
        ),
        orderBy('commence_time'),
      ),
      (s) => {
        clearError('events');
        setEvents(s.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      fail('events'),
    );
  }, [user?.uid, start, week, !!config]);
  const rosterIds = [
    ...new Set(
      events
        .filter((e) => rosterEventIds.includes(e.id))
        .flatMap((e) => [
          `${e.season}_${e.homeTeamId}`,
          `${e.season}_${e.awayTeamId}`,
        ]),
    ),
  ]
    .sort()
    .join(',');
  useEffect(() => {
    setRosters([]);
    if (!user || !rosterIds) return;
    // At most 20 teams for a ten-leg parlay.
    return onSnapshot(
      query(
        collection(db, 'rosters'),
        where(documentId(), 'in', rosterIds.split(',')),
      ),
      (s) => {
        clearError('rosters');
        setRosters(s.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      fail('rosters'),
    );
  }, [user?.uid, rosterIds]);
  useEffect(() => {
    setFeedCount(30);
  }, [user?.uid, viewWeek, filter]);
  useEffect(() => {
    setFeed([]);
    setFeedLoading(false);
    clearError('feed');
    if (!user || !member || tab !== 'bets') return;
    setFeedLoading(true);
    const constraints: QueryConstraint[] = [];
    if (viewWeek !== 'live')
      constraints.push(where('week', '==', Number(viewWeek)));
    if (filter === 'mine') constraints.push(where('uid', '==', user.uid));
    else if (filter !== 'all') constraints.push(where('status', '==', filter));
    return onSnapshot(
      query(
        collection(db, 'bets'),
        ...constraints,
        orderBy('createdAt', 'desc'),
        limit(feedCount + 1),
      ),
      (s) => {
        clearError('feed');
        setFeed(s.docs.map((d) => ({ id: d.id, ...d.data() })));
        setFeedLoading(false);
      },
      (e) => {
        fail('feed')(e);
        setFeedLoading(false);
      },
    );
  }, [user?.uid, member, tab, viewWeek, filter, feedCount]);
  useEffect(() => {
    setSeasonBets([]);
    setLedger([]);
    setSeasonReady({});
    clearError('season');
    if (!user || !member || tab !== 'season') return;
    const stops = [
      onSnapshot(
        query(collection(db, 'bets'), where('uid', '==', user.uid)),
        (s) => {
          setSeasonBets(s.docs.map((d) => ({ id: d.id, ...d.data() })));
          setSeasonReady((r) => ({ ...r, bets: true }));
        },
        fail('season'),
      ),
      onSnapshot(
        query(collection(db, 'ledger'), where('uid', '==', user.uid)),
        (s) => {
          setLedger(s.docs.map((d) => ({ id: d.id, ...d.data() })));
          setSeasonReady((r) => ({ ...r, ledger: true }));
        },
        fail('season'),
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [user?.uid, member, tab]);
  useEffect(() => {
    setCommissionerBets([]);
    setPending([]);
    setReviews([]);
    setAudit([]);
    setJoinRequests([]);
    clearError('commissioner');
    if (!user || !commissioner || tab !== 'commissioner') return;
    const listen = (
      name: string,
      constraints: QueryConstraint[],
      set: (records: RecordData[]) => void,
    ) =>
      onSnapshot(
        query(collection(db, name), ...constraints),
        (s) => set(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        fail('commissioner'),
      );
    const stops = [
      listen(
        'bets',
        [orderBy('createdAt', 'desc'), limit(adminCount + 1)],
        setCommissionerBets,
      ),
      listen('bets', [where('status', '==', 'pending')], setPending),
      listen('bets', [where('review.status', '==', 'open')], setReviews),
      listen('audit', [orderBy('at', 'desc'), limit(30)], setAudit),
      listen(
        'joinRequests',
        [where('status', '==', 'pending')],
        setJoinRequests,
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [user?.uid, commissioner, tab, adminCount]);
  useEffect(() => {
    setOwnJoinRequest(null);
    if (!user || me) return;
    return onSnapshot(
      doc(db, 'joinRequests', user.uid),
      (d) => setOwnJoinRequest(d.exists() ? { id: d.id, ...d.data() } : null),
      fail('join'),
    );
  }, [user?.uid, !!me]);
  const bets = useMemo(
    () => [
      ...new Map(
        [
          ...weeklyBets,
          ...commissionerBets.slice(0, adminCount),
          ...pending,
          ...reviews,
        ].map((b) => [b.id, b]),
      ).values(),
    ],
    [weeklyBets, commissionerBets, pending, reviews, adminCount],
  );
  return {
    config,
    members,
    me,
    commissioner,
    events,
    rosters,
    bets,
    ledger,
    snapshots,
    audit,
    joinRequests,
    ownJoinRequest,
    shownBets: feed.slice(0, feedCount),
    feedLoading,
    hasMore: feed.length > feedCount,
    loadMore: () => setFeedCount((n) => n + 30),
    adminHasMore: commissionerBets.length > adminCount,
    loadMoreAdmin: () => setAdminCount((n) => n + 50),
    seasonBets,
    seasonReady: !!seasonReady.bets && !!seasonReady.ledger,
    balancesReady:
      !user ||
      (!!ready.config &&
        !!ready.members &&
        (!member || summarized || !!ready.weekly)),
    balanceLoadFailed: !!(errors.config || errors.members || errors.weekly),
    dataError: Object.values(errors).join(' '),
  };
}
