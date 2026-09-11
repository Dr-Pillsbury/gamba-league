'use client';
import { useEffect, useEffectEvent, useState } from 'react';
import type { ParlayDraft } from '@/lib/parlay-draft';
import { MAX_LEGS } from '@/functions/parlay.js';
import { hasUnavailableDraftGame } from '@/lib/draft-availability';
const fields = [
  'selection',
  'market',
  'odds',
  'stake',
  'startsAt',
  'eventId',
  'side',
  'line',
  'playerId',
  'propKey',
] as const;
export type BetDraft = Record<(typeof fields)[number], string> & {
  parlayLegs: ParlayDraft[];
  request: { signature: string; id: string };
};
const hasDraft = (draft: BetDraft) =>
  !!(
    draft.selection ||
    draft.odds ||
    draft.stake ||
    draft.eventId ||
    draft.parlayLegs.length ||
    draft.market !== 'Moneyline'
  );
function validDraft(value: unknown): value is BetDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  const request = d.request as Record<string, unknown> | undefined;
  if (
    !request ||
    typeof request.signature !== 'string' ||
    typeof request.id !== 'string' ||
    (request.id !== '' && !/^[a-f0-9-]{36}$/.test(request.id))
  )
    return false;
  if (
    !fields.every((f) => typeof d[f] === 'string') ||
    !Array.isArray(d.parlayLegs) ||
    d.parlayLegs.length > MAX_LEGS
  )
    return false;
  return d.parlayLegs.every((value: unknown) => {
    if (!value || typeof value !== 'object') return false;
    const leg = value as Record<string, unknown>;
    return [
      'id',
      'eventId',
      'market',
      'side',
      'line',
      'playerId',
      'propKey',
      'selection',
      'startsAt',
    ].every((f) => typeof leg[f] === 'string');
  });
}
function writeDraft(key: string, draft: BetDraft) {
  if (hasDraft(draft))
    localStorage.setItem(key, JSON.stringify({ version: 1, draft }));
  else localStorage.removeItem(key);
}
const emptyDraft = (): BetDraft => ({
  selection: '', market: 'Moneyline', odds: '', stake: '', startsAt: '',
  eventId: '', side: 'home', line: '', playerId: '', propKey: '',
  parlayLegs: [], request: { signature: '', id: '' },
});
export function useBetDraft(
  key: string | null,
  draft: BetDraft,
  restore: (draft: BetDraft) => void,
  availableEventIds: readonly string[] | null,
) {
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState('');
  const onRestore = useEffectEvent(restore);
  const saveLatest = useEffectEvent((saveKey: string) =>
    writeDraft(saveKey, hasUnavailableDraftGame(draft, availableEventIds) ? emptyDraft() : draft),
  );
  useEffect(() => {
    // Synchronize React with device storage after hydration.
    // Device storage can only be read after hydration; this one-time update
    // gates saving until the external draft has been restored.
    // eslint-disable-next-line react/react-compiler
    setReadyKey(null);
    setDraftNotice('');
    // A new account/season must not inherit the previous account's form.
    onRestore(emptyDraft());
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw) as { version?: number; draft?: unknown };
        if (
          saved.version === 1 &&
          validDraft(saved.draft) &&
          hasDraft(saved.draft)
        ) {
          onRestore(saved.draft);
          setDraftNotice(
            'Draft restored on this device. Recheck game times, odds, and stake before placing it.',
          );
        } else localStorage.removeItem(key);
      }
    } catch {
      setDraftNotice('Draft storage is unavailable on this device.');
    }
    setReadyKey(key);
  }, [key]);
  const serialized = JSON.stringify(draft);
  const unavailable = hasUnavailableDraftGame(draft, availableEventIds);
  useEffect(() => {
    if (!key || key !== readyKey) return;
    if (unavailable) {
      onRestore(emptyDraft());
      setDraftNotice('Draft cleared because a selected game is no longer available.');
      try {
        localStorage.removeItem(key);
      } catch {
        setDraftNotice('Draft cleared, but device storage could not be updated.');
      }
      return;
    }
    const save = () => {
      try {
        saveLatest(key);
      } catch {
        setDraftNotice('Draft could not be saved on this device.');
      }
    };
    const timer = setTimeout(save, 250);
    window.addEventListener('pagehide', save);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pagehide', save);
    };
  }, [key, readyKey, serialized, unavailable]);
  return {
    draftNotice,
    persistDraft: (value: BetDraft) => {
      if (key) {
        try {
          writeDraft(key, hasUnavailableDraftGame(value, availableEventIds) ? emptyDraft() : value);
        } catch {
          /* Submission can still proceed. */
        }
      }
    },
    clearDraft: () => {
      if (key) {
        try {
          localStorage.removeItem(key);
        } catch {}
      }
      setDraftNotice('');
    },
  };
}
