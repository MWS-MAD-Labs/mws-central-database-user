// Date ranges for filters that work on whole days, shared by Audit Logs and the activity lists.
export function toDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const MAX_DATE_RANGE_DAYS = 30;

export function shiftDate(dateOnlyString, days) {
  const date = new Date(`${dateOnlyString}T00:00:00.000`);
  date.setDate(date.getDate() + days);
  return toDateOnly(date);
}

export function todayDateOnly() {
  return toDateOnly(new Date());
}

export function minDateOnly(a, b) {
  return a < b ? a : b;
}

function startOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  result.setDate(result.getDate() + diff);
  return result;
}

export const DATE_RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "custom", label: "Custom Range" },
];

export function defaultDateRange() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - MAX_DATE_RANGE_DAYS);
  return { date_from: toDateOnly(start), date_to: toDateOnly(now) };
}

export function computeDateRange(preset) {
  const now = new Date();
  const today = toDateOnly(now);
  switch (preset) {
    case "today":
      return { date_from: today, date_to: today };
    case "this_week": {
      const start = startOfWeek(now);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return {
        date_from: toDateOnly(start),
        date_to: minDateOnly(toDateOnly(end), today),
      };
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return {
        date_from: toDateOnly(start),
        date_to: minDateOnly(toDateOnly(end), today),
      };
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { date_from: toDateOnly(start), date_to: toDateOnly(end) };
    }
    default:
      return { date_from: "", date_to: "" };
  }
}
