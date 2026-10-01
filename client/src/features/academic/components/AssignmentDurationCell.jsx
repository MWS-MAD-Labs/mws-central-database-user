import {
  assignmentDuration,
  humanizeAssignmentDuration,
} from "../utils/assignmentDuration.js";

// Humanized length on top, date range underneath. Optional extra line below.
// `compact` keeps it to one line: the range shows, the length sits in the tooltip.
export function AssignmentDurationCell({ startDate, endDate, compact = false, children }) {
  if (compact) {
    return (
      <span
        className="whitespace-nowrap text-(--mws-charcoal)"
        title={humanizeAssignmentDuration(startDate, endDate)}
      >
        {assignmentDuration(startDate, endDate)}
      </span>
    );
  }
  return (
    <>
      <p className="font-medium text-(--mws-charcoal)">
        {humanizeAssignmentDuration(startDate, endDate)}
      </p>
      <p className="mt-0.5 text-xs text-(--mws-muted)">
        {assignmentDuration(startDate, endDate)}
      </p>
      {children}
    </>
  );
}
