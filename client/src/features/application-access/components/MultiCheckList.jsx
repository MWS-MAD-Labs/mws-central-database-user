import { useState } from "react";
import { CheckboxField, Field, TextInput } from "../../../components/ui/FormControls.jsx";

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
        <div className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
          <CheckboxField
            checked={selected === null}
            label={allLabel}
            onChange={(event) => setSelected(event.target.checked ? null : [])}
          />
          {shown.map((item) => (
            <CheckboxField
              key={item.id}
              checked={isChosen(item.id)}
              label={item.name}
              onChange={() => toggle(item.id)}
            />
          ))}
        </div>
        <p className="text-xs text-(--mws-muted)">
          {selected === null ? `${allLabel} selected.` : `${chosenCount} of ${items.length} selected.`}
        </p>
      </div>
    </Field>
  );
}
