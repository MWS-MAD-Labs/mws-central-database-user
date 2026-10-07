import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  DateField,
  DebouncedSearchInput,
  FilterSelect,
} from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { SortableHeader } from "../../../components/ui/SortableHeader.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { LiveIndicator } from "../../../components/ui/LiveIndicator.jsx";
import { FilterResetButton } from "../../../components/ui/FilterResetButton.jsx";
import {
  formatDateTime,
  formatDiffValue,
  formatStatus,
} from "../../../lib/format.js";
import {
  auditActions,
  auditLogsApi,
  auditSources,
} from "../api/auditLogsApi.js";

export function AuditLogsPage() {
  const [selectedLog, setSelectedLog] = useState(null);
  const [dateRangePreset, setDateRangePreset] = useState("this_week");
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    search: "",
    action: "",
    source: "",
    entity_type: "",
    ...computeDateRange("this_week"),
    sort_by: "created_at",
    sort_order: "desc",
  });

  const queryParams = useMemo(
    () => ({
      ...params,
      date_from: params.date_from
        ? `${params.date_from}T00:00:00.000`
        : undefined,
      date_to: params.date_to ? `${params.date_to}T23:59:59.999` : undefined,
    }),
    [params],
  );
  const logsQuery = useQuery({
    queryKey: ["audit-logs", queryParams],
    queryFn: () => auditLogsApi.list(queryParams),
  });
  const paging = logsQuery.data?.paging || {
    current_page: params.page,
    total_page: 1,
    total_item: 0,
    size: params.size,
  };

  const displayRows = useMemo(() => {
    const rows = logsQuery.data?.data || [];
    const PAIR_WINDOW_MS = 5000;
    const consumed = new Set();
    const result = [];

    for (let i = 0; i < rows.length; i++) {
      if (consumed.has(i)) continue;
      const row = rows[i];
      const isLookupRow =
        row.action === "API_ACCESS" &&
        (row.entity_type === "Student" || row.entity_type === "Employee") &&
        row.api_client?.id &&
        row.new_values?.requested_email;

      const pairIndex = isLookupRow
        ? rows.findIndex((candidate, j) => {
            if (j === i || consumed.has(j)) return false;
            return (
              candidate.action === "API_ACCESS" &&
              candidate.api_client?.id === row.api_client.id &&
              candidate.new_values?.requested_email ===
                row.new_values.requested_email &&
              candidate.entity_type &&
              candidate.entity_type !== row.entity_type &&
              Math.abs(
                new Date(candidate.created_at).getTime() -
                  new Date(row.created_at).getTime(),
              ) <= PAIR_WINDOW_MS
            );
          })
        : -1;

      if (pairIndex !== -1) {
        consumed.add(i);
        consumed.add(pairIndex);
        const pair = rows[pairIndex];
        const primary = row.new_values?.found
          ? row
          : pair.new_values?.found
            ? pair
            : row;
        const secondary = primary === row ? pair : row;
        result.push({ ...primary, pairedWith: secondary });
        continue;
      }

      result.push(row);
    }

    return result;
  }, [logsQuery.data]);

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }));
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 });
  }
  const hasActiveFilters = Boolean(
    params.search ||
    params.action ||
    params.source ||
    params.entity_type ||
    dateRangePreset !== "this_week",
  );

  function resetFilters() {
    setDateRangePreset("this_week");
    setParams((current) => ({
      ...current,
      page: 1,
      search: "",
      action: "",
      source: "",
      entity_type: "",
      ...computeDateRange("this_week"),
    }));
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="Audit Logs"
        description="Review admin, API, sensitive-data, and data-change activity."
      />

      <section className="min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <div className="flex min-w-0 flex-col gap-3 border-b border-(--mws-line) p-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 xl:max-w-lg">
            <DebouncedSearchInput
              value={params.search}
              placeholder="Search Actor, API Client, Or Entity ID"
              className="min-w-0 flex-1"
              onChange={(search) => resetPageAndUpdate({ search })}
            />
            <LiveIndicator isSyncing={logsQuery.isFetching} />
            <FilterResetButton
              visible={hasActiveFilters}
              onReset={resetFilters}
            />
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:flex xl:flex-wrap xl:items-end xl:justify-end xl:gap-2">
            <FilterSelect
              label="Action"
              value={params.action}
              onChange={(value) => resetPageAndUpdate({ action: value })}
              options={[
                { value: "", label: "All Actions" },
                ...enumOptions(auditActions),
              ]}
            />
            <FilterSelect
              label="Source"
              value={params.source}
              onChange={(value) => resetPageAndUpdate({ source: value })}
              options={[
                { value: "", label: "All Sources" },
                ...enumOptions(auditSources),
              ]}
            />
            <FilterSelect
              label="Entity"
              value={params.entity_type}
              onChange={(value) => resetPageAndUpdate({ entity_type: value })}
              options={[
                { value: "", label: "All Entities" },
                { value: "Student", label: "Student" },
                { value: "Employee", label: "Employee" },
                { value: "ConsentRecord", label: "Consent" },
                { value: "HealthRecord", label: "Health Record" },
                { value: "HealthNote", label: "Health Note" },
                { value: "ApiClient", label: "API Client" },
              ]}
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-end gap-3 border-b border-(--mws-line) p-4">
          <FilterSelect
            label="Date Range"
            value={dateRangePreset}
            onChange={(value) => {
              setDateRangePreset(value);
              resetPageAndUpdate(
                value === "custom"
                  ? defaultDateRange()
                  : computeDateRange(value),
              );
            }}
            options={DATE_RANGE_OPTIONS}
          />
          {dateRangePreset === "custom" ? (
            <>
              <div className="flex min-w-[9rem] flex-col gap-1.5">
                <span className="block font-display text-xs font-bold text-(--mws-muted)">
                  From
                </span>
                <DateField
                  value={params.date_from}
                  min={
                    params.date_to
                      ? shiftDate(params.date_to, -MAX_DATE_RANGE_DAYS)
                      : undefined
                  }
                  max={params.date_to || todayDateOnly()}
                  onChange={(event) =>
                    resetPageAndUpdate({ date_from: event.target.value })
                  }
                />
              </div>
              <div className="flex min-w-[9rem] flex-col gap-1.5">
                <span className="block font-display text-xs font-bold text-(--mws-muted)">
                  To
                </span>
                <DateField
                  value={params.date_to}
                  min={params.date_from || undefined}
                  max={
                    params.date_from
                      ? minDateOnly(
                          shiftDate(params.date_from, MAX_DATE_RANGE_DAYS),
                          todayDateOnly(),
                        )
                      : todayDateOnly()
                  }
                  onChange={(event) =>
                    resetPageAndUpdate({ date_to: event.target.value })
                  }
                />
              </div>
              <p className="w-full text-xs text-(--mws-muted)">
                Custom Range is limited to {MAX_DATE_RANGE_DAYS} days.
              </p>
            </>
          ) : null}
        </div>

        <div className="w-full min-w-0 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
              <tr>
                <HeaderCell
                  label="Time"
                  column="created_at"
                  params={params}
                  onSort={resetPageAndUpdate}
                />
                <HeaderCell
                  label="Action"
                  column="action"
                  params={params}
                  onSort={resetPageAndUpdate}
                />
                <HeaderCell
                  label="Source"
                  column="source"
                  params={params}
                  onSort={resetPageAndUpdate}
                />
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {logsQuery.isLoading ? (
                <tr>
                  <td
                    className="px-4 py-10 text-center text-(--mws-muted)"
                    colSpan={6}
                  >
                    Loading audit logs...
                  </td>
                </tr>
              ) : displayRows.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-10 text-center text-(--mws-muted)"
                    colSpan={6}
                  >
                    No audit logs found.
                  </td>
                </tr>
              ) : (
                displayRows.map((log) => (
                  <tr
                    key={log.id}
                    tabIndex={0}
                    className="cursor-pointer border-t border-(--mws-line) bg-white hover:bg-(--mws-soft) focus:bg-(--mws-soft) focus:outline-none"
                    onClick={() => setSelectedLog(log)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedLog(log);
                      }
                    }}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={actionTone(log.action)}>
                        {formatStatus(log.action)}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3">{formatStatus(log.source)}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-(--mws-charcoal)">
                        {log.admin?.email || log.api_client?.name || "System"}
                      </p>
                      <p className="text-xs text-(--mws-muted)">
                        {log.admin?.role
                          ? formatStatus(log.admin.role)
                          : log.api_client?.token_prefix || "-"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-(--mws-charcoal)">
                        {log.entity_label || log.entity_type || "-"}
                      </p>
                      {log.entity_type === "ImportJob" ||
                      (log.new_values?.job_id && log.new_values?.entity) ? (
                        <p
                          className="max-w-[220px] truncate text-xs text-(--mws-muted)"
                          title={log.new_values?.file_name}
                        >
                          {[
                            log.new_values?.file_name,
                            log.new_values?.total_rows != null
                              ? `${log.new_values.total_rows} rows`
                              : log.new_values?.row_count != null
                                ? `${log.new_values.row_count} rows`
                                : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "-"}
                        </p>
                      ) : (
                        <p
                          className="max-w-[220px] truncate text-xs text-(--mws-muted)"
                          title={log.entity_id}
                        >
                          {log.entity_label ? log.entity_type : null}
                          {log.entity_label && log.entity_type ? " · " : null}
                          {log.entity_id || "-"}
                        </p>
                      )}
                      {log.pairedWith ? (
                        <p className="mt-0.5 text-xs text-(--mws-muted)">
                          Also checked: {log.pairedWith.entity_type} (
                          {log.pairedWith.new_values?.found
                            ? "found"
                            : "not found"}
                          )
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedLog(log);
                        }}
                      >
                        <Eye size={15} />
                        View Details
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <PaginationBar
          paging={paging}
          itemLabel="logs"
          isLoading={logsQuery.isLoading}
          onPrevious={() => updateParams({ page: params.page - 1 })}
          onNext={() => updateParams({ page: params.page + 1 })}
          onPageSizeChange={(size) => updateParams({ page: 1, size })}
        />
      </section>

      {selectedLog ? (
        <AuditLogDetailsDialog
          log={selectedLog}
          onClose={() => setSelectedLog(null)}
        />
      ) : null}
    </div>
  );
}

function HeaderCell({ label, column, params, onSort }) {
  return (
    <th className="px-4 py-3">
      <SortableHeader
        label={label}
        column={column}
        sortBy={params.sort_by}
        sortOrder={params.sort_order}
        onSort={(nextColumn, nextOrder) =>
          onSort({ sort_by: nextColumn, sort_order: nextOrder })
        }
      />
    </th>
  );
}

function toDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const MAX_DATE_RANGE_DAYS = 30;

function shiftDate(dateOnlyString, days) {
  const date = new Date(`${dateOnlyString}T00:00:00.000`);
  date.setDate(date.getDate() + days);
  return toDateOnly(date);
}

function todayDateOnly() {
  return toDateOnly(new Date());
}

function minDateOnly(a, b) {
  return a < b ? a : b;
}

function startOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  result.setDate(result.getDate() + diff);
  return result;
}

const DATE_RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "custom", label: "Custom Range" },
];

