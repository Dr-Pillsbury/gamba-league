'use client';
import { lazy, Suspense, type SyntheticEvent } from 'react';
import type { User } from 'firebase/auth';
import { Ticket, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Picker } from '@/components/league-picker';
import { PlayerPicker } from '@/components/player-picker';
import { money, date } from '@/lib/league-format';
import { login } from '@/lib/firebase';
import { LEAGUE_RULES } from '@/functions/reviews.js';
import { propsForPosition } from '@/functions/football.js';
import { weekEnd } from '@/functions/rules.js';
import { newParlayLeg, type ParlayDraft } from '@/lib/parlay-draft';
import type { RecordData } from '@/hooks/use-league-data';
const ParlayBuilder = lazy(() =>
  import('@/components/parlay-builder').then((m) => ({
    default: m.ParlayBuilder,
  })),
);
const markets = [
  'Moneyline',
  'Spread',
  'Total',
  'Player prop',
  'Parlay',
  'Other',
];
type Props = {
  eventId: string;
  market: string;
  playerId: string;
  propKey: string;
  side: string;
  line: string;
  selection: string;
  startsAt: string;
  odds: string;
  stake: string;
  start: string;
  draftNotice: string;
  week: number;
  now: number;
  available: number;
  reserve: number;
  potential: number;
  authReady: boolean;
  busy: boolean;
  backendEnabled: boolean;
  balanceLoadFailed: boolean;
  showBalanceLoading: boolean;
  structuredProp: boolean;
  structured: boolean;
  inSeason: boolean;
  setEventId: (value: string) => void;
  setMarket: (value: string) => void;
  setPlayerId: (value: string) => void;
  setPropKey: (value: string) => void;
  setSide: (value: string) => void;
  setLine: (value: string) => void;
  setSelection: (value: string) => void;
  setStartsAt: (value: string) => void;
  setOdds: (value: string) => void;
  setStake: (value: string) => void;
  user: User | null;
  me?: RecordData;
  chosenEvent?: RecordData;
  bettableEvents: RecordData[];
  rosters: RecordData[];
  events: RecordData[];
  gamePlayers: RecordData[];
  availableProps: ReturnType<typeof propsForPosition>;
  parlayLegs: ParlayDraft[];
  setParlayLegs: (legs: ParlayDraft[]) => void;
  submit: (e: SyntheticEvent) => Promise<void>;
  action: (fn: () => Promise<unknown>, success?: string) => Promise<void>;
  clearDraft: () => void;
  resetDraft: () => void;
  betSlipMissing: string[];
};
export function BetSlip({
  eventId,
  market,
  playerId,
  propKey,
  side,
  line,
  selection,
  startsAt,
  odds,
  stake,
  start,
  draftNotice,
  week,
  now,
  available,
  reserve,
  potential,
  authReady,
  busy,
  backendEnabled,
  balanceLoadFailed,
  showBalanceLoading,
  structuredProp,
  structured,
  inSeason,
  setEventId,
  setMarket,
  setPlayerId,
  setPropKey,
  setSide,
  setLine,
  setSelection,
  setStartsAt,
  setOdds,
  setStake,
  user,
  me,
  chosenEvent,
  bettableEvents,
  rosters,
  events,
  gamePlayers,
  availableProps,
  parlayLegs,
  setParlayLegs,
  submit,
  action,
  clearDraft,
  resetDraft,
  betSlipMissing,
}: Props) {
  return (
    <section className="panel slip" id="bet-slip">
      <div className="panel-title">
        <h2>
          <Ticket /> Your bet slip
        </h2>
        <span className="tag">W{week}</span>
      </div>
      {user && (
        <div className="draft-status">
          <p className="hint">
            {draftNotice || 'Your draft saves on this device.'}
          </p>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              resetDraft();
              clearDraft();
            }}
          >
            Clear draft
          </Button>
        </div>
      )}
      {eventId && eventId !== 'manual' && !chosenEvent && (
        <p className="notice">
          The selected game is no longer available. Choose an upcoming game.
        </p>
      )}
      <form onSubmit={submit}>
        {betSlipMissing.length > 0 && (
          <p className="notice error" role="alert">
            Complete these fields before placing the bet:{' '}
            {betSlipMissing.join(', ')}.
          </p>
        )}
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
              { value: '', label: 'Select game' },
              { value: 'manual', label: 'Enter event manually' },
              ...bettableEvents.map((e) => ({
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
                setParlayLegs([newParlayLeg(eventId), newParlayLeg(eventId)]);
              setSide(['Total', 'Player prop'].includes(v) ? 'over' : 'home');
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
          <Suspense fallback={<p role="status">Loading parlay builder…</p>}>
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
          </Suspense>
        ) : structuredProp ? (
          <>
            <label>
              Player
              <PlayerPicker
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
                This team’s roster has not been imported yet. You can use “Enter
                event manually” for a custom pick.
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
                Player must score at least one rushing or receiving touchdown.
                Passing touchdowns do not count.
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
              Prop choices are based on position, not a live sportsbook listing.
              Enter your sportsbook’s odds and, when applicable, line. Anytime
              touchdown counts rushing or receiving touchdowns.
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
              placeholder="e.g. -110"
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
              placeholder="e.g. 10.00"
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
            showBalanceLoading ||
            (!!user &&
              (!backendEnabled ||
                !me ||
                !inSeason ||
                available === 0 ||
                (structuredProp && (!playerId || !propKey)) ||
                (market === 'Parlay' && parlayLegs.length < 2)))
          }
        >
          {showBalanceLoading
            ? balanceLoadFailed
              ? 'Balances unavailable'
              : 'Loading balances…'
            : busy
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
        {showBalanceLoading ? 'future-week' : money(reserve)} reserve stays
        protected. Submitted bets cannot be edited.
      </p>
    </section>
  );
}
