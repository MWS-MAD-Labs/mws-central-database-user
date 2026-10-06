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

// The same scope as separate label and value pairs, for chips.
export function groupScopeChips(group) {
  const chips = [
    { label: "Units", value: group.units.length ? group.units.map((item) => item.name).join(", ") : "All" },
  ];
  if (group.audience !== "STUDENTS") {
    chips.push(
      { label: "Positions", value: group.job_positions.length ? group.job_positions.map((item) => item.name).join(", ") : "All" },
      { label: "Levels", value: group.job_levels.length ? group.job_levels.map((item) => item.name).join(", ") : "All" },
    );
  }
  return chips;
}

export function groupTitle(group) {
  return audienceLabels[group.audience];
}
