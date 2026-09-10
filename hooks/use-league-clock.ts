'use client';
import { useSyncExternalStore } from 'react';
import { createSubscriptionStore } from '@/lib/subscription-store';

const clock = createSubscriptionStore(0, (publish) => {
  const tick = () => publish(() => Date.now());
  tick();
  const timer = setInterval(tick, 30000);
  return () => clearInterval(timer);
});

export function useLeagueClock() {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getServerSnapshot);
}
