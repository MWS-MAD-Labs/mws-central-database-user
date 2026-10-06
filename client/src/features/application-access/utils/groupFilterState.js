import { useMemo, useState } from "react";
import { hasRemoved } from "./scopeRules.js";

export const audienceLabels = {
  EMPLOYEES: "All Active Employees",
  STUDENTS: "All Active Students",
  EMPLOYEES_AND_STUDENTS: "All Active Employees and Students",
};

const toSelection = (ids = []) => (ids.length > 0 ? ids : null);

// Group scope follows Unit -> Job Level -> Job Position. Parent changes trim invalid
// descendants, while descendant changes never alter their parents.
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
  const availability = useMemo(() => (rules ? rules.availability(settled) : null), [rules, settled]);
  const unsupported = useMemo(
    () => (rules ? rules.unsupported(settled) : { units: [], levels: [], all: [] }),
    [rules, settled],
  );

  function change(dimension, next, options) {
    const base = { ...settled, [dimension]: next };
    const result = rules ? rules.settle(base, dimension, options) : { selection: base, removed: null };
    setPicked(result.selection);
    setRemoved(result.removed && hasRemoved(result.removed) ? result.removed : null);
  }

  // Drops several picks at once (units and levels), so one does not overwrite the other.
  function dropPicks(picks) {
    const without = (ids, drop) => (ids ? ids.filter((id) => !drop.includes(id)) : ids);
    const base = {
      ...settled,
      units: without(settled.units, picks.units || []),
      levels: without(settled.levels, picks.levels || []),
    };
    const result = rules ? rules.settle(base, "units", { wipe: false }) : { selection: base, removed: null };
    setPicked(result.selection);
    setRemoved(result.removed && hasRemoved(result.removed) ? result.removed : null);
  }

  return {
    units: { selected: settled.units, setSelected: (next, options) => change("units", next, options) },
    positions: { selected: settled.positions, setSelected: (next, options) => change("positions", next, options) },
    levels: { selected: settled.levels, setSelected: (next, options) => change("levels", next, options) },
    allowed,
    availability,
    unsupported,
    dropPicks,
    removed,
  };
}

const selectionIds = (selection) => selection.selected ?? [];
// Picked ids the picker no longer offers (Unknown / Legacy): leaving them out of a list that
// had only those would turn it into All, so it is an error instead.
const noneUsable = (selection, knownIds) =>
  Boolean(knownIds) &&
  selection.selected !== null &&
  selection.selected.length > 0 &&
  selection.selected.every((id) => !knownIds.has(id));

const isNone = (selection) => selection.selected !== null && selection.selected.length === 0;

const names = (list) => list.map((item) => item.name).join(", ");

// Nothing may end up unchecked: "none" is not a valid filter.
export function groupFilterErrors(state, audience, knownUnitIds) {
  const employeesOnly = audience !== "STUDENTS";
  return {
    units: isNone(state.units)
      ? "Pick at least one unit, or choose All Units."
      : noneUsable(state.units, knownUnitIds)
        ? "None of the picked units can be used. Pick other units, or choose All Units."
        : employeesOnly && state.unsupported?.units?.length > 0
          ? `${names(state.unsupported.units)} ${state.unsupported.units.length === 1 ? "has" : "have"} no matching job level or position in this scope. Remove ${state.unsupported.units.length === 1 ? "it" : "them"} or change the levels.`
          : undefined,
    positions:
      employeesOnly && isNone(state.positions)
        ? "Pick at least one job position, or choose All Positions."
        : undefined,
    levels:
      employeesOnly && isNone(state.levels)
        ? "Pick at least one job level, or choose All Levels."
        : employeesOnly && state.unsupported?.levels?.length > 0
          ? `${names(state.unsupported.levels)} ${state.unsupported.levels.length === 1 ? "has" : "have"} no matching unit or position in this scope. Remove ${state.unsupported.levels.length === 1 ? "it" : "them"} or change the units.`
          : undefined,
  };
}

export function hasGroupFilterError(state, audience, knownUnitIds) {
  return Object.values(groupFilterErrors(state, audience, knownUnitIds)).some(Boolean);
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
