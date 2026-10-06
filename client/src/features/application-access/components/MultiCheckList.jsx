import { useState } from "react";
import { Field, TextInput, ToggleChip } from "../../../components/ui/FormControls.jsx";

// Pick any of many items as chips. "All" means no limit, and picking every item is the same.
export function MultiCheckList({ label, allLabel, items, selection, hint, error }) {
  const [filter, setFilter] = useState("");
  const { selected, setSelected } = selection;
  const needle = filter.trim().toLowerCase();
  const shown = items.filter((item) => !needle || item.name.toLowerCase().includes(needle));
  const isChosen = (id) => selected === null || selected.includes(id);
  const chosenCount = selected === null ? items.length : selected.length;

  function update(next) {
    // Choosing every item is the same as "All", so new items are included later too.
    setSelected(items.length > 0 && next.length === items.length ? null : next);
  }

  function toggle(id) {
    const current = selected === null ? items.map((item) => item.id) : selected;
    update(current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return (
    <Field label={label} hint={hint} error={error}>
      <div className="space-y-2">
        {items.length > 12 ? (
          <TextInput
            value={filter}
            placeholder={`Search ${label.toLowerCase()}`}
            onChange={(event) => setFilter(event.target.value)}
          />
        ) : null}
        <div className="mws-scrollbar flex max-h-40 flex-wrap gap-2 overflow-y-auto" role="group" aria-label={label}>
          <ToggleChip checked={selected === null} onChange={(checked) => setSelected(checked ? null : [])}>
            {allLabel}
          </ToggleChip>
          {shown.map((item) => (
            <ToggleChip key={item.id} checked={isChosen(item.id)} onChange={() => toggle(item.id)}>
              {item.name}
            </ToggleChip>
          ))}
        </div>
        <p className="text-xs text-(--mws-muted)">
          {selected === null ? `${allLabel} selected.` : `${chosenCount} of ${items.length} selected.`}
        </p>
      </div>
    </Field>
  );
}
