export type ParlayDraft = {
  id: string;
  eventId: string;
  market: string;
  side: string;
  line: string;
  playerId: string;
  propKey: string;
  selection: string;
  startsAt: string;
};
export function newParlayLeg(eventId: string): ParlayDraft {
  return {
    id: crypto.randomUUID(),
    eventId,
    market: 'Moneyline',
    side: 'home',
    line: '',
    playerId: '',
    propKey: '',
    selection: '',
    startsAt: '',
  };
}
