import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { money, date } from '@/lib/league-format';
import { weekStart, weekEnd, bettingOpen } from '@/functions/rules.js';
export function WeeklyChecklist({
  week,
  start,
  now,
  staked,
  ready,
}: {
  week: number;
  start: string;
  now: number;
  staked: number;
  ready: boolean;
}) {
  const needed = Math.max(0, 1000 - staked),
    open = bettingOpen(now, start);
  return (
    <section className="weekly">
      <span className="eyebrow">WEEK {week} CHECK-IN</span>
      <h2>
        {!ready
          ? 'Loading weekly progress…'
          : needed === 0
            ? 'You’re in for the week.'
            : `${money(needed)} left to meet your minimum.`}
      </h2>
      {ready && (
        <>
          <Progress
            value={Math.min(100, staked / 10)}
            aria-label="Weekly minimum wager progress"
          />
          <p className="hint">
            {money(staked)} / $10 staked · {money(needed)} remaining
          </p>
        </>
      )}
      <p className="hint">
        {open
          ? 'Closes ' + date(weekEnd(start, week) - 60000)
          : now < weekStart(start, 1)
            ? 'Season opens ' + date(weekStart(start, 1))
            : week < 18
              ? 'Betting reopens ' + date(weekStart(start, week + 1))
              : 'Season betting is closed.'}
      </p>
      <p className="hint">
        Split the minimum across picks. Pushes count; voids and deleted picks do
        not. Any unmet minimum is deducted at the deadline.
      </p>
      {open && needed > 0 && ready && (
        <Button
          variant="outline"
          onClick={() => {
            document
              .getElementById('bet-slip')
              ?.scrollIntoView({ behavior: 'smooth' });
            document
              .querySelector<HTMLElement>('#bet-slip [aria-label="Game"]')
              ?.focus({ preventScroll: true });
          }}
        >
          Complete your weekly picks
        </Button>
      )}
    </section>
  );
}
