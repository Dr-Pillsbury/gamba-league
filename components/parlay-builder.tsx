'use client';
import { PlayerPicker } from '@/components/player-picker';
import { Minus, Plus } from 'lucide-react';
import { propsForPosition } from '@/functions/football.js';
import { MAX_LEGS, PARLAY_MARKETS } from '@/functions/parlay.js';
import { Button } from '@/components/ui/button';

type Data = { id: string; [key: string]: any };
import { newParlayLeg, type ParlayDraft } from '@/lib/parlay-draft';
export function ParlayBuilder({
  legs,
  onChange,
  events,
  rosters,
  defaultEventId,
}: {
  legs: ParlayDraft[];
  onChange: (legs: ParlayDraft[]) => void;
  events: Data[];
  rosters: Data[];
  defaultEventId: string;
}) {
  function update(id: string, patch: Partial<ParlayDraft>) {
    onChange(legs.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)));
  }
  return (
    <div className="parlay-builder">
      <p className="hint">
        Add at least two selections. Every leg must win for the full payout. A
        losing leg loses the parlay. Only Other legs need commissioner
        verification.
      </p>
      {legs.map((leg, index) => {
        const game = events.find((e) => e.id === leg.eventId);
        const players = rosters
          .filter(
            (r) =>
              r.season === game?.season &&
              [game?.homeTeamId, game?.awayTeamId].includes(r.teamId),
          )
          .flatMap((r) => r.players ?? [])
          .filter((p) => propsForPosition(p.position).length)
          .sort((a, b) => a.name.localeCompare(b.name));
        const props = propsForPosition(
          players.find((p) => p.id === leg.playerId)?.position,
        );
        return (
          <fieldset className="parlay-leg" key={leg.id}>
            <legend>Leg {index + 1}</legend>
            <button
              type="button"
              className="remove-leg"
              aria-label={`Remove leg ${index + 1}`}
              onClick={() => onChange(legs.filter((l) => l.id !== leg.id))}
            >
              <Minus size={16} />
            </button>
            <label>
              Game
              <select
                className="picker"
                required
                value={leg.eventId}
                onChange={(e) =>
                  update(leg.id, {
                    eventId: e.target.value,
                    playerId: '',
                    propKey: '',
                  })
                }
              >
                <option value="">Select game</option>
                <option value="manual">Enter event manually</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.away_team} @ {e.home_team}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Market
              <select
                className="picker"
                value={leg.market}
                onChange={(e) =>
                  update(leg.id, {
                    market: e.target.value,
                    side: ['Total', 'Player prop'].includes(e.target.value)
                      ? 'over'
                      : 'home',
                    line: '',
                    playerId: '',
                    propKey: '',
                  })
                }
              >
                {PARLAY_MARKETS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            {leg.market === 'Other' ? (
              <>
                <label>
                  Selection
                  <textarea
                    required
                    maxLength={400}
                    value={leg.selection}
                    onChange={(e) =>
                      update(leg.id, { selection: e.target.value })
                    }
                    placeholder="Describe the condition that must be true"
                  />
                </label>
                {leg.eventId === 'manual' && (
                  <label>
                    Event starts (local time)
                    <input
                      type="datetime-local"
                      required
                      value={leg.startsAt}
                      onChange={(e) =>
                        update(leg.id, { startsAt: e.target.value })
                      }
                    />
                  </label>
                )}
                <p className="tiny">
                  The commissioner verifies this leg’s result.
                </p>
              </>
            ) : (
              <>
                {!game && (
                  <p className="hint">
                    Choose a scheduled game for automatic verification.
                  </p>
                )}
                {leg.market === 'Player prop' && (
                  <>
                    <label>
                      Player
                      <PlayerPicker
                        label={`Leg ${index + 1} player`}
                        value={leg.playerId}
                        onChange={(value) =>
                          update(leg.id, { playerId: value, propKey: '' })
                        }
                        items={players.map((p) => ({
                          value: p.id,
                          label: p.name + ' · ' + p.position + ' · ' + p.teamId,
                        }))}
                      />
                    </label>
                    <label>
                      Player statistic
                      <select
                        className="picker"
                        required
                        value={leg.propKey}
                        onChange={(e) =>
                          update(leg.id, {
                            propKey: e.target.value,
                            ...(e.target.value === 'anytime_td'
                              ? { side: 'over', line: '0.5' }
                              : {}),
                          })
                        }
                      >
                        <option value="">Choose a statistic</option>
                        {props.map((p) => (
                          <option value={p.key} key={p.key}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                {leg.market === 'Player prop' &&
                leg.propKey === 'anytime_td' ? (
                  <p className="tiny">
                    At least one rushing or receiving touchdown.
                  </p>
                ) : (
                  <>
                    <label>
                      Selection
                      <select
                        className="picker"
                        value={leg.side}
                        onChange={(e) =>
                          update(leg.id, { side: e.target.value })
                        }
                      >
                        {['Total', 'Player prop'].includes(leg.market) ? (
                          <>
                            <option value="over">Over</option>
                            <option value="under">Under</option>
                          </>
                        ) : (
                          <>
                            <option value="home">
                              {game?.home_team ?? 'Home'}
                            </option>
                            <option value="away">
                              {game?.away_team ?? 'Away'}
                            </option>
                          </>
                        )}
                      </select>
                    </label>
                    {leg.market !== 'Moneyline' && (
                      <label>
                        {leg.market === 'Spread'
                          ? 'Spread for selected team'
                          : 'Line'}
                        <input
                          required
                          type="number"
                          step="0.5"
                          value={leg.line}
                          onChange={(e) =>
                            update(leg.id, { line: e.target.value })
                          }
                        />
                      </label>
                    )}
                  </>
                )}
              </>
            )}
          </fieldset>
        );
      })}
      <Button
        type="button"
        variant="outline"
        disabled={legs.length >= MAX_LEGS}
        onClick={() => onChange([...legs, newParlayLeg(defaultEventId)])}
      >
        <Plus size={16} /> Add selection
      </Button>
      <p className="tiny">
        {legs.length} / {MAX_LEGS} legs. New legs use the game selected above.
        Enter the sportsbook’s combined parlay odds below. If no legs lose and a
        leg pushes or is void, the commissioner reviews the revised odds and
        payout.
      </p>
    </div>
  );
}
