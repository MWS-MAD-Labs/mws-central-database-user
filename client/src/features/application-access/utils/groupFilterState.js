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

// Picked values that cannot hold anyone given the other dimensions.
const isDead = (selection, allowedIds) =>
  Boolean(allowedIds) && selection.selected !== null && selection.selected.some((id) => !allowedIds.has(id));
const deadCount = (selection, allowedIds) =>
  allowedIds && selection.selected !== null ? selection.selected.filter((id) => !allowedIds.has(id)).length : 0;
const allDead = (selection, allowedIds) =>
  Boolean(allowedIds) &&
  selection.selected !== null &&
  selection.selected.length > 0 &&
  selection.selected.every((id) => !allowedIds.has(id));

export { deadCount, isDead };

// Nothing may end up unchecked: "none" is not a valid filter. `allowed` is what the server
// says can still hold someone ({ units, job_positions, job_levels } as Sets), when known.
export function groupFilterErrors(state, audience, allowed) {
  const employeesOnly = audience !== "STUDENTS";
  return {
    units:
      isNone(state.units)
        ? "Pick at least one unit, or choose All Units."
        : employeesOnly && allDead(state.units, allowed?.units)
          ? "None of the picked units fit the chosen positions and levels. Pick again, or choose All Units."
          : undefined,
    positions:
      employeesOnly && isNone(state.positions)
        ? "Pick at least one job position, or choose All Positions."
        : employeesOnly && allDead(state.positions, allowed?.job_positions)
          ? "None of the picked positions fit the chosen units and levels. Pick again, or choose All Positions."
          : undefined,
    levels:
      employeesOnly && isNone(state.levels)
        ? "Pick at least one job level, or choose All Levels."
        : employeesOnly && allDead(state.levels, allowed?.job_levels)
          ? "None of the picked levels fit the chosen units and positions. Pick again, or choose All Levels."
          : undefined,
  };
}

export function hasGroupFilterError(state, audience, allowed) {
  return Object.values(groupFilterErrors(state, audience, allowed)).some(Boolean);
}

// What is sent to the server. Units the picker does not offer (Unknown / Legacy) and
// values that cannot hold anyone given the others are left out.
export function groupFilterPayload(state, audience, knownUnitIds, allowed) {
  const employeesOnly = audience !== "STUDENTS";
  const keep = (ids, ...sets) => ids.filter((id) => sets.every((set) => !set || set.has(id)));
  return {
    unit_ids: keep(selectionIds(state.units), knownUnitIds, employeesOnly ? allowed?.units : undefined),
    job_position_ids: employeesOnly ? keep(selectionIds(state.positions), allowed?.job_positions) : [],
    job_level_ids: employeesOnly ? keep(selectionIds(state.levels), allowed?.job_levels) : [],
  };
}
