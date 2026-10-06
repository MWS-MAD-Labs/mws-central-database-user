import { useMemo, useState } from "react";
import { hasRemoved } from "./scopeRules.js";

export const audienceLabels = {
  EMPLOYEES: "All Active Employees",
  STUDENTS: "All Active Students",
  EMPLOYEES_AND_STUDENTS: "All Active Employees and Students",
};

const toSelection = (ids = []) => (ids.length > 0 ? ids : null);

// The unit, position and level picks of a group. `rules` (from the scope catalog) makes the
// three follow each other: dropping a value also drops what only existed because of it.
// What the last change dropped is in `removed`; `allowed` says what is still worth offering.
export function useGroupFilterState(initial = {}, rules = null) {
  const [picked, setPicked] = useState({
    units: toSelection(initial.unit_ids),
    positions: toSelection(initial.job_position_ids),
    levels: toSelection(initial.job_level_ids),
  });
  const [removed, setRemoved] = useState(null);

  // Older groups may hold values nothing supports. They are left out as soon as the rules load.
  const settled = useMemo(() => (rules ? rules.settle(picked).selection : picked), [rules, picked]);
  const allowed = useMemo(() => (rules ? rules.allowedValues(settled) : null), [rules, settled]);

  function change(dimension, next, options) {
    const base = { ...settled, [dimension]: next };
    const result = rules ? rules.settle(base, dimension, options) : { selection: base, removed: null };
    setPicked(result.selection);
    setRemoved(result.removed && hasRemoved(result.removed) ? result.removed : null);
  }

  return {
    units: { selected: settled.units, setSelected: (next, options) => change("units", next, options) },
    positions: { selected: settled.positions, setSelected: (next, options) => change("positions", next, options) },
    levels: { selected: settled.levels, setSelected: (next, options) => change("levels", next, options) },
    allowed,
    removed,
  };
}

const selectionIds = (selection) => selection.selected ?? [];
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

// What is sent to the server. Units the picker does not offer (Unknown / Legacy) are left out.
export function groupFilterPayload(state, audience, knownUnitIds) {
  const employeesOnly = audience !== "STUDENTS";
  const units = selectionIds(state.units);
  return {
    unit_ids: knownUnitIds ? units.filter((id) => knownUnitIds.has(id)) : units,
    job_position_ids: employeesOnly ? selectionIds(state.positions) : [],
    job_level_ids: employeesOnly ? selectionIds(state.levels) : [],
  };
}
