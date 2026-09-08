import { randomUUID } from 'node:crypto';
import { createApiNflClient, syncNfl } from './api-nfl.js';

export async function runNflImport({ store, key, season, pendingBets = [] }) {
  const runId = randomUUID(),
    started = Date.now();
  await store.update('sync/nflLock', (current) => {
    if (current?.expiresAt > started)
      throw Error('Another football refresh is running.');
    return { runId, expiresAt: started + 15 * 60000 };
  });
  const dayPath = () =>
    'sync/nflQuota_' + new Date().toISOString().slice(0, 10);
  const request = createApiNflClient({
    key,
    reserveRequest: () =>
      store.update(dayPath(), (current) => {
        const used = current?.used ?? 0;
        if (used >= 90)
          throw Error(
            'The free-tier safety limit of 90 requests today has been reached. Try after 00:00 UTC.',
          );
        return { used: used + 1 };
      }),
    recordRemaining: (remaining) =>
      store.update(dayPath(), (current) => ({
        used: Math.max(current?.used ?? 0, 100 - remaining),
      })),
  });
  try {
    const result = await syncNfl({ store, request, season, pendingBets });
    await store.update('config/league', (c) => ({
      ...c,
      dataProvider: 'api-nfl',
      lastScoresSyncAt: Date.now(),
      dataSyncStatus: 'ready',
      dataSyncError: '',
    }));
    return result;
  } catch (error) {
    await store.update('config/league', (c) => ({
      ...c,
      dataProvider: 'api-nfl',
      dataSyncStatus: 'attention',
      dataSyncError: error.message,
    }));
    throw error;
  } finally {
    await store.update('sync/nflLock', (current) =>
      current?.runId === runId ? { runId, expiresAt: 0 } : current,
    );
  }
}
