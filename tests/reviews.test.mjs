import test from 'node:test';
import assert from 'node:assert/strict';
import { createReview, LEAGUE_RULES } from '../functions/reviews.js';
import { gradeProp } from '../functions/football.js';
const bet = { uid: 'player', status: 'lost', settledAt: 100, paid: 0 };
test('only the owner can flag a posted win or loss', () => {
  assert.throws(() => createReview(bet, 'other', 'Incorrect score', 200));
  for (const status of ['pending','void','push']) assert.throws(() => createReview({...bet,status}, 'player', 'Incorrect score', 200));
  for (const status of ['won','lost']) assert.equal(createReview({...bet,status},'player','Incorrect score',200).status,'open');
});
test('flags require a bounded reason, prevent duplicates, and do not modify payouts', () => {
  for (const reason of ['', ' x ', 'x'.repeat(501), null]) assert.throws(() => createReview(bet,'player',reason,200));
  const review = createReview(bet,'player',' Stat correction ',200);
  assert.equal(review.reason,'Stat correction');
  assert.equal(bet.paid,0);
  assert.throws(() => createReview({...bet,review},'player','Again',201));
  assert.throws(() => createReview({...bet,review:{...review,status:'resolved'}},'player','Again',201));
});
test('league defaults pin FanDuel Connecticut rules', () => {
  assert.equal(LEAGUE_RULES.jurisdiction,'Connecticut');
  assert.ok(LEAGUE_RULES.url.includes('/CT/'));
});
test('FanDuel zero-stat props wait for participation evidence', () => {
  const b = { rules: LEAGUE_RULES, market: 'Player prop', gradingRule: 'full-game', playerId: 'p', propKey: 'receiving_yards', side: 'under', line: 0.5 };
  const player = { values: { receiving_yards: 0 }, participated: false };
  assert.equal(gradeProp(b, {completed:true}, {players:{p:player}}), null);
  assert.equal(gradeProp(b, {completed:true}, {players:{p:{...player,participated:true}}}), 'won');
});
