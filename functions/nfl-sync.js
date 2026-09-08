import { randomUUID } from 'node:crypto';
import { syncNflverse } from './nflverse.js';

export async function runNflImport({ store, season, pendingBets = [] }) {
  const runId = randomUUID(),
    started = Date.now();
  await store.update('sync/nflLock', (current) => {
    if (current?.expiresAt > started)
      throw Error('Another football refresh is running.');
    return { runId, expiresAt: started + 15 * 60000 };
  });
  try {
    const result = await syncNflverse({ store, season, pendingBets });
    await store.update('config/league', (c) => ({
      ...c,
      dataProvider: 'nflverse',
      lastScoresSyncAt: Date.now(),
      dataSyncStatus: 'ready',
      dataSyncError: '',
    }));
    return result;
  } catch (error) {
    await store.update('config/league', (c) => ({
      ...c,
      dataProvider: 'nflverse',
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