function defaultDateRange() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - MAX_DATE_RANGE_DAYS);
  return { date_from: toDateOnly(start), date_to: toDateOnly(now) };
}

function computeDateRange(preset) {
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

function enumOptions(values) {
  return values.map((value) => ({ value, label: formatStatus(value) }));
}

function actionTone(action) {
  if (action.includes("DELETE") || action.includes("REVOKE")) return "red";
  if (action.includes("CREATE") || action.includes("LOGIN")) return "green";
  if (action.includes("ACCESS")) return "amber";
  return "neutral";
}

function AuditLogDetailsDialog({ log, onClose }) {
  return (
    <CrudDialog
      title="Audit Details"
      description={`${formatStatus(log.action)} from ${formatStatus(log.source)}.`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <DetailItem label="Time" value={formatDateTime(log.created_at)} />
          <DetailItem label="Action" value={formatStatus(log.action)} />
          <DetailItem label="Source" value={formatStatus(log.source)} />
          <DetailItem
            label="Actor"
            value={log.admin?.email || log.api_client?.name || "System"}
          />
          <DetailItem
            label="Actor Role / Token"
            value={
              log.admin?.role
                ? formatStatus(log.admin.role)
                : log.api_client?.token_prefix || "-"
            }
          />
          <DetailItem
            label="Entity"
            value={log.entity_label || log.entity_type || "-"}
          />
          <DetailItem
            label="Entity Type / ID"
            value={
              [log.entity_type, log.entity_id].filter(Boolean).join(" · ") ||
              "-"
            }
          />
          <DetailItem label="IP Address" value={log.ip_address || "-"} />
        </div>

        {log.pairedWith ? (
          <p className="rounded-xl bg-(--mws-soft) p-3 text-xs leading-5 text-(--mws-muted)">
            This SSO lookup also checked{" "}
            <strong>{log.pairedWith.entity_type}</strong> for the same email (
            {log.pairedWith.new_values?.found ? "found" : "not found"}) -
            Central checks Student and Employee separately to resolve who signed
            in.
          </p>
        ) : null}

        <div>
          <h3 className="mb-2 font-display text-sm font-bold text-(--mws-charcoal)">
            {log.action === "EXPORT_DATA" ? "Export Summary" : "Changes"}
          </h3>
          {log.action === "EXPORT_DATA" ? (
            <ExportAuditSummary values={log.new_values} />
          ) : (
            <AuditDiffTable
              oldValues={log.old_values}
              newValues={log.new_values}
              resolvedLabels={log.resolved_labels}
            />
          )}
        </div>

        <div>
          <h3 className="mb-2 font-display text-sm font-bold text-(--mws-charcoal)">
            User Agent
          </h3>
          <p className="rounded-xl bg-(--mws-soft) p-3 text-xs leading-5 text-(--mws-muted)">
            {log.user_agent || "-"}
          </p>
        </div>
      </div>
    </CrudDialog>
  );
}

function DetailItem({ label, value }) {
  return (
    <div className="rounded-xl border border-(--mws-line) bg-white p-3">
      <p className="text-xs font-semibold text-(--mws-muted)">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-(--mws-charcoal)">
        {value}
      </p>
    </div>
  );
}

function ExportAuditSummary({ values }) {
  if (!values) {
    return (
      <p className="rounded-xl bg-(--mws-soft) p-3 text-sm text-(--mws-muted)">
        No export details recorded.
      </p>
    );
  }

  const columns = Array.isArray(values.included_columns)
    ? values.included_columns
    : [];
  const filters =
    values.filters && typeof values.filters === "object" ? values.filters : {};
  const filterEntries = Object.entries(filters);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DetailItem label="Data" value={exportEntityLabel(values.entity)} />
        <DetailItem
          label="File Format"
          value={String(values.format || "-").toUpperCase()}
        />
        <DetailItem label="Records Exported" value={values.row_count ?? "-"} />
        <DetailItem
          label="Data Sensitivity"
          value={
            values.included_sensitive_data
              ? "Sensitive data included"
              : "Standard data only"
          }
        />
      </div>

      <div className="rounded-xl border border-(--mws-line) bg-white p-3">
        <p className="text-xs font-semibold text-(--mws-muted)">Export mode</p>
        <p className="mt-1 text-sm font-semibold text-(--mws-charcoal)">
          {values.export_mode === "sensitive"
            ? "Sensitive export"
            : "Standard export"}
        </p>
        <p className="mt-1 text-xs leading-5 text-(--mws-muted)">
          This activity was recorded in Audit Logs.
        </p>
      </div>

      <div className="rounded-xl border border-(--mws-line) bg-white p-3">
        <p className="text-xs font-semibold text-(--mws-muted)">Filters used</p>
        {filterEntries.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {filterEntries.map(([key, value]) => (
              <span
                key={key}
                className="rounded-full bg-(--mws-soft) px-2.5 py-1 text-xs text-(--mws-charcoal)"
              >
                {exportFilterLabel(key)}: {exportFilterValue(key, value)}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-sm text-(--mws-muted)">
            No filters. All available records were included.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-(--mws-line) bg-white p-3">
        <p className="text-xs font-semibold text-(--mws-muted)">
          Included fields
        </p>
        <p className="mt-1 text-sm text-(--mws-charcoal)">
          {columns.length} field{columns.length === 1 ? "" : "s"} included in
          the file.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {columns.map((column) => (
            <span
              key={column}
              className="rounded-md border border-(--mws-line) px-2 py-1 text-xs text-(--mws-muted)"
            >
              {column}
            </span>
          ))}
        </div>
      </div>

      <details className="rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3 text-xs text-(--mws-muted)">
        <summary className="cursor-pointer font-semibold text-(--mws-charcoal)">
          Technical details
        </summary>
        <pre className="mws-scrollbar mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">
          {JSON.stringify(values, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function exportEntityLabel(entity) {
  if (entity === "Employee") return "Employee records";
  if (entity === "Student") return "Student records";
  return formatStatus(entity);
}

function exportFilterLabel(key) {
  const labels = {
    status: "Status",
    sort_by: "Sorted by",
    sort_order: "Order",
    is_deleted: "Records",
    unit_id: "Unit",
    building_id: "Building",
    current_grade_id: "Grade",
    current_class_id: "Class",
    search: "Search",
  };
  return labels[key] || formatStatus(key);
}

function exportFilterValue(key, value) {
  if (key === "is_deleted") return value ? "Trash Bin" : "Active records";
  if (key === "sort_by") return formatStatus(String(value));
  if (key === "sort_order")
    return value === "desc" ? "Newest first" : "Oldest first";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return formatStatus(String(value));
}

function formatAuditValue(key, value, resolvedLabels) {
  if (key === "phase" && typeof value === "string") return formatStatus(value);
  return formatDiffValue(value, resolvedLabels);
}

export function AuditDiffTable({ oldValues, newValues, resolvedLabels }) {
  if (!oldValues && !newValues) {
    return (
      <p className="rounded-xl bg-(--mws-soft) p-3 text-sm text-(--mws-muted)">
        No field values recorded for this action.
      </p>
    );
  }

  const isDiff = Boolean(oldValues) && Boolean(newValues);
  const keys = Array.from(
    new Set([
      ...(oldValues ? Object.keys(oldValues) : []),
      ...(newValues ? Object.keys(newValues) : []),
    ]),
  ).sort();

  const changedKeys = isDiff
    ? keys.filter(
        (key) =>
          JSON.stringify(oldValues[key]) !== JSON.stringify(newValues[key]),
      )
    : keys;

  return (
    <div>
      {isDiff ? (
        <p className="mb-2 text-xs text-(--mws-muted)">
          {changedKeys.length} of {keys.length} field
          {keys.length === 1 ? "" : "s"} changed
        </p>
      ) : null}
      <div className="max-h-96 overflow-auto rounded-xl border border-(--mws-line)">
        <table className="w-full min-w-[480px] text-left text-xs">
          <thead className="sticky top-0 bg-(--mws-soft) font-semibold text-(--mws-muted)">
            <tr>
              <th className="px-3 py-2">Field</th>
              {oldValues ? <th className="px-3 py-2">Before</th> : null}
              {newValues ? <th className="px-3 py-2">After</th> : null}
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => {
              const changed = isDiff && changedKeys.includes(key);
              return (
                <tr
                  key={key}
                  className={`border-t border-(--mws-line) ${changed ? "bg-[#fff4d8]" : "bg-white"}`}
                >
                  <td className="px-3 py-2 align-top font-medium text-(--mws-charcoal)">
                    {formatStatus(key)}
                  </td>
                  {oldValues ? (
                    <td
                      className="px-3 py-2 align-top text-(--mws-muted)"
                      title={
                        typeof oldValues[key] === "string"
                          ? oldValues[key]
                          : undefined
                      }
                    >
                      {formatAuditValue(key, oldValues[key], resolvedLabels)}
                    </td>
                  ) : null}
                  {newValues ? (
                    <td
                      className={`px-3 py-2 align-top ${changed ? "font-semibold text-(--mws-charcoal)" : "text-(--mws-muted)"}`}
                      title={
                        typeof newValues[key] === "string"
                          ? newValues[key]
                          : undefined
                      }
                    >
                      {formatAuditValue(key, newValues[key], resolvedLabels)}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
