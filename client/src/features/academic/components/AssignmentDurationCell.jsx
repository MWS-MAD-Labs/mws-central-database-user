import {
  assignmentDuration,
  humanizeAssignmentDuration,
} from "../utils/assignmentDuration.js";

// Humanized length on top, date range underneath. Optional extra line below.
export function AssignmentDurationCell({ startDate, endDate, children }) {
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
