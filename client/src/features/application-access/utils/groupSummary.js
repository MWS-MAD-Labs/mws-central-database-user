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

export function groupTitle(group) {
  return audienceLabels[group.audience];
}
