import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import {
  groupFilterErrors,
  withoutStudents,
} from "../utils/groupFilterState.js";
import { isRealUnit } from "../utils/legacyUnit.js";
import { MultiCheckList } from "./MultiCheckList.jsx";
import { ListPopover } from "../../../components/ui/ListPopover.jsx";

function removedText(removed, options) {
  const named = (ids, list) =>
    ids
      .map((id) => (list || []).find((item) => item.id === id)?.name)
      .filter(Boolean);
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
    return (
      <p className="text-sm font-semibold text-(--mws-charcoal)">{allLabel}</p>
    );
  }
  const names = selectionNames(selected, items);
  const shown = names.slice(0, 3);
  return (
    <div className="space-y-1.5">
      {shown.length > 0 ? (
        <ul className="space-y-1 text-sm text-(--mws-charcoal)">
          {shown.map((name) => (
            <li key={name} className="truncate" title={name}>
              {name}
            </li>
          ))}
        </ul>
      ) : null}
      {names.length > shown.length ? (
        <ListPopover
          label="View All"
          count={names.length}
          dialogLabel={dialogLabel}
          icon={false}
          mono={false}
          groups={[{ items: names }]}
          className="[&>button]:text-xs [&>button]:text-(--mws-burgundy)"
        />
      ) : null}
      {names.length === 0 ? (
        <span className="text-xs text-(--mws-muted)">None selected</span>
      ) : null}
    </div>
  );
}

