import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { groupFilterErrors } from "../utils/groupFilterState.js";
import { isRealUnit } from "../utils/legacyUnit.js";
import { MultiCheckList } from "./MultiCheckList.jsx";
import { ListPopover } from "../../../components/ui/ListPopover.jsx";

function removedText(removed, options) {
  const named = (ids, list) =>
    ids.map((id) => (list || []).find((item) => item.id === id)?.name).filter(Boolean);
  return [
    ["Positions", named(removed.positions, options.jobPositions)],
    ["Levels", named(removed.levels, options.jobLevels)],
  ]
    .filter(([, names]) => names.length > 0)
    .map(([label, names]) => `${label}: ${names.join(", ")}`)
    .join(" · ");
}

function selectionNames(selected, items) {
  if (selected === null) return [];
  return selected
    .map((id) => items.find((item) => item.id === id)?.name)
    .filter(Boolean);
}

function ReviewValue({ selected, items, allLabel, dialogLabel }) {
  if (selected === null) {
    return <p className="text-sm font-semibold text-(--mws-charcoal)">{allLabel}</p>;
  }
  const names = selectionNames(selected, items);
  const shown = names.slice(0, 3);
  return (
    <div className="space-y-1.5">
      {shown.length > 0 ? (
        <ul className="space-y-1 text-sm text-(--mws-charcoal)">
          {shown.map((name) => (
            <li key={name} className="truncate" title={name}>{name}</li>
          ))}
        </ul>
      ) : null}
      {names.length > shown.length ? (
        <ListPopover
          label="View all"
          count={names.length}
          dialogLabel={dialogLabel}
          icon={false}
          mono={false}
          groups={[{ items: names }]}
          className="[&>button]:text-xs [&>button]:text-(--mws-burgundy)"
        />
      ) : null}
      {names.length === 0 ? <span className="text-xs text-(--mws-muted)">None selected</span> : null}
    </div>
  );
}

function StepTabs({ steps, current }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Scope steps">
      {steps.map((step, index) => (
        <li
          key={step.key}
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
            index === current
              ? "border-(--mws-burgundy) bg-(--mws-soft) text-(--mws-burgundy)"
              : index < current
                ? "border-[#b8d2b5] bg-[#f2f8f1] text-[#476b43]"
                : "border-(--mws-line) text-(--mws-muted)"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current">
            {index < current ? <Check size={12} /> : index + 1}
          </span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}

// A picked unit that nothing in the chosen levels and positions can exist in.
function UnsupportedUnits({ units, onRemove }) {
  if (units.length === 0) return null;
  return (
    <div className="space-y-2">
      {units.map((unit) => (
        <div
          key={unit.id}
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]"
        >
          <span>
            <strong>{unit.name}</strong> has no matching job level or position in this scope.
          </span>
          <Button type="button" size="sm" variant="secondary" onClick={() => onRemove(unit.id)}>
            Remove {unit.name}
          </Button>
        </div>
      ))}
    </div>
  );
}

export function GroupFilters({ audience, options, state, showErrors, knownUnitIds, onReviewChange }) {
  const employeesOnly = audience !== "STUDENTS";
  const steps = employeesOnly
    ? [
        { key: "units", label: "Units" },
        { key: "levels", label: "Job Levels" },
        { key: "positions", label: "Job Positions" },
        { key: "review", label: "Review" },
      ]
    : [
        { key: "units", label: "Units" },
        { key: "review", label: "Review" },
      ];
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex].key;
  const errors = showErrors ? groupFilterErrors(state, audience, knownUnitIds) : {};
  const dropped = state.removed ? removedText(state.removed, options) : "";
  const realUnits = (options.units || []).filter(isRealUnit);
  const selected = step === "units" ? state.units.selected : step === "levels" ? state.levels.selected : state.positions.selected;
  const canContinue = step === "review" || selected === null || selected.length > 0;

  const unsupported = employeesOnly ? state.unsupported || [] : [];
  const removeUnit = (id) => state.units.setSelected((state.units.selected || []).filter((unitId) => unitId !== id));

  const itemWithReason = (item, reasons) => ({
    id: item.id,
    name: item.name,
    disabled: Boolean(reasons?.get(item.id)),
    reason: reasons?.get(item.id) || undefined,
  });

  function move(next) {
    setStepIndex(next);
    onReviewChange?.(steps[next].key === "review");
  }

  return (
    <div className="space-y-5">
      <StepTabs steps={steps} current={stepIndex} />

      {step === "units" ? (
        <MultiCheckList
          label="Units"
          allLabel="All Units"
          items={realUnits.map((item) => ({ id: item.id, name: item.name }))}
          selection={state.units}
          hint="Choose the units this group covers."
          error={errors.units}
        />
      ) : null}

      {step === "levels" ? (
        <MultiCheckList
          label="Job Levels"
          allLabel="All Levels"
          items={(options.jobLevels || []).map((item) => itemWithReason(item, state.availability?.levels))}
          selection={state.levels}
          hint="Go back to change units."
          error={errors.levels}
        />
      ) : null}

      {step === "positions" ? (
        <MultiCheckList
          label="Job Positions"
          allLabel="All Positions"
          items={(options.jobPositions || []).map((item) => itemWithReason(item, state.availability?.positions))}
          selection={state.positions}
          hint="Go back to change units or levels."
          error={errors.positions}
        />
      ) : null}

      {step === "levels" || step === "positions" ? (
        <UnsupportedUnits units={unsupported} onRemove={removeUnit} />
      ) : null}

      {step === "review" ? (
        <div className="space-y-3" aria-label="Scope review">
          <UnsupportedUnits units={unsupported} onRemove={removeUnit} />
          {[
            ["Units", state.units.selected, realUnits, "All Units"],
            ...(employeesOnly
              ? [
                  ["Job Levels", state.levels.selected, options.jobLevels || [], "All Levels"],
                  ["Job Positions", state.positions.selected, options.jobPositions || [], "All Positions"],
                ]
              : []),
          ].map(([label, selectedIds, items, allLabel]) => (
            <div key={label} className="rounded-xl border border-(--mws-line) bg-white p-4">
              <p className="mb-2 font-display text-xs font-bold uppercase tracking-wide text-(--mws-muted)">{label}</p>
              <ReviewValue
                selected={selectedIds}
                items={items}
                allLabel={allLabel}
                dialogLabel={`${label} selected`}
              />
            </div>
          ))}
        </div>
      ) : null}

      {dropped ? (
        <p role="status" className="rounded-xl bg-(--mws-soft) px-3 py-2 text-xs text-(--mws-charcoal)">
          Also removed because they no longer fit. {dropped}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-t border-(--mws-line) pt-4">
        <Button
          type="button"
          variant="secondary"
          disabled={stepIndex === 0}
          onClick={() => move(stepIndex - 1)}
        >
          <ChevronLeft size={15} />
          Back
        </Button>
        {step !== "review" ? (
          <Button type="button" disabled={!canContinue} onClick={() => move(stepIndex + 1)}>
            Next
            <ChevronRight size={15} />
          </Button>
        ) : (
          unsupported.length === 0 ? (
            <p className="text-xs font-medium text-[#476b43]">Scope is ready to save.</p>
          ) : (
            <p className="text-xs font-medium text-[#805b18]">Remove the units above before saving.</p>
          )
        )}
      </div>
    </div>
  );
}
