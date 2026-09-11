type DraftGames = {
  eventId: string;
  market: string;
  parlayLegs: { eventId: string }[];
};

// null means the current schedule has not been confirmed by the server.
export function hasUnavailableDraftGame(
  draft: DraftGames,
  availableEventIds: readonly string[] | null,
) {
  if (availableEventIds === null) return false;
  const available = new Set(availableEventIds);
  const unavailable = (id: string) =>
    id !== '' && id !== 'manual' && !available.has(id);
  return unavailable(draft.eventId) ||
    (draft.market === 'Parlay' &&
      draft.parlayLegs.some((leg) => unavailable(leg.eventId)));
}
