'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import {
  Trophy,
  ArrowUpRight,
  ShieldCheck,
  Ticket,
  Activity,
  LogOut,
  Check,
  Clock,
  CircleAlert,
} from 'lucide-react';
import { auth, db, call, login } from '@/lib/firebase';
import {
  ParlayBuilder,
  newParlayLeg,
  type ParlayDraft,
} from '@/components/parlay-builder';
import { propsForPosition } from '@/functions/football.js';
import { LEAGUE_RULES } from '@/functions/reviews.js';
import {
  funds,
  INITIAL,
  weekAt,
  weekStart,
  weekEnd,
  bettingOpen,
  lateJoinBankroll,
  payout,
} from '@/functions/rules.js';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';

type RecordData = { id: string; [key: string]: any };
const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    n / 100,
  );
const date = (n: number) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(n));
const markets = [
  'Moneyline',
  'Spread',
  'Total',
  'Player prop',
  'Parlay',
  'Other',
];
function Picker({
  value,
  onChange,
  items,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  items: { value: string; label: string }[];
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => v !== null && onChange(v)}>
      <SelectTrigger aria-label={label} className="picker">
        <SelectValue>
          {items.find((i) => i.value === value)?.label ?? value}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export default function Home() {
  const [user, setUser] = useState<User | null>(null),
    [authReady, setAuthReady] = useState(false),
    [config, setConfig] = useState<RecordData | null>(null),
    [members, setMembers] = useState<RecordData[]>([]),
    [bets, setBets] = useState<RecordData[]>([]),
    [ledger, setLedger] = useState<RecordData[]>([]),
    [snapshots, setSnapshots] = useState<RecordData[]>([]),
    [events, setEvents] = useState<RecordData[]>([]),
    [rosters, setRosters] = useState<RecordData[]>([]),
    [audit, setAudit] = useState<RecordData[]>([]);
  const [joinRequests, setJoinRequests] = useState<RecordData[]>([]),
    [ownJoinRequest, setOwnJoinRequest] = useState<RecordData | null>(null),
    [joinBudgets, setJoinBudgets] = useState<Record<string, string>>({});
  const [now, setNow] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [username, setUsername] = useState(''),
    [tab, setTab] = useState('board'),
    [viewWeek, setViewWeek] = useState('live'),
    [filter, setFilter] = useState('all');
  const [selection, setSelection] = useState(''),
    [market, setMarket] = useState('Moneyline'),
    [odds, setOdds] = useState('-110'),
    [stake, setStake] = useState('10.00'),
    [startsAt, setStartsAt] = useState(''),
    [eventId, setEventId] = useState('manual'),
    [side, setSide] = useState('home'),
    [line, setLine] = useState('');
  const [playerId, setPlayerId] = useState(''),
    [propKey, setPropKey] = useState('');
  const [parlayLegs, setParlayLegs] = useState<ParlayDraft[]>([]);
  const [legReasons, setLegReasons] = useState<Record<string, string>>({});
  const [flaggingBet, setFlaggingBet] = useState(''),
    [flagReason, setFlagReason] = useState('');
  const [selectedBet, setSelectedBet] = useState(''),
    [result, setResult] = useState('won'),
    [reason, setReason] = useState('');
  const request = useRef({ signature: '', id: '' });
  const me = members.find((m) => m.id === user?.uid),
    commissioner = !!user && !!config?.commissionerUids?.includes(user.uid);
  const backendEnabled = config?.backendEnabled === true;
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30000);
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
      setError('');
    });
    return () => {
      clearInterval(t);
      unsub();
    };
  }, []);
  useEffect(() => {
    setConfig(null);
    setMembers([]);
    setEvents([]);
    setRosters([]);
    if (!user) return;
    const fail = (e: Error) =>
      setError(
        'League data is unavailable. The commissioner needs to deploy Firestore rules and configure the league. ' +
          e.message,
      );
    const stops = [
      onSnapshot(
        doc(db, 'config', 'league'),
        (s) => setConfig(s.exists() ? { id: s.id, ...s.data() } : null),
        fail,
      ),
      onSnapshot(
        collection(db, 'members'),
        (s) => setMembers(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        fail,
      ),
      onSnapshot(
        collection(db, 'events'),
        (s) => setEvents(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        fail,
      ),
      onSnapshot(
        collection(db, 'rosters'),
        (s) => setRosters(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        fail,
      ),
    ];
    return () => stops.forEach((s) => s());
  }, [user]);
  useEffect(() => {
    setBets([]);
    setLedger([]);
    setSnapshots([]);
    setAudit([]);
    if (!me?.id && !commissioner) return;
    const fail = (e: Error) =>
      setError('Unable to load league activity. ' + e.message);
    const stops = [
      ['bets', setBets],
      ['ledger', setLedger],
      ['snapshots', setSnapshots],
      ['audit', setAudit],
    ].map(([name, set]) =>
      onSnapshot(
        collection(db, name as string),
        (s) =>
          (set as (r: RecordData[]) => void)(
            s.docs.map((d) => ({ id: d.id, ...d.data() })),
          ),
        fail,
      ),
    );
    return () => stops.forEach((s) => s());
  }, [me?.id, commissioner]);
  useEffect(() => {
    setJoinRequests([]);
    setOwnJoinRequest(null);
    if (!user) return;
    const fail = (e: Error) => setError(e.message);
    const stops = [
      onSnapshot(
        doc(db, 'joinRequests', user.uid),
        (d) => setOwnJoinRequest(d.exists() ? { id: d.id, ...d.data() } : null),
        fail,
      ),
    ];
    if (commissioner)
      stops.push(
        onSnapshot(
          collection(db, 'joinRequests'),
          (s) =>
            setJoinRequests(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
          fail,
        ),
      );
    return () => stops.forEach((stop) => stop());
  }, [user, commissioner]);
  const start = config?.startDate ?? '2026-09-08',
    actualWeek = now ? weekAt(now, start) : 0,
    week = Math.max(1, Math.min(18, actualWeek)),
    inSeason = !!config && bettingOpen(now, start);
  const myBets = bets.filter((b) => b.uid === user?.uid),
    staked = myBets
      .filter((b) => b.week === week && b.status !== 'void')
      .reduce((n, b) => n + b.stake, 0),
    opening =
      INITIAL +
      ledger
        .filter((l) => l.uid === user?.uid && l.at < weekStart(start, week))
        .reduce((n, l) => n + l.delta, 0),
    balance = me?.balance ?? INITIAL,
    { available, reserve, needed } = funds(balance, opening, staked, week);
  const chosenEvent = events.find((e) => e.id === eventId),
    structured =
      eventId !== 'manual' && ['Moneyline', 'Spread', 'Total'].includes(market),
    potential =
      Number.isInteger(Number(odds)) &&
      Math.abs(Number(odds)) >= 100 &&
      Number(stake) > 0
        ? payout(Math.round(Number(stake) * 100), Number(odds), 'won')
        : 0;
  const gamePlayers = rosters
    .filter(
      (r) =>
        r.season === chosenEvent?.season &&
        [chosenEvent?.homeTeamId, chosenEvent?.awayTeamId].includes(r.teamId),
    )
    .flatMap((r) => r.players ?? [])
    .sort((a, b) => a.name.localeCompare(b.name));
  const selectedPlayer = gamePlayers.find((p) => p.id === playerId);
  const availableProps = propsForPosition(selectedPlayer?.position);
  const structuredProp =
    chosenEvent?.provider === 'nflverse' && market === 'Player prop';
  const schedule = events
    .filter(
      (e) =>
        e.provider === 'nflverse' &&
        Date.parse(e.commence_time) >= weekStart(start, week) &&
        Date.parse(e.commence_time) < weekEnd(start, week),
    )
    .sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time));
  const rows =
    viewWeek === 'live'
      ? [...members]
          .sort((a, b) => b.balance - a.balance)
          .map((m) => ({
            ...m,
            uid: m.id,
            staked: bets
              .filter(
                (b) => b.uid === m.id && b.week === week && b.status !== 'void',
              )
              .reduce((n, b) => n + b.stake, 0),
          }))
      : (snapshots.find((s) => s.id === viewWeek)?.rows ?? []);
  const shownBets = bets
    .filter(
      (b) =>
        (viewWeek === 'live' || b.week === Number(viewWeek)) &&
        (filter === 'all' ||
          (filter === 'mine' ? b.uid === user?.uid : b.status === filter)),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  async function action(fn: () => Promise<unknown>, success = '') {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      setMessage(success);
    } catch (e: any) {
      let msg = e.message ?? 'Something went wrong.';
      if (e.code === 'auth/unauthorized-domain')
        msg =
          'This site address must be added in Firebase Authentication → Settings → Authorized domains.';
      if (e.code === 'auth/operation-not-allowed')
        msg = 'Enable Google in Firebase Authentication → Sign-in method.';
      if (e.code === 'functions/not-found' || e.code === 'functions/internal')
        msg =
          'League server functions are not available yet. Complete the Firebase setup before placing bets.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) {
      await action(login);
      return;
    }
    const cents = Number(stake) * 100;
    if (Math.abs(cents - Math.round(cents)) > 0.00001) {
      setError('Use no more than two decimal places for your stake.');
      return;
    }
    const payload = {
      selection:
        structured || structuredProp ? 'Structured game pick' : selection,
      market,
      legs:
        market === 'Parlay'
          ? parlayLegs.map((leg) => ({
              ...leg,
              eventId: leg.eventId === 'manual' ? null : leg.eventId,
              line: leg.line === '' ? null : Number(leg.line),
              startsAt: Date.parse(leg.startsAt) || null,
            }))
          : null,
      odds: Number(odds),
      stake: Math.round(cents),
      startsAt: chosenEvent
        ? Date.parse(chosenEvent.commence_time)
        : Date.parse(startsAt),
      eventId: eventId === 'manual' || market === 'Parlay' ? null : eventId,
      side: structured || structuredProp ? side : null,
      line:
        (structured && market !== 'Moneyline') || structuredProp
          ? Number(line)
          : null,
      playerId: structuredProp ? playerId : null,
      propKey: structuredProp ? propKey : null,
    };
    const signature = JSON.stringify(payload);
    if (request.current.signature !== signature)
      request.current = { signature, id: crypto.randomUUID() };
    await action(async () => {
      await call('placeBet', { ...payload, requestId: request.current.id });
      request.current = { signature: '', id: '' };
      setSelection('');
      setParlayLegs([]);
      setStake('10.00');
    }, 'Bet placed. Everyone in the league can now see your pick.');
  }
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(
        context.registerTool(
          {
            name: 'view_league_bets',
            description:
              'Open the league bet feed, optionally showing only your own bets.',
            inputSchema: {
              type: 'object',
              properties: { scope: { type: 'string', enum: ['all', 'mine'] } },
              required: ['scope'],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: true },
            execute(input: any) {
              if (!input || !['all', 'mine'].includes(input.scope))
                throw Error('scope must be all or mine');
              setFilter(input.scope);
              setTab('bets');
              return { view: 'bets', scope: input.scope };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, []);
  const weekOptions = [
    { value: 'live', label: 'Live standings' },
    ...snapshots
      .sort((a, b) => b.week - a.week)
      .map((s) => ({
        value: s.id,
        label: 'Week ' + s.week + ' · final snapshot',
      })),
  ];
  return (
    <main className="league">
      <header>
        <a className="brand" href="/">
          G<span>/</span>L <small>GAMBA LEAGUE</small>
        </a>
        <span className="tag">FOOTBALL · 18 WEEKS</span>
        {user ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => action(() => signOut(auth))}
          >
            {me?.username ?? 'Signed in'} <LogOut size={16} />
          </Button>
        ) : (
          <Button disabled={!authReady || busy} onClick={() => action(login)}>
            Continue with Google <ArrowUpRight size={16} />
          </Button>
        )}
      </header>
      <div className="season">
        <div>
          <span className="eyebrow">
            {!config
              ? 'YOUR SEASON. YOUR PICKS.'
              : actualWeek < 1
                ? 'PRESEASON'
                : actualWeek > 18
                  ? 'SEASON COMPLETE'
                  : 'REGULAR SEASON / WEEK ' + week.toString().padStart(2, '0')}
          </span>
          <h1>{me ? 'Make your next move.' : 'The league starts here.'}</h1>
          <p>
            {me
              ? 'Your bankroll. Your picks. Your place at the top.'
              : 'A $180 bankroll. Eighteen weeks. One winner.'}
          </p>
        </div>
        {config && (
          <div className="deadline">
            <Clock size={18} />
            <span>
              {actualWeek < 1 ? 'Season opens' : 'Week ' + week + ' deadline'}
              <strong>
                {date(
                  actualWeek < 1
                    ? weekStart(start, 1)
                    : weekEnd(start, week) - 60000,
                )}
              </strong>
            </span>
          </div>
        )}
      </div>
      {error && (
        <div role="alert" className="notice error">
          <CircleAlert size={20} />
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
      {message && (
        <div role="status" className="notice">
          <Check size={20} />
          {message}
        </div>
      )}
      {user && !config && (
        <div className="notice">
          League setup is pending. Your Google account is connected; the
          commissioner still needs to configure this season.
        </div>
      )}
      {user && config && !backendEnabled && (
        <div className="notice">
          <Clock size={20} />
          <span>
            League preview: betting and result changes are paused until the
            commissioner activates the server.{' '}
            {commissioner && 'Your commissioner access is active.'}
          </span>
        </div>
      )}
      {user && !me && config && (
        <form
          className="join"
          onSubmit={(e) => {
            e.preventDefault();
            action(
              () => call('joinLeague', { username }),
              now >= weekEnd(start, 1)
                ? 'Late-entry request sent to the commissioner.'
                : 'Welcome to the league. Your $180 bankroll is ready.',
            );
          }}
        >
          <div>
            <h2>Pick your league name.</h2>
            <p>
              3–20 letters, numbers, or underscores. This name is public to
              players. Joining is open through Week 1. Later entries need
              commissioner approval and an assigned bankroll.
              {ownJoinRequest?.status === 'declined' &&
                ' Your previous request was declined; you may submit a revised request.'}
            </p>
          </div>
          <label className="sr-only" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            required
            minLength={3}
            maxLength={20}
            pattern="[A-Za-z0-9_]+"
            placeholder="Your username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Button
            disabled={
              busy ||
              !backendEnabled ||
              ownJoinRequest?.status === 'pending' ||
              lateJoinBankroll(now, start) === 0
            }
            type="submit"
          >
            {ownJoinRequest?.status === 'pending'
              ? 'Awaiting commissioner approval'
              : now >= weekEnd(start, 1)
                ? 'Request late entry'
                : 'Join league'}
          </Button>
        </form>
      )}
      <div className="stats">
        <section>
          <span>{me ? 'Account balance' : 'Starting balance'}</span>
          <strong>{money(balance)}</strong>
          <small>Bankroll · pending stakes deducted</small>
        </section>
        <section>
          <span>
            {me ? 'Available to bet · Week ' + week : 'Week 1 spending limit'}
          </span>
          <strong className="lime">{money(available)}</strong>
          <small>{money(staked)} staked this week</small>
        </section>
        <section>
          <span>Protected for future weeks</span>
          <strong>{money(reserve)}</strong>
          <small>
            <ShieldCheck size={16} /> $10 × {18 - week} remaining weeks
          </small>
        </section>
      </div>
      <div className="workspace">
        <div className="main-column">
          <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
            <TabsList variant="line" className="league-tabs">
              <TabsTrigger value="board">Standings</TabsTrigger>
              <TabsTrigger value="bets">Bet feed</TabsTrigger>
              <TabsTrigger value="schedule">Games & players</TabsTrigger>
              <TabsTrigger value="rules">League rules</TabsTrigger>
              {commissioner && (
                <TabsTrigger value="commissioner">Commissioner</TabsTrigger>
              )}
            </TabsList>
            <TabsContent value="schedule">
              <section className="panel">
                <div className="panel-title">
                  <h2>Week {week} schedule</h2>
                  <span className="tag">nflverse</span>
                </div>
                <p className="hint">
                  {config?.lastScoresSyncAt
                    ? 'Last refreshed ' + date(config.lastScoresSyncAt)
                    : 'Waiting for the first schedule import.'}{' '}
                  Schedules and rosters from nflverse. Results settle the next
                  day when final data is available.
                </p>
                {schedule.length ? (
                  schedule.map((game) => (
                    <article className="bet-card" key={game.id}>
                      <div className="bet-meta">
                        <span>{date(Date.parse(game.commence_time))}</span>
                        <span className="status">{game.status}</span>
                      </div>
                      <h3>
                        {game.away_team} @ {game.home_team}
                      </h3>
                      <p className="hint">
                        {game.venue || 'Venue not available'}
                        {game.completed
                          ? ' · Final: ' +
                            game.scores
                              .map((s: any) => s.name + ' ' + s.score)
                              .join(' / ')
                          : ''}
                      </p>
                      <Button
                        variant="outline"
                        disabled={
                          game.status !== 'NS' ||
                          Date.parse(game.commence_time) <= now
                        }
                        onClick={() => {
                          setEventId(game.id);
                          setPlayerId('');
                          setPropKey('');
                          document.getElementById('bet-slip')?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start',
                          });
                        }}
                      >
                        Choose game <ArrowUpRight size={16} />
                      </Button>
                    </article>
                  ))
                ) : (
                  <div className="empty">
                    <Clock size={36} />
                    <h3>
                      {user
                        ? 'Schedule connection is being prepared.'
                        : 'Sign in to see the schedule.'}
                    </h3>
                    <p>
                      Games and team rosters appear here after the first
                      nflverse import.
                    </p>
                  </div>
                )}
              </section>
            </TabsContent>
            <TabsContent value="board">
              <section className="panel">
                <div className="panel-title">
                  <h2>
                    <Trophy /> The leaderboard
                  </h2>
                  <Picker
                    value={viewWeek}
                    onChange={setViewWeek}
                    items={weekOptions}
                    label="Standings week"
                  />
                </div>
                <p className="hint">
                  {viewWeek === 'live'
                    ? 'Ranked by current account balance. Weekly finishes are saved after Monday closes.'
                    : 'Balance at Tuesday midnight Eastern. Later corrections appear in the live standings.'}
                </p>
                {!rows.length ? (
                  <div className="empty">
                    <Trophy size={40} />
                    <h3>A clean slate.</h3>
                    <p>
                      {user
                        ? 'Join the league to get on the board.'
                        : 'Sign in and choose your name to join the league.'}
                      <br />
                      Everyone starts with the same $180.
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rank / Player</TableHead>
                        <TableHead>Weekly stake</TableHead>
                        <TableHead className="right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((m: any, i: number) => (
                        <TableRow
                          key={m.uid}
                          className={m.uid === user?.uid ? 'my-row' : ''}
                        >
                          <TableCell>
                            <span className="rank">
                              {i > 0 && rows[i - 1].balance === m.balance
                                ? rows.findIndex(
                                    (r: any) => r.balance === m.balance,
                                  ) + 1
                                : i + 1}
                            </span>
                            <strong>{m.username}</strong>
                            {m.uid === user?.uid && (
                              <span className="you">YOU</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span
                              className={m.staked >= 1000 ? 'good' : 'muted'}
                            >
                              {money(m.staked)}{' '}
                              {m.staked >= 1000
                                ? '✓'
                                : viewWeek === 'live'
                                  ? ' / $10'
                                  : ' · missed'}
                            </span>
                          </TableCell>
                          <TableCell className="right balance-cell">
                            {money(m.balance)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </section>
              <section className="weekly">
                <div>
                  <span className="eyebrow">WEEK {week} CHECK-IN</span>
                  <h2>
                    {needed === 0
                      ? 'You’re in for the week.'
                      : money(needed) + ' left to meet your minimum.'}
                  </h2>
                </div>
                <Progress
                  value={Math.min(100, staked / 10)}
                  aria-label="Weekly minimum wager progress"
                />
                <p className="hint">
                  Split the $10 minimum across as many picks as you like. A
                  voided bet doesn’t count toward the minimum.
                </p>
              </section>
            </TabsContent>
            <TabsContent value="bets">
              <section className="panel">
                <div className="panel-title">
                  <h2>
                    <Activity /> League activity
                  </h2>
                  <Picker
                    value={filter}
                    onChange={setFilter}
                    label="Filter bets"
                    items={[
                      'all',
                      'mine',
                      'pending',
                      'won',
                      'lost',
                      'push',
                      'void',
                    ].map((v) => ({
                      value: v,
                      label:
                        v === 'all'
                          ? 'All bets'
                          : v === 'mine'
                            ? 'My bets'
                            : v.charAt(0).toUpperCase() + v.slice(1),
                    }))}
                  />
                </div>
                <div className="feed-week">
                  <Picker
                    value={viewWeek}
                    onChange={setViewWeek}
                    items={weekOptions.map((o) =>
                      o.value === 'live' ? { ...o, label: 'All weeks' } : o,
                    )}
                    label="Bet week"
                  />
                </div>
                {shownBets.length ? (
                  shownBets.map((b) => (
                    <article className="bet-card" key={b.id}>
                      <div className="bet-meta">
                        <strong>{b.username}</strong>
                        <span>W{b.week} · FanDuel CT</span>
                        <span className={'status ' + b.status}>{b.status}</span>
                      </div>
                      <h3>{b.selection}</h3>
                      {b.legs && (
                        <ol className="parlay-results">
                          {b.legs.map((leg: any, i: number) => (
                            <li key={i}>
                              {leg.selection}{' '}
                              <span className="tag">
                                {leg.status === 'pending' &&
                                leg.market === 'Other'
                                  ? 'Needs verification'
                                  : leg.status}
                              </span>
                            </li>
                          ))}
                        </ol>
                      )}
                      <p className="hint">
                        {b.market} · {b.odds > 0 ? '+' : ''}
                        {b.odds} · {date(b.startsAt)}
                      </p>
                      <div className="bet-money">
                        <span>
                          Stake <strong>{money(b.stake)}</strong>
                        </span>
                        <span>
                          {b.status === 'pending'
                            ? 'Potential return'
                            : 'Returned'}{' '}
                          <strong>
                            {money(
                              b.status === 'pending'
                                ? payout(b.stake, b.odds, 'won')
                                : b.paid,
                            )}
                          </strong>
                        </span>
                      </div>
                      <p className="tiny">
                        {b.manualOverride
                          ? 'Commissioner confirmed'
                          : b.autoEligible
                            ? 'Automatic result eligible · full game, including overtime'
                            : 'Commissioner review · custom market'}
                        {b.settlementReason ? ' — ' + b.settlementReason : ''}
                      </p>
                      {b.review && (
                        <p className="notice">
                          {b.review.status === 'open'
                            ? 'Awaiting commissioner review'
                            : 'Review resolved'}
                          : {b.review.reason}
                          {b.review.resolution
                            ? ' — ' + b.review.resolution
                            : ''}
                        </p>
                      )}
                      {b.uid === user?.uid && b.status === 'pending' && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy || !backendEnabled}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete this bet and return your ${money(b.stake)} stake? This bet will no longer count toward your weekly minimum.`,
                              )
                            ) {
                              action(
                                () => call('deleteBet', { betId: b.id }),
                                'Bet deleted. Your stake has been returned.',
                              );
                            }
                          }}
                        >
                          Delete bet
                        </Button>
                      )}
                      {b.uid === user?.uid &&
                        ['won', 'lost'].includes(b.status) &&
                        b.review?.status !== 'open' &&
                        !(
                          b.review?.status === 'resolved' &&
                          b.review.settledAt === b.settledAt
                        ) && (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={busy || !backendEnabled}
                            onClick={() => {
                              setFlaggingBet(b.id);
                              setFlagReason('');
                            }}
                          >
                            Flag for commissioner review
                          </Button>
                        )}
                      {flaggingBet === b.id &&
                        b.review?.status !== 'open' &&
                        !(
                          b.review?.status === 'resolved' &&
                          b.review.settledAt === b.settledAt
                        ) && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              action(async () => {
                                await call('flagBet', {
                                  betId: b.id,
                                  reason: flagReason,
                                });
                                setFlaggingBet('');
                                setFlagReason('');
                              }, 'Flag sent to the commissioner.');
                            }}
                          >
                            <label>
                              Describe the discrepancy
                              <textarea
                                required
                                minLength={3}
                                maxLength={500}
                                value={flagReason}
                                onChange={(e) => setFlagReason(e.target.value)}
                                placeholder="Incorrect result, stat correction, or injury protection…"
                              />
                            </label>
                            <Button
                              type="submit"
                              disabled={busy || !backendEnabled}
                            >
                              Submit review request
                            </Button>{' '}
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setFlaggingBet('')}
                            >
                              Cancel
                            </Button>
                          </form>
                        )}
                      {b.reviewReason && (
                        <p className="tiny">{b.reviewReason}</p>
                      )}
                    </article>
                  ))
                ) : (
                  <div className="empty">
                    <Ticket size={36} />
                    <h3>No picks here yet.</h3>
                    <p>Placed bets appear here for everyone in the league.</p>
                  </div>
                )}
              </section>
            </TabsContent>
            <TabsContent value="rules">
              <section className="panel rules">
                <h2>
                  <ShieldCheck /> How the league works
                </h2>
                <ol>
                  <li>
                    <strong>Start with $180.</strong> The highest account
                    balance after 18 weeks wins. All amounts are play money.
                  </li>
                  <li>
                    <strong>Wager at least $10 each week.</strong> A week starts
                    Tuesday at 10 a.m. and ends Monday at 11:59 p.m. Eastern.
                    Daylight saving time is respected.
                  </li>
                  <li>
                    <strong>Keep future weeks funded.</strong> Reserve $10 for
                    every remaining week. Week 1 starts with $10 available.
                    Settled returns can be used again during the same week;
                    pending payouts cannot be spent.
                  </li>
                  <li>
                    <strong>Place bets before the event starts.</strong> Odds
                    and selections are locked once submitted. Use a sportsbook’s
                    American odds. Split your minimum across multiple bets if
                    you wish.
                  </li>
                  <li>
                    <strong>Stake is deducted immediately.</strong> A win
                    returns stake plus profit. A loss returns nothing. A push or
                    void refunds the stake. Pushes count toward the weekly
                    minimum; voids do not.
                  </li>
                  <li>
                    <strong>Everyone can see the picks.</strong> Freeform props
                    and unusual markets need a clear description of every
                    condition and a commissioner result. Structured parlay legs
                    grade automatically; only Other legs need verification.
                    Enter a parlay’s combined odds and earliest leg start.
                  </li>
                  <li>
                    <strong>Results are traceable.</strong> Supported player
                    props use explicit final statistics; missing stats and
                    absent players require commissioner review. All bets follow
                    FanDuel Connecticut rules. Injury protection, participation
                    and special cases are verified by the commissioner; an
                    injury does not automatically refund a bet. Players can flag
                    posted wins or losses. Supported feed-linked full-game
                    moneylines, spreads, and totals can settle from final
                    scores, including overtime. The commissioner can correct
                    results with a reason. Corrections adjust the balance by the
                    difference and may temporarily reduce funds below the
                    reserve.
                  </li>
                  <li>
                    <strong>Weekly standings preserve the cutoff.</strong>{' '}
                    Pending bets have already deducted the stake. Later payouts
                    and corrections affect current standings, not saved weekly
                    finishes. Missed minimums are flagged; no automatic penalty
                    is applied. Tied balances share rank.
                  </li>
                </ol>
              </section>
            </TabsContent>
            {commissioner && (
              <TabsContent value="commissioner">
                <section className="panel">
                  <h2>Late-entry requests</h2>
                  {joinRequests.filter((r) => r.status === 'pending').length ===
                    0 && <p className="hint">No late-entry requests.</p>}
                  {joinRequests
                    .filter((r) => r.status === 'pending')
                    .map((r) => (
                      <form
                        className="bet-card"
                        key={r.id}
                        onSubmit={(e) => {
                          e.preventDefault();
                          action(
                            () =>
                              call('reviewJoinRequest', {
                                requestId: r.id,
                                approve: true,
                                bankroll: Math.round(
                                  Number(
                                    joinBudgets[r.id] ??
                                      lateJoinBankroll(now, start) / 100,
                                  ) * 100,
                                ),
                              }),
                            'Late entry approved.',
                          );
                        }}
                      >
                        <strong>{r.username}</strong>
                        <label>
                          Starting bankroll ($)
                          <input
                            type="number"
                            min="0"
                            max="1000000"
                            step="0.01"
                            required
                            value={
                              joinBudgets[r.id] ??
                              String(lateJoinBankroll(now, start) / 100)
                            }
                            onChange={(e) =>
                              setJoinBudgets({
                                ...joinBudgets,
                                [r.id]: e.target.value,
                              })
                            }
                          />
                        </label>
                        <p className="hint">
                          Default: $10 for each remaining betting week,
                          including the current week while it is open.
                        </p>
                        <Button
                          type="submit"
                          disabled={busy || !backendEnabled}
                        >
                          Approve entry
                        </Button>{' '}
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy || !backendEnabled}
                          onClick={() =>
                            action(
                              () =>
                                call('reviewJoinRequest', {
                                  requestId: r.id,
                                  approve: false,
                                }),
                              'Entry request declined.',
                            )
                          }
                        >
                          Decline
                        </Button>
                      </form>
                    ))}
                  <h2>Player review requests</h2>
                  {bets.filter((b) => b.review?.status === 'open').length ===
                    0 && (
                    <p className="hint">No player flags awaiting review.</p>
                  )}
                  {bets
                    .filter((b) => b.review?.status === 'open')
                    .map((b) => (
                      <article className="bet-card" key={b.id}>
                        <strong>
                          {b.username} · {b.selection}
                        </strong>
                        <p>{b.review.reason}</p>
                        <p className="tiny">
                          Posted result: {b.status} ·{' '}
                          {date(b.review.requestedAt)}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setSelectedBet(b.id);
                            setResult(b.status);
                            setReason('');
                          }}
                        >
                          Review this result
                        </Button>
                      </article>
                    ))}
                  <h2>Other parlay legs to verify</h2>
                  {bets
                    .filter(
                      (b) => b.market === 'Parlay' && b.status === 'pending',
                    )
                    .flatMap((b) =>
                      (b.legs ?? []).map((leg: any, i: number) => {
                        if (leg.market !== 'Other' || leg.verifiedBy)
                          return null;
                        const key = b.id + '_' + i;
                        return (
                          <article className="bet-card" key={key}>
                            <strong>
                              {b.username} · Leg {i + 1}
                            </strong>
                            <p>{leg.selection}</p>
                            <label>
                              Verification source or reason
                              <input
                                required
                                minLength={3}
                                maxLength={500}
                                value={legReasons[key] ?? ''}
                                onChange={(e) =>
                                  setLegReasons({
                                    ...legReasons,
                                    [key]: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <div className="leg-verification">
                              {['won', 'lost', 'push', 'void'].map((value) => (
                                <Button
                                  type="button"
                                  variant="outline"
                                  key={value}
                                  disabled={
                                    busy ||
                                    !backendEnabled ||
                                    (legReasons[key] ?? '').trim().length < 3 ||
                                    (now < leg.startsAt && value !== 'void')
                                  }
                                  onClick={() =>
                                    action(
                                      () =>
                                        call('verifyParlayLeg', {
                                          betId: b.id,
                                          legIndex: i,
                                          result: value,
                                          reason: legReasons[key],
                                        }),
                                      'Leg verified. Parlay payout checked.',
                                    )
                                  }
                                >
                                  {value}
                                </Button>
                              ))}
                            </div>
                          </article>
                        );
                      }),
                    )}
                  <h2>Results & corrections</h2>
                  <p className="hint">
                    Confirm the existing result to close a flag, or choose a
                    correction. Every balance adjustment is recorded for the
                    league.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      action(
                        () =>
                          call('settleBet', {
                            betId: selectedBet,
                            result,
                            reason,
                          }),
                        'Result saved and balance adjusted.',
                      );
                    }}
                  >
                    <label>
                      Bet
                      <Picker
                        value={selectedBet}
                        onChange={setSelectedBet}
                        label="Bet to settle"
                        items={bets.map((b) => ({
                          value: b.id,
                          label:
                            b.username +
                            ' · ' +
                            b.selection +
                            ' (' +
                            b.status +
                            ')',
                        }))}
                      />
                    </label>
                    <label>
                      Result
                      <Picker
                        value={result}
                        onChange={setResult}
                        label="Result"
                        items={['won', 'lost', 'push', 'void'].map((v) => ({
                          value: v,
                          label: v,
                        }))}
                      />
                    </label>
                    <label>
                      Source or correction reason
                      <textarea
                        required
                        minLength={3}
                        maxLength={500}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Final score / stats source and why this result is correct"
                      />
                    </label>
                    <Button
                      type="submit"
                      className="primary"
                      disabled={busy || !selectedBet || !backendEnabled}
                    >
                      Save result
                    </Button>
                  </form>
                  <hr />
                  <h2>Weekly finishes</h2>
                  <p className="hint">
                    Save any completed weeks that haven’t been captured yet.
                  </p>
                  <Button
                    variant="outline"
                    disabled={busy || !backendEnabled}
                    onClick={() =>
                      action(
                        () => call('refreshStandings'),
                        'Completed weeks saved.',
                      )
                    }
                  >
                    Refresh weekly snapshots
                  </Button>
                  <p className="hint">
                    Automatic scores:{' '}
                    {config?.autoSettlementEnabled ? 'enabled' : 'not enabled'}
                    {config?.lastScoresSyncAt
                      ? ' · last sync ' + date(config.lastScoresSyncAt)
                      : ''}
                  </p>
                  <p className="hint">
                    Data provider: nflverse · free public data, no API key.
                    Next-day settlement is scheduled for 10 a.m. Eastern when
                    enabled. Missing stats require commissioner review.
                  </p>
                  {config?.dataSyncError && (
                    <p className="notice error">{config.dataSyncError}</p>
                  )}
                  <h2>Correction history</h2>
                  {[...audit]
                    .sort((a, b) => b.at - a.at)
                    .slice(0, 30)
                    .map((a) => (
                      <article className="audit" key={a.id}>
                        <strong>
                          {a.username}: {a.from} → {a.to}
                        </strong>
                        <p>{a.selection}</p>
                        <p className="hint">
                          {a.reason} · {money(a.delta)} · {date(a.at)}
                        </p>
                      </article>
                    ))}
                </section>
              </TabsContent>
            )}
          </Tabs>
        </div>
        <aside>
          <section className="panel slip" id="bet-slip">
            <div className="panel-title">
              <h2>
                <Ticket /> Your bet slip
              </h2>
              <span className="tag">W{week}</span>
            </div>
            <form onSubmit={submit}>
              <label>
                Game
                <Picker
                  value={eventId}
                  onChange={(v) => {
                    setEventId(v);
                    setPlayerId('');
                    setPropKey('');
                  }}
                  label="Game"
                  items={[
                    { value: 'manual', label: 'Enter event manually' },
                    ...events
                      .filter(
                        (e) =>
                          !e.completed &&
                          (e.provider !== 'nflverse' || e.status === 'NS') &&
                          Date.parse(e.commence_time) > now &&
                          Date.parse(e.commence_time) < weekEnd(start, week),
                      )
                      .map((e) => ({
                        value: e.id,
                        label: e.away_team + ' @ ' + e.home_team,
                      })),
                  ]}
                />
              </label>
              <label>
                Market
                <Picker
                  value={market}
                  onChange={(v) => {
                    setMarket(v);
                    if (v === 'Parlay' && !parlayLegs.length)
                      setParlayLegs([
                        newParlayLeg(eventId),
                        newParlayLeg(eventId),
                      ]);
                    setSide(
                      ['Total', 'Player prop'].includes(v) ? 'over' : 'home',
                    );
                  }}
                  label="Bet market"
                  items={markets.map((v) => ({ value: v, label: v }))}
                />
              </label>
              {chosenEvent && (
                <p className="tiny">
                  {date(Date.parse(chosenEvent.commence_time))} ·{' '}
                  {chosenEvent.venue || 'Scheduled game'}
                </p>
              )}
              {market === 'Parlay' ? (
                <ParlayBuilder
                  legs={parlayLegs}
                  onChange={setParlayLegs}
                  defaultEventId={eventId}
                  rosters={rosters}
                  events={events.filter(
                    (e) =>
                      !e.completed &&
                      (e.provider !== 'nflverse' || e.status === 'NS') &&
                      Date.parse(e.commence_time) > now &&
                      Date.parse(e.commence_time) < weekEnd(start, week),
                  )}
                />
              ) : structuredProp ? (
                <>
                  <label>
                    Player
                    <Picker
                      value={playerId}
                      onChange={(v) => {
                        setPlayerId(v);
                        setPropKey('');
                      }}
                      label="Player"
                      items={[
                        { value: '', label: 'Choose a player' },
                        ...gamePlayers
                          .filter((p) => propsForPosition(p.position).length)
                          .map((p) => ({
                            value: p.id,
                            label:
                              p.name +
                              ' · ' +
                              p.position +
                              ' · ' +
                              (p.teamId === chosenEvent?.homeTeamId
                                ? chosenEvent?.home_team
                                : chosenEvent?.away_team),
                          })),
                      ]}
                    />
                  </label>
                  {!gamePlayers.length && (
                    <p className="hint">
                      This team’s roster has not been imported yet. You can use
                      “Enter event manually” for a custom pick.
                    </p>
                  )}
                  <label>
                    Player prop
                    <Picker
                      value={propKey}
                      onChange={(value) => {
                        setPropKey(value);
                        if (value === 'anytime_td') {
                          setSide('over');
                          setLine('0.5');
                        }
                      }}
                      label="Player statistic"
                      items={[
                        { value: '', label: 'Choose a statistic' },
                        ...availableProps.map((p) => ({
                          value: p.key,
                          label: p.label,
                        })),
                      ]}
                    />
                  </label>
                  {propKey === 'anytime_td' ? (
                    <p className="hint">
                      Player must score at least one rushing or receiving
                      touchdown. Passing touchdowns do not count.
                    </p>
                  ) : (
                    <div className="two">
                      <label>
                        Direction
                        <Picker
                          value={side}
                          onChange={setSide}
                          label="Prop direction"
                          items={[
                            { value: 'over', label: 'Over' },
                            { value: 'under', label: 'Under' },
                          ]}
                        />
                      </label>
                      <label>
                        Line
                        <input
                          required
                          min="0"
                          max="10000"
                          type="number"
                          step="0.5"
                          value={line}
                          onChange={(e) => setLine(e.target.value)}
                          placeholder="e.g. 64.5"
                        />
                      </label>
                    </div>
                  )}
                  <p className="tiny">
                    Prop choices are based on position, not a live sportsbook
                    listing. Enter your sportsbook’s odds and, when applicable,
                    line. Anytime touchdown counts rushing or receiving
                    touchdowns.
                  </p>
                </>
              ) : structured ? (
                <>
                  <label>
                    Selection
                    <Picker
                      value={side}
                      onChange={setSide}
                      label="Side"
                      items={
                        market === 'Total'
                          ? [
                              { value: 'over', label: 'Over' },
                              { value: 'under', label: 'Under' },
                            ]
                          : [
                              {
                                value: 'home',
                                label: chosenEvent?.home_team ?? 'Home',
                              },
                              {
                                value: 'away',
                                label: chosenEvent?.away_team ?? 'Away',
                              },
                            ]
                      }
                    />
                  </label>
                  {market !== 'Moneyline' && (
                    <label>
                      {market === 'Spread'
                        ? 'Spread for selected team'
                        : 'Total points line'}
                      <input
                        required
                        type="number"
                        step="0.5"
                        value={line}
                        onChange={(e) => setLine(e.target.value)}
                        placeholder={market === 'Spread' ? '-3.5' : '45.5'}
                      />
                    </label>
                  )}
                  <p className="tiny">
                    Full game including overtime. Two-way moneyline ties push.
                  </p>
                </>
              ) : (
                <label>
                  Pick / selection
                  <textarea
                    required
                    maxLength={400}
                    value={selection}
                    onChange={(e) => setSelection(e.target.value)}
                    placeholder={
                      market === 'Parlay'
                        ? 'List every leg and its line. Use the earliest leg’s start time.'
                        : 'e.g. Buffalo −3.5, full game including overtime'
                    }
                  />
                </label>
              )}
              {eventId === 'manual' && market !== 'Parlay' && (
                <label>
                  Event starts (your device’s local time)
                  <input
                    required
                    type="datetime-local"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                  />
                </label>
              )}
              <p className="hint">
                All bets follow{' '}
                <a href={LEAGUE_RULES.url} target="_blank" rel="noreferrer">
                  FanDuel Connecticut rules
                </a>
                . Injury protection and special cases require commissioner
                verification.
              </p>
              <div className="two">
                <label>
                  American odds
                  <input
                    required
                    type="number"
                    step="1"
                    min="-100000"
                    max="100000"
                    value={odds}
                    onChange={(e) => setOdds(e.target.value)}
                  />
                </label>
                <label>
                  Stake ($)
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={available / 100}
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                  />
                </label>
              </div>
              <div className="return">
                <span>
                  Potential return <small>Includes your stake</small>
                </span>
                <strong>{money(potential)}</strong>
              </div>
              <Button
                type={user ? 'submit' : 'button'}
                onClick={!user ? () => action(login) : undefined}
                className="primary"
                disabled={
                  busy ||
                  !authReady ||
                  (!!user &&
                    (!backendEnabled ||
                      !me ||
                      !inSeason ||
                      available === 0 ||
                      (structuredProp && (!playerId || !propKey)) ||
                      (market === 'Parlay' && parlayLegs.length < 2)))
                }
              >
                {busy
                  ? 'Working…'
                  : !user
                    ? 'Sign in to place your bet'
                    : !backendEnabled
                      ? 'Betting server is paused'
                      : !me
                        ? 'Join the league first'
                        : !inSeason
                          ? 'Betting is not open'
                          : available === 0
                            ? 'Weekly allowance used'
                            : 'Place bet'}{' '}
                <ArrowUpRight size={17} />
              </Button>
            </form>
            <p className="hint">
              <ShieldCheck size={15} className="inline-icon" /> Your{' '}
              {money(reserve)} reserve stays protected. Submitted bets cannot be
              edited.
            </p>
          </section>
          <div className="sidebar-note">
            <span className="eyebrow">THE LONG GAME</span>
            <p>
              One good week helps.
              <br />
              Eighteen good decisions win.
            </p>
          </div>
        </aside>
      </div>
      <footer>
        PLAY MONEY. REAL BRAGGING RIGHTS.
        <span>
          Tuesday 10 a.m. → Monday 11:59 p.m. · Eastern time · Data:{' '}
          <a
            href="https://github.com/nflverse/nflverse-data"
            target="_blank"
            rel="noreferrer"
          >
            nflverse
          </a>
        </span>
      </footer>
    </main>
  );
}
