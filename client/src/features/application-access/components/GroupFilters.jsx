import { groupFilterErrors } from "../utils/groupFilterState.js";
import { isRealUnit } from "../utils/legacyUnit.js";
import { MultiCheckList } from "./MultiCheckList.jsx";

const fits = (allowedIds) => (item) => !allowedIds || allowedIds.has(item.id);

// "Positions: A, B · Levels: C" for the values the last change dropped.
function removedText(removed, options) {
  const named = (ids, list) =>
    ids.map((id) => (list || []).find((item) => item.id === id)?.name).filter(Boolean);
  return [
    ["Units", named(removed.units, options.units)],
    ["Positions", named(removed.positions, options.jobPositions)],
    ["Levels", named(removed.levels, options.jobLevels)],
  ]
    .filter(([, names]) => names.length > 0)
    .map(([label, names]) => `${label}: ${names.join(", ")}`)
    .join(" · ");
}

// Unit, job position and job level filters of a group access. The three follow the master
// data rules: each list offers what still fits the other two, and dropping a value also
// drops what only existed because of it.
export function GroupFilters({ audience, options, state, showErrors }) {
  const employeesOnly = audience !== "STUDENTS";
  const errors = showErrors ? groupFilterErrors(state, audience) : {};
  const allowed = employeesOnly ? state.allowed : null;
  const asItem = (item) => ({ id: item.id, name: item.name });
  const dropped = state.removed ? removedText(state.removed, options) : "";
  return (
    <>
      <MultiCheckList
        label="Units"
        allLabel="All Units"
        items={(options.units || []).filter(isRealUnit).filter(fits(allowed?.units)).map(asItem)}
        selection={state.units}
        error={errors.units}
      />
      {employeesOnly ? (
        <>
          <MultiCheckList
            label="Job Positions"
            allLabel="All Positions"
            items={(options.jobPositions || []).filter(fits(allowed?.positions)).map(asItem)}
            selection={state.positions}
            hint="Only applies to employees."
            error={errors.positions}
          />
          <MultiCheckList
            label="Job Levels"
            allLabel="All Levels"
            items={(options.jobLevels || []).filter(fits(allowed?.levels)).map(asItem)}
            selection={state.levels}
            hint="Only applies to employees."
            error={errors.levels}
          />
        </>
      ) : null}
      {dropped ? (
        <p role="status" className="rounded-xl bg-(--mws-soft) px-3 py-2 text-xs text-(--mws-charcoal)">
          Also removed because they no longer fit the other choices. {dropped}
        </p>
      ) : null}
    </>
  );
}
