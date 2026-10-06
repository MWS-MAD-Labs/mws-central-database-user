import { audienceLabels } from "./groupFilterState.js";
import { UNKNOWN_LEGACY_UNIT_NAME } from "./legacyUnit.js";

// Plain text for where a group reaches, from the card the server returns.
export function groupScopeSummary(group) {
  const parts = [
    group.units.length ? `Units: ${group.units.map((item) => item.name).join(", ")}` : "All Units",
  ];
  if (group.audience !== "STUDENTS") {
    parts.push(
      group.job_positions.length
        ? `Positions: ${group.job_positions.map((item) => item.name).join(", ")}`
        : "All Positions",
    );
    parts.push(
      group.job_levels.length
        ? `Levels: ${group.job_levels.map((item) => item.name).join(", ")}`
        : "All Levels",
    );
  }
  return parts.join(" · ");
}

// The scope as label, plural noun and names. No names means "All".
export function groupScopeChips(group) {
  const chips = [{ label: "Units", noun: "units", names: group.units.map((item) => item.name).filter((name) => name !== UNKNOWN_LEGACY_UNIT_NAME) }];
  if (group.audience !== "STUDENTS") {
    chips.push(
      { label: "Positions", noun: "positions", names: group.job_positions.map((item) => item.name) },
      { label: "Levels", noun: "levels", names: group.job_levels.map((item) => item.name) },
    );
  }
  return chips;
}

// A few words for a row: counts instead of names, All when nothing is picked.
export function groupScopeBrief(group) {
  const part = (names, noun, all) => {
    if (names.length === 0) return all;
    if (names.length === 1) return names[0];
    return `${names.length} ${noun}`;
  };
  const chips = groupScopeChips(group);
  const labels = { Units: "All Units", Positions: "All Positions", Levels: "All Levels" };
  return chips.map((chip) => part(chip.names, chip.noun === "units" ? "Units" : chip.noun === "positions" ? "Positions" : "Levels", labels[chip.label])).join(" · ");
}

export function groupTitle(group) {
  return audienceLabels[group.audience];
}

// Permissions grouped by the part before the first dot, for reading.
export function groupPermissions(permissions) {
  const areas = new Map();
  for (const permission of [...permissions].sort()) {
    const area = permission.includes(".") ? permission.split(".")[0] : "other";
    areas.set(area, [...(areas.get(area) || []), permission]);
  }
  return [...areas].map(([area, items]) => ({ area, items }));
}

// Same name without the leading "All", for headings next to the scope.
export function groupShortTitle(group) {
  return groupTitle(group).replace(/^All /, "");
}

const audienceNoun = {
  EMPLOYEES: ["Employee", "Employees"],
  STUDENTS: ["Student", "Students"],
  EMPLOYEES_AND_STUDENTS: ["Person", "People"],
};

// "3 Employees", "1 Student".
export function countOf(count, audience) {
  const [one, many] = audienceNoun[audience];
  return `${count} ${count === 1 ? one : many}`;
}


