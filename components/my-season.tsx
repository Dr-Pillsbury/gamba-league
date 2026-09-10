'use client';
import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { seasonMetrics } from '@/lib/season-metrics.js';
import { money, date } from '@/lib/league-format';
import type { RecordData } from '@/hooks/use-league-data';
export default function MySeason({
  member,
  bets,
  ledger,
  snapshots,
  ready,
}: {
  member?: RecordData;
  bets: RecordData[];
  ledger: RecordData[];
  snapshots: RecordData[];
  ready: boolean;
}) {
  const metrics = useMemo(
    () => (member ? seasonMetrics(member, bets, ledger, snapshots) : null),
    [member, bets, ledger, snapshots],
  );
  if (!metrics)
    return (
      <section className="panel">
        <h2>My season</h2>
        <p className="hint">Join the league to track your season.</p>
      </section>
    );
  if (!ready)
    return (
      <output className="panel" style={{ display: 'block' }}>
        Loading your season…
      </output>
    );
  return (
    <section className="panel season-panel">
      <div className="panel-title">
        <h2>My season</h2>
        <span className="tag">{member?.username}</span>
      </div>
      <div className="season-metrics">
        <div>
          <span>Net bankroll change</span>
          <strong className={metrics.net >= 0 ? 'good' : ''}>
            {money(metrics.net)}
          </strong>
        </div>
        <div>
          <span>Wins / losses / pushes</span>
          <strong>
            {metrics.record.won} / {metrics.record.lost} / {metrics.record.push}
          </strong>
        </div>
        <div>
          <span>Pending picks</span>
          <strong>{metrics.record.pending}</strong>
        </div>
      </div>
      <p className="hint">
        Bankroll change includes {money(metrics.pendingStake)} in pending stakes
        and any missed-minimum penalties. Voided picks: {metrics.record.void}.
      </p>
      <h3>Bankroll over time</h3>
      <figure className="bankroll-chart">
        <figcaption className="sr-only">
          Bankroll began at {money(member?.startingBankroll ?? 1000)} and is
          now {money(member?.balance ?? 0)}. A transaction table follows.
        </figcaption>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart
            data={metrics.trend}
            margin={{ left: 4, right: 20, top: 20, bottom: 10 }}
          >
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="at"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v) =>
                new Date(v).toLocaleDateString('en-US', {
                  timeZone: 'America/New_York',
                  month: 'short',
                  day: 'numeric',
                })
              }
              minTickGap={50}
              stroke="var(--muted-foreground)"
            />
            <YAxis
              tickFormatter={(v) => money(v)}
              width={72}
              stroke="var(--muted-foreground)"
            />
            <Tooltip
              labelFormatter={(v) => date(Number(v))}
              formatter={(v) => [money(Number(v)), 'Bankroll']}
              contentStyle={{
                background: 'var(--card)',
                borderColor: 'var(--border)',
                color: 'var(--foreground)',
              }}
            />
            <Line
              type="stepAfter"
              dataKey="balance"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </figure>
      <details>
        <summary>View bankroll transactions</summary>
        <div className="history-scroll">
          <table className="season-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Activity</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {metrics.trend.map((p, i) => (
                <tr key={i}>
                  <td>{date(p.at)}</td>
                  <td>{p.label}</td>
                  <td>{money(p.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <h3>Weekly finishes</h3>
      {metrics.finishes.length ? (
        <table className="season-table">
          <thead>
            <tr>
              <th>Week</th>
              <th>Rank</th>
              <th>Frozen balance</th>
            </tr>
          </thead>
          <tbody>
            {metrics.finishes.map((f) => (
              <tr key={f.week}>
                <td>{f.week}</td>
                <td>#{f.rank}</td>
                <td>{money(f.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="hint">
          Your first finish appears after the weekly snapshot is saved.
        </p>
      )}
    </section>
  );
}