function StepTabs({ steps, current }) {
  return (
    <ol
      className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
      aria-label="Scope Steps"
    >
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

const reasonOf = { units: "job level or position", levels: "unit or position" };

// Picked units or levels that nothing in the rest of the scope can exist in. One notice
// lists them all, each with its own remove icon, and a single action clears the lot.
function UnsupportedPicks({ picks, onRemove, onRemoveAll }) {
  if (picks.length === 0) return null;
  const kinds = [...new Set(picks.map((pick) => pick.kind))];
  const onlyStudents = kinds.length === 1 && kinds[0] === "students";
  return (
    <div
      role="alert"
      className="space-y-2 rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]"
    >
      <p>
        {onlyStudents
          ? `${picks.length === 1 ? "This unit has" : "These units have"} no students.`
          : `${picks.length === 1 ? "This pick has" : "These picks have"} no matching ${kinds
              .map((kind) => reasonOf[kind])
              .join(" or ")} in this scope.`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {picks.map((pick) => (
          <span
            key={`${pick.kind}-${pick.id}`}
            className="inline-flex items-center gap-1 rounded-full border border-[#e6c98a] bg-white py-0.5 pl-3 pr-1 text-xs font-semibold text-(--mws-charcoal)"
          >
            {pick.name}
            <button
              type="button"
              aria-label={`Remove ${pick.name}`}
              title={`Remove ${pick.name}`}
              onClick={() => onRemove(pick)}
              className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-(--mws-muted) transition-colors hover:text-(--mws-burgundy)"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        {picks.length > 1 ? (
          <button
            type="button"
            onClick={onRemoveAll}
            className="cursor-pointer text-xs font-semibold text-(--mws-burgundy) hover:underline"
          >
            Remove All
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function GroupFilters({
  audience,
  options,
  state,
  showErrors,
  knownUnitIds,
  studentUnits,
  onReviewChange,
}) {
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
  const studentUnitIds = studentUnits
    ? new Set(studentUnits.map((unit) => unit.id))
    : undefined;
  const errors = showErrors
    ? groupFilterErrors(state, audience, knownUnitIds, studentUnitIds)
    : {};
  const dropped = state.removed ? removedText(state.removed, options) : "";
  const realUnits = (options.units || []).filter(isRealUnit);
  // Students only live in units that have grades, so a student group is offered those only.
  const unitChoices = employeesOnly
    ? realUnits
    : (studentUnits || []).filter(isRealUnit);
  const selected =
    step === "units"
      ? state.units.selected
      : step === "levels"
        ? state.levels.selected
        : state.positions.selected;
  const canContinue =
    step === "review" || selected === null || selected.length > 0;

  const unitNames = new Map(
    (options.units || []).map((unit) => [unit.id, unit.name]),
  );
  const noStudents = employeesOnly
    ? []
    : withoutStudents(state.units, studentUnitIds).map((id) => ({
        id,
        name: unitNames.get(id) || id,
        kind: "students",
      }));
  const unsupported = employeesOnly ? state.unsupported?.all || [] : noStudents;
  const dropOne = (pick) =>
    state.dropPicks({
      [pick.kind === "students" ? "units" : pick.kind]: [pick.id],
    });
  const dropAll = () =>
    state.dropPicks({
      units: unsupported
        .filter((pick) => pick.kind === "units" || pick.kind === "students")
        .map((pick) => pick.id),
      levels: unsupported
        .filter((pick) => pick.kind === "levels")
        .map((pick) => pick.id),
    });

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
          items={unitChoices.map((item) => ({ id: item.id, name: item.name }))}
          selection={state.units}
          hint={
            employeesOnly
              ? audience === "EMPLOYEES_AND_STUDENTS"
                ? "Choose the units this group covers. Units without students add employees only."
                : "Choose the units this group covers."
              : "Pick the school units whose students this group covers."
          }
          error={errors.units}
        />
      ) : null}

      {step === "levels" ? (
        <MultiCheckList
          label="Job Levels"
          allLabel="All Levels"
          items={(options.jobLevels || []).map((item) =>
            itemWithReason(item, state.availability?.levels),
          )}
          selection={state.levels}
          hint="Go back to change units."
          error={errors.levels}
        />
      ) : null}

      {step === "positions" ? (
        <MultiCheckList
          label="Job Positions"
          allLabel="All Positions"
          items={(options.jobPositions || []).map((item) =>
            itemWithReason(item, state.availability?.positions),
          )}
          selection={state.positions}
          hint="Go back to change units or levels."
          error={errors.positions}
        />
      ) : null}

      {(step === "units" && !employeesOnly) ||
      step === "levels" ||
      step === "positions" ? (
        <UnsupportedPicks
          picks={unsupported}
          onRemove={dropOne}
          onRemoveAll={dropAll}
        />
      ) : null}

      {step === "review" ? (
        <div className="space-y-3" aria-label="Scope Review">
          <UnsupportedPicks
            picks={unsupported}
            onRemove={dropOne}
            onRemoveAll={dropAll}
          />
          {[
            [
              employeesOnly ? "Units" : "Students in",
              state.units.selected,
              unitChoices,
              employeesOnly ? "All Units" : "All School Units",
            ],
            ...(employeesOnly
              ? [
                  [
                    "Job Levels",
                    state.levels.selected,
                    options.jobLevels || [],
                    "All Levels",
                  ],
                  [
                    "Job Positions",
                    state.positions.selected,
                    options.jobPositions || [],
                    "All Positions",
                  ],
                ]
              : []),
          ].map(([label, selectedIds, items, allLabel]) => (
            <div
              key={label}
              className="rounded-xl border border-(--mws-line) bg-white p-4"
            >
              <p className="mb-2 font-display text-xs font-bold uppercase tracking-wide text-(--mws-muted)">
                {label}
              </p>
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
        <p
          role="status"
          className="rounded-xl bg-(--mws-soft) px-3 py-2 text-xs text-(--mws-charcoal)"
        >
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
          <Button
            type="button"
            disabled={!canContinue}
            onClick={() => move(stepIndex + 1)}
          >
            Next
            <ChevronRight size={15} />
          </Button>
        ) : unsupported.length === 0 ? (
          <p className="text-xs font-medium text-[#476b43]">
            Scope is ready to save.
          </p>
        ) : (
          <p className="text-xs font-medium text-[#805b18]">
            Remove the picks above before saving.
          </p>
        )}
      </div>
    </div>
  );
}
