'use client';
import { useState } from 'react';
import type { User } from 'firebase/auth';
import { Activity, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Picker } from '@/components/league-picker';
import { money, date } from '@/lib/league-format';
import { pendingExplanation } from '@/lib/season-metrics.js';
import { payout } from '@/functions/rules.js';
import { call } from '@/lib/firebase';
import type { RecordData } from '@/hooks/use-league-data';
type BetLeg = { market: string; selection: string; status: string };
type Props = {
  filter: string;
  setFilter: (s: string) => void;
  viewWeek: string;
  setViewWeek: (s: string) => void;
  weekOptions: { value: string; label: string }[];
  config: RecordData | null;
  feedLoading: boolean;
  shownBets: RecordData[];
  events: RecordData[];
  now: number;
  user: User | null;
  busy: boolean;
  backendEnabled: boolean;
  action: (fn: () => Promise<unknown>, success?: string) => Promise<void>;
  hasMore: boolean;
  loadMore: () => void;
};
export function BetFeed({
  filter,
  setFilter,
  viewWeek,
  setViewWeek,
  weekOptions,
  config,
  feedLoading,
  shownBets,
  events,
  now,
  user,
  busy,
  backendEnabled,
  action,
  hasMore,
  loadMore,
}: Props) {
  const [flaggingBet, setFlaggingBet] = useState(''),
    [flagReason, setFlagReason] = useState('');
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>
          <Activity /> League activity
        </h2>
        <Picker
          value={filter}
          onChange={setFilter}
          label="Filter bets"
          items={['all', 'mine', 'pending', 'won', 'lost', 'push', 'void'].map(
            (v) => ({
              value: v,
              label:
                v === 'all'
                  ? 'All bets'
                  : v === 'mine'
                    ? 'My bets'
                    : v.charAt(0).toUpperCase() + v.slice(1),
            }),
          )}
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
      <p className="hint">
        Last successful data refresh:{' '}
        {config?.lastScoresSyncAt
          ? date(config.lastScoresSyncAt)
          : 'Not recorded yet'}
      </p>
      {feedLoading && (
        <output style={{ display: 'block' }}>Loading picks…</output>
      )}
      {shownBets.length ? (
        shownBets.map((b) => (
          <article className="bet-card" key={b.id}>
            <div className="bet-meta">
              <strong>{b.username}</strong>
              <span>W{b.week} · FanDuel CT</span>
              <span className={'status ' + b.status}>{b.status}</span>
            </div>
            <h3>{b.selection}</h3>
            {b.status === 'pending' && (
              <p className="pending-explanation">
                {pendingExplanation(b, events, now)}
              </p>
            )}
            {b.legs && (
              <ol className="parlay-results">
                {(b.legs as BetLeg[]).map((leg, i) => (
                  <li key={i}>
                    {leg.selection}{' '}
                    <span className={'tag ' + leg.status}>
                      {leg.status === 'pending' && leg.market === 'Other'
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
                {b.status === 'pending' ? 'Potential return' : 'Returned'}{' '}
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
                {b.review.resolution ? ' — ' + b.review.resolution : ''}
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
                    void action(
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
                    void action(async () => {
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
                  <Button type="submit" disabled={busy || !backendEnabled}>
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
            {b.reviewReason && <p className="tiny">{b.reviewReason}</p>}
          </article>
        ))
      ) : (
        <div className="empty">
          <Ticket size={36} />
          <h3>No picks here yet.</h3>
          <p>Placed bets appear here for everyone in the league.</p>
        </div>
      )}
      {hasMore && (
        <Button variant="outline" disabled={feedLoading} onClick={loadMore}>
          Load more picks
        </Button>
      )}
    </section>
  );
}
