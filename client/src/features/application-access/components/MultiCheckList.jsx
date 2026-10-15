import { useState } from "react";
import { Field, TextInput, ToggleChip } from "../../../components/ui/FormControls.jsx";
import { ListPopover } from "../../../components/ui/ListPopover.jsx";

function IncompatibilityReason({ reason, itemName }) {
  if (!reason) return null;
  if (reason.kind === "level") return <>Level mismatch</>;
  if (reason.kind === "scope") return <>Scope mismatch</>;
  if (reason.kind === "no-positions") return <>No matching positions</>;
  const names = reason.names || [];
  if (names.length === 1) return <>Needs {names[0]}</>;
  if (names.length === 2) return <>Needs {names[0]} or {names[1]}</>;
  return (
    <span className="inline-flex items-center gap-1">
      Needs one of
      <ListPopover
        label={`${names.length} units`}
        count={names.length}
        dialogLabel={`Units required by ${itemName}`}
        icon={false}
        mono={false}
        groups={[{ items: names }]}
        className="[&>button]:text-[11px] [&>button]:text-(--mws-burgundy)"
      />
    </span>
  );
}

// Pick any of many items as chips. "All" means no limit, and picking every item is the same.
export function MultiCheckList({ label, allLabel, items, selection, hint, error, disabled = false }) {
  const [filter, setFilter] = useState("");
  const { selected, setSelected } = selection;
  const enabledItems = items.filter((item) => !item.disabled);
  const needle = filter.trim().toLowerCase();
  const shown = items.filter((item) => !needle || item.name.toLowerCase().includes(needle));
  const isChosen = (item) => !item.disabled && (selected === null || selected.includes(item.id));
  const chosenCount = selected === null ? enabledItems.length : selected.length;

  function update(next) {
    // Choosing every item is the same as "All", so new items are included later too.
    setSelected(enabledItems.length > 0 && next.length === enabledItems.length ? null : next);
  }

  function toggle(id) {
    const current = selected === null ? enabledItems.map((item) => item.id) : selected;
    update(current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return (
    <Field label={label} hint={hint} error={error}>
      <div className="space-y-2">
        {items.length > 12 ? (
          <TextInput
            value={filter}
            disabled={disabled}
            placeholder={`Search ${label.toLowerCase()}`}
            onChange={(event) => setFilter(event.target.value)}
          />
        ) : null}
        <div className="mws-scrollbar flex max-h-40 flex-wrap gap-2 overflow-y-auto" role="group" aria-label={label}>
          <ToggleChip disabled={disabled} checked={selected === null} onChange={(checked) => setSelected(checked ? null : [], { wipe: false })}>
            {allLabel}
          </ToggleChip>
          {shown.map((item) => (
            <span key={item.id} className="inline-flex flex-col gap-1">
              <ToggleChip
                disabled={disabled || item.disabled}
                checked={isChosen(item)}
                onChange={() => toggle(item.id)}
              >
                {item.name}
              </ToggleChip>
              {item.reason ? (
                <span className="max-w-52 px-2 text-[11px] leading-4 text-(--mws-muted)">
                  <IncompatibilityReason reason={item.reason} itemName={item.name} />
                </span>
              ) : null}
            </span>
          ))}
        </div>
        <p className="text-xs text-(--mws-muted)">
          {selected === null ? `${allLabel} selected.` : `${chosenCount} of ${enabledItems.length} available selected.`}
        </p>
      </div>
    </Field>
  );
}
