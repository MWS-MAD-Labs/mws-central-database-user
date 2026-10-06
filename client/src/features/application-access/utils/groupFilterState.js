import { selectionIds, useMultiSelect } from "./multiSelect.js";

export const audienceLabels = {
  EMPLOYEES: "All Active Employees",
  STUDENTS: "All Active Students",
  EMPLOYEES_AND_STUDENTS: "All Active Employees and Students",
};

export function useGroupFilterState(initial = {}) {
  return {
    units: useMultiSelect(initial.unit_ids || []),
    positions: useMultiSelect(initial.job_position_ids || []),
    levels: useMultiSelect(initial.job_level_ids || []),
  };
}

const isNone = (selection) => selection.selected !== null && selection.selected.length === 0;

// Nothing may end up unchecked: "none" is not a valid filter.
export function groupFilterErrors(state, audience) {
  const employeesOnly = audience !== "STUDENTS";
  return {
    units: isNone(state.units) ? "Pick at least one unit, or choose All Units." : undefined,
    positions:
      employeesOnly && isNone(state.positions)
        ? "Pick at least one job position, or choose All Positions."
        : undefined,
    levels:
      employeesOnly && isNone(state.levels)
        ? "Pick at least one job level, or choose All Levels."
        : undefined,
  };
}

export function hasGroupFilterError(state, audience) {
  return Object.values(groupFilterErrors(state, audience)).some(Boolean);
}

export function groupFilterPayload(state, audience, knownUnitIds) {
  const employeesOnly = audience !== "STUDENTS";
  // Units the picker does not offer (Unknown / Legacy from older groups) are dropped.
  const units = selectionIds(state.units);
  return {
    unit_ids: knownUnitIds ? units.filter((id) => knownUnitIds.has(id)) : units,
    job_position_ids: employeesOnly ? selectionIds(state.positions) : [],
    job_level_ids: employeesOnly ? selectionIds(state.levels) : [],
  };
}
