import { formatDate } from "../../../lib/format.js";

export function humanizeAssignmentDuration(startDate, endDate) {
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();
  const days = Math.max(
    1,
    Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
  );

  if (days < 30) return `${days} Day${days === 1 ? "" : "s"}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} Month${months === 1 ? "" : "s"}`;
  const years = Math.floor(days / 365);
  return `${years} Year${years === 1 ? "" : "s"}`;
}

export function assignmentDuration(startDate, endDate) {
  if (!startDate) return "-";
  if (endDate) return `${formatDate(startDate)} - ${formatDate(endDate)}`;
  return `Since ${formatDate(startDate)}`;
}
