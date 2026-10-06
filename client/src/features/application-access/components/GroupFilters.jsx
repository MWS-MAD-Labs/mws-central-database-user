import { deadCount, groupFilterErrors } from "../utils/groupFilterState.js";
import { isRealUnit } from "../utils/legacyUnit.js";
import { MultiCheckList } from "./MultiCheckList.jsx";

const fits = (allowedIds) => (item) => !allowedIds || allowedIds.has(item.id);
const leftOut = (selection, allowedIds) => {
  const count = deadCount(selection, allowedIds);
  return count > 0 ? `${count} picked left out. They do not fit the other choices.` : undefined;
};

// Unit, job position and job level filters of a group access. `allowed` limits each list
// to what can still hold someone given the other two (the master data rules).
export function GroupFilters({ audience, options, state, showErrors, allowed }) {
  const employeesOnly = audience !== "STUDENTS";
  const errors = showErrors ? groupFilterErrors(state, audience, allowed) : {};
  const asItem = (item) => ({ id: item.id, name: item.name });
  return (
    <>
      <MultiCheckList
        label="Units"
        allLabel="All Units"
        items={(options.units || []).filter(isRealUnit).filter(fits(employeesOnly ? allowed?.units : null)).map(asItem)}
        selection={state.units}
        hint={employeesOnly ? leftOut(state.units, allowed?.units) : undefined}
        error={errors.units}
      />
      {employeesOnly ? (
        <>
          <MultiCheckList
            label="Job Positions"
            allLabel="All Positions"
            items={(options.jobPositions || []).filter(fits(allowed?.job_positions)).map(asItem)}
            selection={state.positions}
            hint={leftOut(state.positions, allowed?.job_positions) ?? "Only applies to employees."}
            error={errors.positions}
          />
          <MultiCheckList
            label="Job Levels"
            allLabel="All Levels"
            items={(options.jobLevels || []).filter(fits(allowed?.job_levels)).map(asItem)}
            selection={state.levels}
            hint={leftOut(state.levels, allowed?.job_levels) ?? "Only applies to employees."}
            error={errors.levels}
          />
        </>
      ) : null}
    </>
  );
}
