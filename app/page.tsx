'use client';
import { BetSlip } from '@/components/bet-slip';
import { BetFeed } from '@/components/bet-feed';
import { Picker } from '@/components/league-picker';
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type SyntheticEvent,
} from 'react';
import { useLeagueData } from '@/hooks/use-league-data';
import { useBetDraft } from '@/hooks/use-bet-draft';
import { money, date } from '@/lib/league-format';
import { WeeklyChecklist } from '@/components/weekly-checklist';
const CommissionerPanel = lazy(() => import('@/components/commissioner-panel'));
const MySeason = lazy(() => import('@/components/my-season'));
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  Trophy,
  ArrowUpRight,
  ShieldCheck,
  LogOut,
  Check,
  Clock,
  CircleAlert,
  LoaderCircle,
} from 'lucide-react';
import {
  auth,
  call,
  login,
  loginLocal,
  isLocalDevelopment,
} from '@/lib/firebase';
import type { ParlayDraft } from '@/lib/parlay-draft';
import { propsForPosition } from '@/functions/football.js';
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
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

function BalanceLoading({ failed = false }: { failed?: boolean }) {
  return (
    <span className="balance-loading" role="status">
      {!failed && <LoaderCircle size={18} aria-hidden="true" />}
      {failed ? 'Unavailable' : 'Loading…'}
    </span>
  );
}
export default function Home() {
  const [user, setUser] = useState<User | null>(null),
    [authReady, setAuthReady] = useState(false);
  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setAuthReady(true);
      }),
    [],
  );
  return (
    <League key={user?.uid ?? 'signed-out'} user={user} authReady={authReady} />
  );
}
function League({
  user,
  authReady,
}: {
  user: User | null;
  authReady: boolean;
}) {
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
    [odds, setOdds] = useState(''),
    [stake, setStake] = useState(''),
    [startsAt, setStartsAt] = useState(''),
    [eventId, setEventId] = useState(''),
    [side, setSide] = useState('home'),
    [line, setLine] = useState('');
  const [betSlipMissing, setBetSlipMissing] = useState<string[]>([]);
  const [playerId, setPlayerId] = useState(''),
    [propKey, setPropKey] = useState('');
  const [parlayLegs, setParlayLegs] = useState<ParlayDraft[]>([]);
  const [request, setRequest] = useState({ signature: '', id: '' });
  const {
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
    shownBets,
    feedLoading,
    hasMore,
    loadMore,
    adminHasMore,
    loadMoreAdmin,
    seasonBets,
    seasonReady,
    balancesReady,
    dataError,
    balanceLoadFailed,
  } = useLeagueData(
    user,
    now,
    tab,
    viewWeek,
    filter,
    market === 'Parlay'
      ? parlayLegs
          .filter((l) => l.market === 'Player prop')
          .map((l) => l.eventId)
      : market === 'Player prop'
        ? [eventId]
        : [],
  );
  const backendEnabled = config?.backendEnabled === true;
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const start = config?.startDate ?? '2026-09-08',
    actualWeek = now ? weekAt(now, start) : 0,
    week = Math.max(1, Math.min(18, actualWeek)),
    inSeason = !!config && bettingOpen(now, start);
  const showBalanceLoading = !authReady || !balancesReady || balanceLoadFailed;
  const balancePlaceholder = <BalanceLoading failed={balanceLoadFailed} />;
  const myBets = bets.filter((b) => b.uid === user?.uid),
    staked =
      me?.weeklyStakesVersion === 1
        ? (me.weeklyStakes?.[week] ?? 0)
        : myBets
            .filter((b) => b.week === week && b.status !== 'void')
            .reduce((n, b) => n + b.stake, 0),
    balance = me?.balance ?? INITIAL,
    { available, reserve } = funds(balance, 0, staked, week);
  const bettableEvents = events
    .filter(
      (e) =>
        !e.completed &&
        (e.provider !== 'nflverse' || e.status === 'NS') &&
        Date.parse(e.commence_time) > now &&
        Date.parse(e.commence_time) < weekEnd(start, week),
    )
    .sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time));
  const chosenEvent = bettableEvents.find((e) => e.id === eventId),
    structured =
      !!chosenEvent && ['Moneyline', 'Spread', 'Total'].includes(market),
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
            staked:
              m.weeklyStakesVersion === 1
                ? (m.weeklyStakes?.[week] ?? 0)
                : bets
                    .filter(
                      (b) =>
                        b.uid === m.id &&
                        b.week === week &&
                        b.status !== 'void',
                    )
                    .reduce((n, b) => n + b.stake, 0),
          }))
      : (snapshots.find((s) => s.id === viewWeek)?.rows ?? []);
  const draft = {
    selection,
    market,
    odds,
    stake,
    startsAt,
    eventId,
    side,
    line,
    playerId,
    propKey,
    parlayLegs,
    request: request,
  };
  const resetDraft = () => {
    setSelection('');
    setMarket('Moneyline');
    setOdds('');
    setStake('');
    setStartsAt('');
    setEventId('');
    setSide('home');
    setLine('');
    setPlayerId('');
    setPropKey('');
    setParlayLegs([]);
    setRequest({ signature: '', id: '' });
  };
  const { draftNotice, persistDraft, clearDraft } = useBetDraft(
    user && config ? 'gamba-draft:' + start + ':' + user.uid : null,
    draft,
    (d) => {
      setSelection(d.selection);
      setMarket(d.market);
      setOdds(d.odds);
      setStake(d.stake);
      setStartsAt(d.startsAt);
      setEventId(d.eventId);
      setSide(d.side);
      setLine(d.line);
      setPlayerId(d.playerId);
      setPropKey(d.propKey);
      setParlayLegs(d.parlayLegs);
      if (
        typeof d.request?.signature === 'string' &&
        /^[a-f0-9-]{36}$/.test(d.request?.id)
      )
        setRequest(d.request);
    },
  );
  async function action(fn: () => Promise<unknown>, success = '') {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      setMessage(success);
    } catch (e: unknown) {
      let msg = e instanceof Error ? e.message : 'Something went wrong.';
      const code = e && typeof e === 'object' && 'code' in e ? e.code : '';
      if (code === 'auth/unauthorized-domain')
        msg =
          'This site address must be added in Firebase Authentication → Settings → Authorized domains.';
      if (code === 'auth/operation-not-allowed')
        msg = 'Enable Google in Firebase Authentication → Sign-in method.';
      if (code === 'functions/not-found' || code === 'functions/internal')
        msg =
          'League server functions are not available yet. Complete the Firebase setup before placing bets.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    if (!user) {
      await action(login);
      return;
    }
    const missing: string[] = [];
    const numeric = (value: string) =>
      value.trim() !== '' && Number.isFinite(Number(value));
    if (!market) missing.push('Market');
    if (market !== 'Parlay' && !eventId) missing.push('Game');
    if (market !== 'Parlay' && eventId === 'manual' && !startsAt)
      missing.push('Event start time');
    if (structuredProp && (!playerId || !propKey))
      missing.push(!playerId ? 'Player' : 'Player statistic');
    if (structuredProp && propKey !== 'anytime_td' && !numeric(line))
      missing.push('Prop line');
    if (market === 'Parlay') {
      if (parlayLegs.length < 2) missing.push('At least two parlay selections');
      parlayLegs.forEach((leg, i) => {
        const n = i + 1;
        if (
          leg.market !== 'Other' &&
          (!leg.eventId || leg.eventId === 'manual')
        )
          missing.push(`Leg ${n} game`);
        if (leg.market === 'Other' && !leg.selection.trim())
          missing.push(`Leg ${n} selection`);
        if (leg.market === 'Other' && leg.eventId === 'manual' && !leg.startsAt)
          missing.push(`Leg ${n} event start time`);
        if (leg.market === 'Player prop' && !leg.playerId)
          missing.push(`Leg ${n} player`);
        if (leg.market === 'Player prop' && !leg.propKey)
          missing.push(`Leg ${n} player statistic`);
        if (
          leg.market !== 'Moneyline' &&
          leg.market !== 'Other' &&
          leg.propKey !== 'anytime_td' &&
          !numeric(leg.line)
        )
          missing.push(`Leg ${n} line`);
      });
    }
    if (market === 'Other' && !selection.trim())
      missing.push('Pick / selection');
    if (!numeric(odds)) missing.push('American odds');
    if (!numeric(stake) || Number(stake) <= 0) missing.push('Stake');
    if (missing.length) {
      setBetSlipMissing(missing);
      setError(`Complete: ${missing.join(', ')}.`);
      requestAnimationFrame(() => {
        const selectors: Record<string, string> = {
          Market: '[aria-label="Bet market"]',
          Game: '[aria-label="Game"]',
          Player: '[aria-label="Player"]',
          'Player statistic': '[aria-label="Player statistic"]',
        };
        const first =
          document.querySelector<HTMLElement>(selectors[missing[0]]) ??
          document.querySelector<HTMLElement>(
            'input:invalid, textarea:invalid, select:invalid',
          );
        first?.focus();
        first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      return;
    }
    setBetSlipMissing([]);
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
              eventId:
                leg.eventId && leg.eventId !== 'manual' ? leg.eventId : null,
              line: leg.line === '' ? null : Number(leg.line),
              startsAt: Date.parse(leg.startsAt) || null,
            }))
          : null,
      odds: Number(odds),
      stake: Math.round(cents),
      // The server derives a parlay's start time from its validated legs.
      startsAt:
        market === 'Parlay'
          ? null
          : chosenEvent
            ? Date.parse(chosenEvent.commence_time)
            : Date.parse(startsAt),
      eventId:
        eventId && eventId !== 'manual' && market !== 'Parlay' ? eventId : null,
      side: structured || structuredProp ? side : null,
      line:
        (structured && market !== 'Moneyline') || structuredProp
          ? Number(line)
          : null,
      playerId: structuredProp ? playerId : null,
      propKey: structuredProp ? propKey : null,
    };
    if (
      ![payload.odds, payload.stake].every(Number.isFinite) ||
      (market !== 'Parlay' && !Number.isFinite(payload.startsAt))
    ) {
      setError('Complete the highlighted betslip fields with valid numbers.');
      return;
    }
    const signature = JSON.stringify(payload);
    const submission =
      request.signature === signature
        ? request
        : { signature, id: crypto.randomUUID() };
    setRequest(submission);
    persistDraft({ ...draft, request: submission });
    await action(async () => {
      await call('placeBet', { ...payload, requestId: submission.id });
      setRequest({ signature: '', id: '' });
      setSelection('');
      setParlayLegs([]);
      setOdds('');
      setStake('');
      resetDraft();
      clearDraft();
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
    ...[...snapshots]
      .sort((a, b) => b.week - a.week)
      .map((s) => ({
        value: s.id,
        label: 'Week ' + s.week + ' · final snapshot',
      })),
  ];
  return (
    <main className="league">
      {isLocalDevelopment && (
        <div className="notice local-preview">
          <span>
            Local test league · demo accounts and play money · live data is
            isolated
          </span>
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => action(() => loginLocal('commissioner'))}
          >
            Demo commissioner
          </Button>
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => action(() => loginLocal('player'))}
          >
            Demo player
          </Button>
        </div>
      )}
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
      {(error || dataError) && (
        <div role="alert" className="notice error">
          <CircleAlert size={20} />
          <span>{error || dataError}</span>
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
            void action(
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
          <span>
            {user || !authReady ? 'Account balance' : 'Starting balance'}
          </span>
          <strong>
            {showBalanceLoading ? balancePlaceholder : money(balance)}
          </strong>
          <small>Bankroll · pending stakes deducted</small>
        </section>
        <section>
          <span>
            {showBalanceLoading
              ? 'Available to bet'
              : me
                ? 'Available to bet · Week ' + week
                : 'Week 1 spending limit'}
          </span>
          <strong className="lime">
            {showBalanceLoading ? balancePlaceholder : money(available)}
          </strong>
          <small>
            {balanceLoadFailed
              ? 'Weekly stakes unavailable'
              : showBalanceLoading
                ? 'Loading weekly stakes…'
                : `${money(staked)} staked this week`}
          </small>
        </section>
        <section>
          <span>Protected for future weeks</span>
          <strong>
            {showBalanceLoading ? balancePlaceholder : money(reserve)}
          </strong>
          <small>
            <ShieldCheck size={16} />{' '}
            {showBalanceLoading
              ? 'Future weeks reserved'
              : `$10 × ${18 - week} remaining weeks`}
          </small>
        </section>
      </div>
      <div className="workspace">
        <div className="main-column">
          <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
            <TabsList variant="line" className="league-tabs">
              <TabsTrigger value="board">Standings</TabsTrigger>
              <TabsTrigger value="bets">Bet feed</TabsTrigger>
              <TabsTrigger value="season">My season</TabsTrigger>
              <TabsTrigger value="schedule">Games & players</TabsTrigger>
              <TabsTrigger value="rules">League rules</TabsTrigger>
              {commissioner && (
                <TabsTrigger value="commissioner">Commissioner</TabsTrigger>
              )}
            </TabsList>
            <TabsContent value="season">
              {tab === 'season' && (
                <Suspense
                  fallback={
                    <section className="panel" role="status">
                      Loading your season…
                    </section>
                  }
                >
                  <MySeason
                    member={me}
                    bets={seasonBets}
                    ledger={ledger}
                    snapshots={snapshots}
                    ready={seasonReady}
                  />
                </Suspense>
              )}
            </TabsContent>
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
                    : 'Balance after the Tuesday deadline and any missed-minimum penalty. Later corrections appear in the live standings.'}
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
                                  : ` · missed${m.minimumPenalty ? ` (−${money(m.minimumPenalty)})` : ''}`}
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
              <WeeklyChecklist
                week={week}
                start={start}
                now={now}
                staked={staked}
                ready={!showBalanceLoading}
              />
            </TabsContent>
            <TabsContent value="bets">
              <BetFeed
                filter={filter}
                setFilter={setFilter}
                viewWeek={viewWeek}
                setViewWeek={setViewWeek}
                weekOptions={weekOptions}
                config={config}
                feedLoading={feedLoading}
                shownBets={shownBets}
                events={events}
                now={now}
                user={user}
                busy={busy}
                backendEnabled={backendEnabled}
                action={action}
                hasMore={hasMore}
                loadMore={loadMore}
              />
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
                    <strong>No early cashouts are available.</strong> Players
                    must stick to the bets they have placed.
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
                    finishes. If you miss the $10 minimum, the amount you were
                    short is deducted at the deadline as a loss. Tied balances
                    share rank.
                  </li>
                </ol>
              </section>
            </TabsContent>
            {commissioner && (
              <TabsContent value="commissioner">
                {tab === 'commissioner' && (
                  <Suspense
                    fallback={
                      <section className="panel" role="status">
                        Loading commissioner tools…
                      </section>
                    }
                  >
                    <CommissionerPanel
                      config={config}
                      bets={bets}
                      now={now}
                      start={start}
                      joinRequests={joinRequests}
                      audit={audit}
                      busy={busy}
                      backendEnabled={backendEnabled}
                      action={action}
                      adminHasMore={adminHasMore}
                      loadMoreAdmin={loadMoreAdmin}
                    />
                  </Suspense>
                )}
              </TabsContent>
            )}
          </Tabs>
        </div>
        <aside>
          <BetSlip
            eventId={eventId}
            market={market}
            playerId={playerId}
            propKey={propKey}
            side={side}
            line={line}
            selection={selection}
            startsAt={startsAt}
            odds={odds}
            stake={stake}
            start={start}
            draftNotice={draftNotice}
            week={week}
            now={now}
            available={available}
            reserve={reserve}
            potential={potential}
            authReady={authReady}
            busy={busy}
            backendEnabled={backendEnabled}
            balanceLoadFailed={balanceLoadFailed}
            showBalanceLoading={showBalanceLoading}
            structuredProp={structuredProp}
            structured={structured}
            inSeason={inSeason}
            setEventId={setEventId}
            setMarket={setMarket}
            setPlayerId={setPlayerId}
            setPropKey={setPropKey}
            setSide={setSide}
            setLine={setLine}
            setSelection={setSelection}
            setStartsAt={setStartsAt}
            setOdds={setOdds}
            setStake={setStake}
            user={user}
            me={me}
            chosenEvent={chosenEvent}
            bettableEvents={bettableEvents}
            rosters={rosters}
            events={events}
            gamePlayers={gamePlayers}
            availableProps={availableProps}
            parlayLegs={parlayLegs}
            setParlayLegs={setParlayLegs}
            submit={submit}
            action={action}
            clearDraft={clearDraft}
            resetDraft={resetDraft}
            betSlipMissing={betSlipMissing}
          />
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
