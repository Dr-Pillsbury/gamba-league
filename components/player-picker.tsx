'use client';
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from '@/components/ui/combobox';
type Item = { value: string; label: string };
export function PlayerPicker({
  id,
  value,
  onChange,
  items,
  label,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  items: Item[];
  label: string;
}) {
  const players = items.filter((item) => item.value);
  return (
    <Combobox
      items={players}
      value={players.find((p) => p.value === value) ?? null}
      itemToStringLabel={(item: Item) => item.label}
      isItemEqualToValue={(a: Item, b: Item) => a.value === b.value}
      onValueChange={(item: Item | null) => onChange(item?.value ?? '')}
    >
      <ComboboxInput
        id={id}
        aria-label={label}
        placeholder="Search name, team, or position…"
        showClear
        className="player-search"
      />
      <ComboboxContent>
        <ComboboxEmpty>No matching players.</ComboboxEmpty>
        <ComboboxList>
          {(item: Item) => (
            <ComboboxItem key={item.value} value={item}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
