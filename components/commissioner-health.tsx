import { healthQueue } from '@/lib/season-metrics.js';
import { date } from '@/lib/league-format';
import { Button } from '@/components/ui/button';
import type { RecordData } from '@/hooks/use-league-data';
export function CommissionerHealth({
  config,
  bets,
  now,
  onReview,
}: {
  config: RecordData | null;
  bets: RecordData[];
  now: number;
  onReview: (id: string) => void;
}) {
  const queue = healthQueue(bets, now);
  const stale =
    config?.lastScoresSyncAt && now - config.lastScoresSyncAt > 30 * 3600000;
  return (
    <section className="health-panel">
      <h2>League health</h2>
      <p className="hint">
        Last successful data refresh:{' '}
        {config?.lastScoresSyncAt
          ? date(config.lastScoresSyncAt)
          : 'No successful refresh recorded'}
      </p>
      {!config?.dataSyncEnabled && (
        <p className="notice">Football imports are paused.</p>
      )}
      {!config?.autoSettlementEnabled && (
        <p className="notice">Automatic settlement is paused.</p>
      )}
      {config?.dataSyncError && (
        <p className="notice error" role="alert">
          Latest import failed: {config.dataSyncError}
        </p>
      )}
      {config?.settlementError && (
        <p className="notice error" role="alert">
          Latest settlement failed: {config.settlementError}
        </p>
      )}
      {stale && (
        <p className="notice">Data has not refreshed for over 30 hours.</p>
      )}
      <h3>{queue.length} picks need attention</h3>
      <p className="hint">
        Player reviews first, then manual results, then older pending picks.
        Oldest items appear first within each group.
      </p>
      {queue.map((b: RecordData) => (
        <article className="bet-card" key={b.id}>
          <div className="bet-meta">
            <strong>{b.username}</strong>
            <span>{b.attention}</span>
          </div>
          <p>{b.selection}</p>
          <p className="hint">Since {date(b.attentionAt)}</p>
          <Button variant="outline" onClick={() => onReview(b.id)}>
            Review pick
          </Button>
        </article>
      ))}
      {!queue.length && (
        <p className="hint">No outstanding reviews or aging results.</p>
      )}
    </section>
  );
}
