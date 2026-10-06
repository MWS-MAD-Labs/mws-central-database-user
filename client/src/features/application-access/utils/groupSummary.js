import { audienceLabels } from "./groupFilterState.js";

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
  const chips = [{ label: "Units", noun: "units", names: group.units.map((item) => item.name) }];
  if (group.audience !== "STUDENTS") {
    chips.push(
      { label: "Positions", noun: "positions", names: group.job_positions.map((item) => item.name) },
      { label: "Levels", noun: "levels", names: group.job_levels.map((item) => item.name) },
    );
  }
  return chips;
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


