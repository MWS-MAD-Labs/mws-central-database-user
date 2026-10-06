import { isRealUnit } from "../utils/legacyUnit.js";
import { groupFilterErrors } from "../utils/groupFilterState.js";
import { MultiCheckList } from "./MultiCheckList.jsx";

// Unit, job position and job level filters of a group access.
export function GroupFilters({ audience, options, state, showErrors }) {
  const employeesOnly = audience !== "STUDENTS";
  const errors = showErrors ? groupFilterErrors(state, audience) : {};
  return (
    <>
      <MultiCheckList
        label="Units"
        allLabel="All Units"
        items={(options.units || []).filter(isRealUnit).map((unit) => ({ id: unit.id, name: unit.name }))}
        selection={state.units}
        error={errors.units}
      />
      {employeesOnly ? (
        <>
          <MultiCheckList
            label="Job Positions"
            allLabel="All Positions"
            items={(options.jobPositions || []).map((item) => ({ id: item.id, name: item.name }))}
            selection={state.positions}
            hint="Only applies to employees."
            error={errors.positions}
          />
          <MultiCheckList
            label="Job Levels"
            allLabel="All Levels"
            items={(options.jobLevels || []).map((item) => ({ id: item.id, name: item.name }))}
            selection={state.levels}
            hint="Only applies to employees."
            error={errors.levels}
          />
        </>
      ) : null}
    </>
  );
}
