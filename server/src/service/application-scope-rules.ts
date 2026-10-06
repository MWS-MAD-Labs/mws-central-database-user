import { prismaClient } from "../lib/prisma";
import { jobPositionAndJobLevelAreCompatible } from "../utils/employee-role-rules";
import { UNKNOWN_LEGACY_UNIT_NAME } from "../utils/legacy-unit";

export type Named = { id: string; name: string };

export type ScopeLists = {
  unit_ids: string[];
  job_position_ids: string[];
  job_level_ids: string[];
};

export type ScopeCatalog = {
  units: Named[];
  positions: (Named & { teaching: boolean; unit_ids: string[] })[];
  levels: (Named & { teaching: boolean; unit_ids: string[] })[];
};

export type Combo = { unit: string; position: string; level: string };

export async function loadScopeCatalog(): Promise<ScopeCatalog> {
  const [units, positions, levels] = await Promise.all([
    prismaClient.masterUnit.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prismaClient.masterJobPosition.findMany({
      select: { id: true, name: true, is_teaching_position: true, units: { select: { unit_id: true } } },
      orderBy: { name: "asc" },
    }),
    prismaClient.masterJobLevel.findMany({
      select: { id: true, name: true, is_teaching_role: true, units: { select: { unit_id: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    units: units.filter((unit) => unit.name !== UNKNOWN_LEGACY_UNIT_NAME),
    positions: positions.map((item) => ({
      id: item.id,
      name: item.name,
      teaching: item.is_teaching_position,
      unit_ids: item.units.map((row) => row.unit_id),
    })),
    levels: levels.map((item) => ({
      id: item.id,
      name: item.name,
      teaching: item.is_teaching_role,
      unit_ids: item.units.map((row) => row.unit_id),
    })),
  };
}

// Whether a position and a level may go together.
export function scopePairFits(
  position: { name: string; teaching: boolean },
  level: { name: string; teaching: boolean },
): boolean {
  return jobPositionAndJobLevelAreCompatible(position.name, position.teaching, level.name, level.teaching);
}

// Which (unit, position, level) triples can hold an employee, by the master data
// rules: a position or level limited to units, and position with level matching.
export function buildFeasibility(catalog: ScopeCatalog) {
  const pairOk = new Map<string, boolean>();
  for (const position of catalog.positions) {
    for (const level of catalog.levels) {
      pairOk.set(`${position.id}|${level.id}`, scopePairFits(position, level));
    }
  }
  const allowed = (unitIds: string[], unit: string) => unitIds.length === 0 || unitIds.includes(unit);

  // Feasible combos of a scope. An empty list means every value.
  function combos(scope: ScopeLists): Combo[] {
    const units = scope.unit_ids.length
      ? catalog.units.filter((unit) => scope.unit_ids.includes(unit.id))
      : catalog.units;
    const positions = scope.job_position_ids.length
      ? catalog.positions.filter((item) => scope.job_position_ids.includes(item.id))
      : catalog.positions;
    const levels = scope.job_level_ids.length
      ? catalog.levels.filter((item) => scope.job_level_ids.includes(item.id))
      : catalog.levels;
    const result: Combo[] = [];
    for (const unit of units) {
      for (const position of positions) {
        if (!allowed(position.unit_ids, unit.id)) continue;
        for (const level of levels) {
          if (!allowed(level.unit_ids, unit.id)) continue;
          if (!pairOk.get(`${position.id}|${level.id}`)) continue;
          result.push({ unit: unit.id, position: position.id, level: level.id });
        }
      }
    }
    return result;
  }

  return { combos };
}

export type Feasibility = ReturnType<typeof buildFeasibility>;

export function projection(combos: Combo[]) {
  return {
    units: new Set(combos.map((item) => item.unit)),
    positions: new Set(combos.map((item) => item.position)),
    levels: new Set(combos.map((item) => item.level)),
  };
}

export const comboKey = (item: Combo) => `${item.unit}|${item.position}|${item.level}`;
