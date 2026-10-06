// What fits together in a group scope, worked out from the master data catalog the
// server sends: positions and levels exist in some units, and a position pairs with
// some levels. A selection is { units, positions, levels }, each null (All) or ids.

const DIMENSIONS = ["units", "positions", "levels"];

export function buildScopeRules(catalog) {
  const pairs = new Map(Object.entries(catalog.pairs).map(([id, levels]) => [id, new Set(levels)]));
  const allowedIn = (unitIds, unit) => unitIds.length === 0 || unitIds.includes(unit);
  const selectedItems = (list, ids) => (ids === null ? list : list.filter((item) => ids.includes(item.id)));
  const unitNames = new Map(catalog.units.map((unit) => [unit.id, unit.name]));

  // The (unit, position, level) triples that can hold an employee, inside a selection.
  // null or an empty list means every value of that dimension.
  function combos(selection) {
    const only = (list, ids) => (ids && ids.length ? list.filter((item) => ids.includes(item.id)) : list);
    const units = only(catalog.units, selection.units);
    const positions = only(catalog.job_positions, selection.positions);
    const levels = only(catalog.job_levels, selection.levels);
    const result = [];
    for (const unit of units) {
      for (const position of positions) {
        if (!allowedIn(position.unit_ids, unit.id)) continue;
        const fits = pairs.get(position.id);
        for (const level of levels) {
          if (!fits?.has(level.id) || !allowedIn(level.unit_ids, unit.id)) continue;
          result.push({ units: unit.id, positions: position.id, levels: level.id });
        }
      }
    }
    return result;
  }

  const project = (list) => ({
    units: new Set(list.map((item) => item.units)),
    positions: new Set(list.map((item) => item.positions)),
    levels: new Set(list.map((item) => item.levels)),
  });

  // Scope flows one way: units limit levels, then units and levels limit positions.
  function allowedValues(selection) {
    const units = new Set(catalog.units.map((unit) => unit.id));
    const levels = project(combos({ units: selection.units, positions: null, levels: null })).levels;
    const positions = project(combos({
      units: selection.units,
      levels: selection.levels,
      positions: null,
    })).positions;
    return { units, levels, positions };
  }

  function availability(selection) {
    const allowed = allowedValues(selection);
    const units = selectedItems(catalog.units, selection.units);
    const levels = selectedItems(catalog.job_levels, selection.levels);
    const requiredUnits = (unitIds) => ({
      kind: "units",
      names: unitIds.map((id) => unitNames.get(id)).filter(Boolean),
    });

    return {
      levels: new Map(catalog.job_levels.map((level) => {
        if (allowed.levels.has(level.id)) return [level.id, null];
        const hasUnit = units.some((unit) => allowedIn(level.unit_ids, unit.id));
        return [level.id, hasUnit ? { kind: "no-positions" } : requiredUnits(level.unit_ids)];
      })),
      positions: new Map(catalog.job_positions.map((position) => {
        if (allowed.positions.has(position.id)) return [position.id, null];
        const hasUnit = units.some((unit) => allowedIn(position.unit_ids, unit.id));
        if (!hasUnit) return [position.id, requiredUnits(position.unit_ids)];
        const compatibleLevels = pairs.get(position.id) || new Set();
        const hasSelectedLevel = levels.some((level) => compatibleLevels.has(level.id));
        return [
          position.id,
          { kind: hasSelectedLevel ? "scope" : "level" },
        ];
      })),
    };
  }

  // Parent changes trim invalid descendants. Descendant changes never alter their parents.
  function settle(selection, changed = null, { wipe = true } = {}) {
    const current = { ...selection };
    const removed = { units: [], positions: [], levels: [] };
    const trim = (dimension, kept) => {
      removed[dimension].push(...current[dimension].filter((id) => !kept.includes(id)));
      current[dimension] = kept;
    };

    if (changed === "units" && wipe && current.units?.length === 0) {
      if (current.levels?.length) trim("levels", []);
      if (current.positions?.length) trim("positions", []);
      return { selection: current, removed };
    }
    if (changed === "levels" && wipe && current.levels?.length === 0) {
      if (current.positions?.length) trim("positions", []);
      return { selection: current, removed };
    }

    if (changed === null || changed === "units") {
      const allowedLevels = allowedValues(current).levels;
      if (current.levels?.length) {
        trim("levels", current.levels.filter((id) => allowedLevels.has(id)));
      }
    }

    if (changed === null || changed === "units" || changed === "levels") {
      const allowedPositions = allowedValues(current).positions;
      if (current.positions?.length) {
        trim("positions", current.positions.filter((id) => allowedPositions.has(id)));
      }
    }

    return { selection: current, removed };
  }

  // Picked units and levels that nothing in the rest of the scope can exist in. They never
  // change by themselves when something below them is picked, so they are pointed out
  // instead. Positions cannot end up here: they are always trimmed to what fits above them.
  const levelNames = new Map(catalog.job_levels.map((level) => [level.id, level.name]));
  function unsupported(selection) {
    const used = project(combos(selection));
    const dead = (ids, set, names) =>
      !ids || ids.length === 0
        ? []
        : ids.filter((id) => !set.has(id)).map((id) => ({ id, name: names.get(id) || id }));
    const units = dead(selection.units, used.units, unitNames);
    const levels = dead(selection.levels, used.levels, levelNames);
    return {
      units,
      levels,
      all: [
        ...units.map((item) => ({ ...item, kind: "units" })),
        ...levels.map((item) => ({ ...item, kind: "levels" })),
      ],
    };
  }

  // Students only exist in units that have grades.
  const studentUnitIds = new Set(catalog.student_unit_ids || []);
  const studentUnits = catalog.units.filter((unit) => studentUnitIds.has(unit.id));

  return { combos, allowedValues, availability, settle, unsupported, studentUnits, studentUnitIds };
}

export const hasRemoved = (removed) => DIMENSIONS.some((dimension) => removed[dimension].length > 0);
