import { DateField, FilterSelect } from "./FormControls.jsx";
import {
  DATE_RANGE_OPTIONS,
  MAX_DATE_RANGE_DAYS,
  computeDateRange,
  defaultDateRange,
  minDateOnly,
  shiftDate,
  todayDateOnly,
} from "../../lib/dateRange.js";

// A preset or a custom From and To, the same as on Audit Logs. `value` is { preset, date_from, date_to }.
export function DateRangeFilter({ value, onChange }) {
  const custom = value.preset === "custom";
  return (
    <div className="flex min-w-0 flex-wrap items-end gap-3">
      <div className="w-44 max-w-full">
        <FilterSelect
          label="Date Range"
          value={value.preset}
          onChange={(preset) => onChange({ preset, ...(preset === "custom" ? defaultDateRange() : computeDateRange(preset)) })}
          options={DATE_RANGE_OPTIONS}
        />
      </div>
      {custom ? (
        <>
          <div className="flex min-w-[9rem] flex-col gap-1.5">
            <span className="block font-display text-xs font-bold text-(--mws-muted)">From</span>
            <DateField
              value={value.date_from}
              min={value.date_to ? shiftDate(value.date_to, -MAX_DATE_RANGE_DAYS) : undefined}
              max={value.date_to || todayDateOnly()}
              onChange={(event) => onChange({ ...value, date_from: event.target.value })}
            />
          </div>
          <div className="flex min-w-[9rem] flex-col gap-1.5">
            <span className="block font-display text-xs font-bold text-(--mws-muted)">To</span>
            <DateField
              value={value.date_to}
              min={value.date_from || undefined}
              max={value.date_from ? minDateOnly(shiftDate(value.date_from, MAX_DATE_RANGE_DAYS), todayDateOnly()) : todayDateOnly()}
              onChange={(event) => onChange({ ...value, date_to: event.target.value })}
            />
          </div>
          <p className="w-full text-xs text-(--mws-muted)">Custom Range is limited to {MAX_DATE_RANGE_DAYS} days.</p>
        </>
      ) : null}
    </div>
  );
}
