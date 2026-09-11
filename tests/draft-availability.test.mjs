import test from 'node:test';
import assert from 'node:assert/strict';
import { hasUnavailableDraftGame } from '../lib/draft-availability.ts';

const single = { eventId: 'game-1', market: 'Moneyline', parlayLegs: [] };

test('preserves drafts until the schedule is ready, including failed or pending loads', () => {
  assert.equal(hasUnavailableDraftGame(single, null), false);
});

test('clears a selected game removed from the dropdown, including an empty schedule', () => {
  assert.equal(hasUnavailableDraftGame(single, ['game-1']), false);
  assert.equal(hasUnavailableDraftGame(single, ['game-2']), true);
  assert.equal(hasUnavailableDraftGame(single, []), true);
});

test('preserves manual and unfinished selections', () => {
  for (const eventId of ['', 'manual']) {
    assert.equal(hasUnavailableDraftGame({ ...single, eventId }, []), false);
  }
});

test('clears a parlay when any selected leg disappears', () => {
  const parlay = {
    eventId: '', market: 'Parlay',
    parlayLegs: [{ eventId: 'game-1' }, { eventId: 'game-2' }, { eventId: 'manual' }],
  };
  assert.equal(hasUnavailableDraftGame(parlay, ['game-1', 'game-2']), false);
  assert.equal(hasUnavailableDraftGame(parlay, ['game-1']), true);
  assert.equal(hasUnavailableDraftGame(parlay, null), false);
  assert.equal(hasUnavailableDraftGame({ ...parlay, market: 'Moneyline' }, []), false);
});
