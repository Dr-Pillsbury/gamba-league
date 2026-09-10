'use client';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Picker } from '@/components/league-picker';
import { CommissionerHealth } from '@/components/commissioner-health';
import { money, date } from '@/lib/league-format';
import { call } from '@/lib/firebase';
import { lateJoinBankroll } from '@/functions/rules.js';
import type { RecordData } from '@/hooks/use-league-data';
type ReviewableParlayLeg = {
  market: string;
  selection: string;
  startsAt: number;
  verifiedBy?: string;
};
type Props = {
  config: RecordData | null;
  bets: RecordData[];
  now: number;
  start: string;
  joinRequests: RecordData[];
  audit: RecordData[];
  busy: boolean;
  backendEnabled: boolean;
  action: (fn: () => Promise<unknown>, success?: string) => Promise<void>;
  adminHasMore: boolean;
  loadMoreAdmin: () => void;
};
export default function CommissionerPanel({
  config,
  bets,
  now,
  start,
  joinRequests,
  audit,
  busy,
  backendEnabled,
  action,
  adminHasMore,
  loadMoreAdmin,
}: Props) {
  const pickerId = useId();
  const [joinBudgets, setJoinBudgets] = useState<Record<string, string>>({});
  const [legReasons, setLegReasons] = useState<Record<string, string>>({});
  const [selectedBet, setSelectedBet] = useState(''),
    [adjustedOdds, setAdjustedOdds] = useState(''),
    [result, setResult] = useState('won'),
    [reason, setReason] = useState('');
  return (
    <section className="panel">
      <CommissionerHealth
        config={config}
        bets={bets}
        now={now}
        onReview={(id) => {
          setSelectedBet(id);
          setReason('');
          setAdjustedOdds('');
          setResult(
            bets.find((b) => b.id === id)?.status === 'pending'
              ? 'won'
              : (bets.find((b) => b.id === id)?.status ?? 'won'),
          );
          document
            .getElementById('result-form')
            ?.scrollIntoView({ behavior: 'smooth' });
        }}
      />
      <h2>Late-entry requests</h2>
      {joinRequests.filter((r) => r.status === 'pending').length === 0 && (
        <p className="hint">No late-entry requests.</p>
      )}
      {joinRequests
        .filter((r) => r.status === 'pending')
        .map((r) => (
          <form
            className="bet-card"
            key={r.id}
            onSubmit={(e) => {
              e.preventDefault();
              void action(
                () =>
                  call('reviewJoinRequest', {
                    requestId: r.id,
                    approve: true,
                    bankroll: Math.round(
                      Number(
                        joinBudgets[r.id] ?? lateJoinBankroll(now, start) / 100,
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
              Default: $10 for each remaining betting week, including the
              current week while it is open.
            </p>
            <Button type="submit" disabled={busy || !backendEnabled}>
              Approve entry
            </Button>{' '}
            <Button
              type="button"
              variant="outline"
              disabled={busy || !backendEnabled}
              onClick={() =>
                void action(
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
      {bets.filter((b) => b.review?.status === 'open').length === 0 && (
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
              Posted result: {b.status} · {date(b.review.requestedAt)}
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
        .filter((b) => b.market === 'Parlay' && b.status === 'pending')
        .flatMap((b) =>
          ((b.legs ?? []) as ReviewableParlayLeg[]).map((leg, i) => {
            if (leg.market !== 'Other' || leg.verifiedBy) return null;
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
                        void action(
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
      {bets
        .filter(
          (b) =>
            b.market === 'Parlay' && b.status === 'pending' && b.reviewReason,
        )
        .map((b) => (
          <article className="bet-card" key={b.id}>
            <strong>
              {b.username} · {b.selection}
            </strong>
            <p>{b.reviewReason}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSelectedBet(b.id);
                setAdjustedOdds('');
                setResult('won');
                setReason('');
              }}
            >
              Review odds and payout
            </Button>
          </article>
        ))}
      <p className="hint">
        Confirm the existing result to close a flag, or choose a correction.
        Every balance adjustment is recorded for the league.
      </p>
      <form
        id="result-form"
        onSubmit={(e) => {
          e.preventDefault();
          void action(
            () =>
              call('settleBet', {
                betId: selectedBet,
                adjustedOdds:
                  bets.find((b) => b.id === selectedBet)?.market === 'Parlay' &&
                  adjustedOdds !== ''
                    ? Number(adjustedOdds)
                    : null,
                result,
                reason,
              }),
            'Result saved and balance adjusted.',
          );
        }}
      >
        <label htmlFor={`${pickerId}-1`}>
          Bet
          <Picker
            id={`${pickerId}-1`}
            value={selectedBet}
            onChange={(value) => {
              setSelectedBet(value);
              setAdjustedOdds('');
            }}
            label="Bet to settle"
            items={[
              { value: '', label: 'Choose a bet' },
              ...bets.map((b) => ({
                value: b.id,
                label: b.username + ' · ' + b.selection + ' (' + b.status + ')',
              })),
            ]}
          />
        </label>
        <label htmlFor={`${pickerId}-2`}>
          Result
          <Picker
            id={`${pickerId}-2`}
            value={result}
            onChange={setResult}
            label="Result"
            items={['won', 'lost', 'push', 'void'].map((v) => ({
              value: v,
              label: v,
            }))}
          />
        </label>
        {bets.find((b) => b.id === selectedBet)?.market === 'Parlay' && (
          <label>
            Revised American odds (optional)
            <input
              type="number"
              step="1"
              min="-100000"
              max="100000"
              value={adjustedOdds}
              onChange={(e) => setAdjustedOdds(e.target.value)}
              placeholder={String(
                bets.find((b) => b.id === selectedBet)?.odds ?? '',
              )}
            />
            <span className="hint">
              Verify the remaining legs and sportsbook’s revised odds. The
              payout uses these odds; leave blank to keep the current odds.
            </span>
          </label>
        )}
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
      {adminHasMore && (
        <Button variant="outline" onClick={loadMoreAdmin}>
          Load older bets for corrections
        </Button>
      )}
      <h2>Weekly finishes</h2>
      <p className="hint">
        Save any completed weeks that haven’t been captured yet.
      </p>
      <Button
        variant="outline"
        disabled={busy || !backendEnabled}
        onClick={() =>
          void action(() => call('refreshStandings'), 'Completed weeks saved.')
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
        Data provider: nflverse · free public data, no API key. Result checks run daily at 10 a.m., plus Sundays at 1 p.m., 4 p.m. and 8 p.m. Eastern when enabled. Sunday games can settle the same day after final scores are verified; player props wait for published statistics. Missing stats
        require commissioner review.
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
  );
}
