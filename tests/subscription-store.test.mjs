import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubscriptionStore } from '../lib/subscription-store.ts';

function fixture() {
  const initial = { records: [], ready: false, error: '' };
  const connections = [];
  const store = createSubscriptionStore(initial, (publish) => {
    const connection = { publish, stopped: 0 };
    connections.push(connection);
    return () => {
      connection.stopped++;
    };
  });
  return { initial, connections, store };
}

await test('render and server snapshot reads never connect or allocate new snapshots', () => {
  const { store, initial, connections } = fixture();
  assert.equal(store.getSnapshot(), initial);
  assert.equal(store.getSnapshot(), store.getSnapshot());
  assert.equal(store.getServerSnapshot(), initial);
  assert.equal(connections.length, 0);
});

await test('subscribers share one connection and cleanup happens at the last unsubscribe', () => {
  const { store, connections } = fixture();
  let first = 0,
    second = 0;
  const stopFirst = store.subscribe(() => {
    first++;
  });
  const stopSecond = store.subscribe(() => {
    second++;
  });
  assert.equal(connections.length, 1);
  connections[0].publish((previous) => ({
    ...previous,
    records: [{ id: 'bet' }],
  }));
  assert.deepEqual(store.getSnapshot().records, [{ id: 'bet' }]);
  assert.equal(first, 1);
  assert.equal(second, 1);
  stopFirst();
  assert.equal(connections[0].stopped, 0);
  connections[0].publish((previous) => ({ ...previous, ready: true }));
  assert.equal(first, 1);
  assert.equal(second, 2);
  stopSecond();
  assert.equal(connections[0].stopped, 1);
});

await test('Strict Mode cleanup and reconnect starts empty and ignores the old callbacks', () => {
  const { store, initial, connections } = fixture();
  const stop = store.subscribe(() => {});
  connections[0].publish(() => ({
    records: [{ id: 'old' }],
    ready: true,
    error: '',
  }));
  stop();
  assert.equal(store.getSnapshot(), initial);
  const stopAgain = store.subscribe(() => {});
  assert.equal(connections.length, 2);
  connections[0].publish(() => ({
    records: [{ id: 'late' }],
    ready: true,
    error: 'obsolete',
  }));
  assert.equal(store.getSnapshot(), initial);
  connections[1].publish(() => ({
    records: [{ id: 'new' }],
    ready: true,
    error: '',
  }));
  assert.deepEqual(store.getSnapshot().records, [{ id: 'new' }]);
  assert.equal(store.getServerSnapshot(), initial);
  stopAgain();
  assert.equal(connections[1].stopped, 1);
});

await test('switching query stores cannot expose old records, readiness, or errors', () => {
  const oldQuery = fixture();
  const stopOld = oldQuery.store.subscribe(() => {});
  oldQuery.connections[0].publish(() => ({
    records: [{ id: 'old-user-week' }],
    ready: true,
    error: 'old failure',
  }));
  const nextQuery = fixture();
  // A render sees the new query before React cleans up the previous subscription.
  assert.deepEqual(nextQuery.store.getSnapshot(), {
    records: [],
    ready: false,
    error: '',
  });
  stopOld();
  const stopNext = nextQuery.store.subscribe(() => {});
  oldQuery.connections[0].publish(() => ({
    records: [{ id: 'late' }],
    ready: true,
    error: '',
  }));
  assert.equal(nextQuery.store.getSnapshot(), nextQuery.initial);
  stopNext();
});

await test('independent sources retain their state while another source reconnects', () => {
  const bets = fixture(),
    ledger = fixture();
  const stopBets = bets.store.subscribe(() => {});
  const stopLedger = ledger.store.subscribe(() => {});
  ledger.connections[0].publish(() => ({
    records: [{ id: 'ledger' }],
    ready: true,
    error: 'ledger failed',
  }));
  const ledgerSnapshot = ledger.store.getSnapshot();
  stopBets();
  const stopMoreBets = bets.store.subscribe(() => {});
  bets.connections[1].publish(() => ({
    records: [{ id: 'more-bets' }],
    ready: true,
    error: '',
  }));
  assert.equal(ledger.store.getSnapshot(), ledgerSnapshot);
  assert.equal(ledger.connections.length, 1);
  stopMoreBets();
  stopLedger();
});

await test('a synchronous initial callback is visible as soon as subscription completes', () => {
  const store = createSubscriptionStore(0, (publish) => {
    publish(() => 1);
    return () => {};
  });
  let notifications = 0;
  const stop = store.subscribe(() => {
    notifications++;
  });
  assert.equal(store.getSnapshot(), 1);
  assert.equal(notifications, 1);
  stop();
});
