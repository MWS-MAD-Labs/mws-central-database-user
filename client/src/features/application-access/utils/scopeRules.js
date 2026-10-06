// What fits together in a group scope, worked out from the master data catalog the
// server sends: positions and levels exist in some units, and a position pairs with
// some levels. A selection is { units, positions, levels }, each null (All) or ids.

const DIMENSIONS = ["units", "positions", "levels"];

export function buildScopeRules(catalog) {
  const pairs = new Map(Object.entries(catalog.pairs).map(([id, levels]) => [id, new Set(levels)]));
  const allowedIn = (unitIds, unit) => unitIds.length === 0 || unitIds.includes(unit);

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

  // For each dimension, the values that still hold someone given the other two.
  function allowedValues(selection) {
    const result = {};
    for (const dimension of DIMENSIONS) {
      result[dimension] = project(combos({ ...selection, [dimension]: null }))[dimension];
    }
    return result;
  }

  // Drops picked values that nothing supports any more, and the ones that depended on
  // those. All is never touched. Says what was dropped per dimension.
  // `changed` is the dimension the user just edited. It stays as picked, and the others
  // are trimmed to fit it, one hop at a time, so that leaving out a unit drops positions
  // but not the other way round. Without it (loading an old group) everything is trimmed.
  function settle(selection, changed = null, { wipe = true } = {}) {
    const current = { ...selection };
    const removed = { units: [], positions: [], levels: [] };
    const trim = (dimension, kept) => {
      removed[dimension].push(...current[dimension].filter((id) => !kept.includes(id)));
      current[dimension] = kept;
    };

    // Unchecking the last value of the edited dimension leaves it supporting nothing,
    // so what was picked in the others has nothing to stand on. (Switching All off is
    // only the start of picking, and keeps them.)
    if (changed && wipe && current[changed] && current[changed].length === 0) {
      for (const dimension of DIMENSIONS) {
        const ids = current[dimension];
        if (dimension !== changed && ids && ids.length > 0) trim(dimension, []);
      }
      return { selection: current, removed };
    }

    if (changed) {
      const queue = [changed];
      while (queue.length > 0) {
        const source = queue.shift();
        for (const dimension of DIMENSIONS) {
          const ids = current[dimension];
          if (dimension === source || dimension === changed || !ids || ids.length === 0) continue;
          // Pairwise: what the source and this dimension allow together, the third left open.
          const third = DIMENSIONS.find((item) => item !== source && item !== dimension);
          const used = project(combos({ ...current, [third]: null }))[dimension];
          const kept = ids.filter((id) => used.has(id));
          if (kept.length === ids.length) continue;
          trim(dimension, kept);
          queue.push(dimension);
        }
      }
    }

    for (let round = 0; round < 4; round += 1) {
      const used = project(combos(current));
      let trimmed = false;
      for (const dimension of DIMENSIONS) {
        const ids = current[dimension];
        if (dimension === changed || !ids || ids.length === 0) continue;
        const kept = ids.filter((id) => used[dimension].has(id));
        if (kept.length === ids.length) continue;
        trim(dimension, kept);
        trimmed = true;
      }
      if (!trimmed) break;
    }
    return { selection: current, removed };
  }

  return { combos, allowedValues, settle };
}

export const hasRemoved = (removed) => DIMENSIONS.some((dimension) => removed[dimension].length > 0);
