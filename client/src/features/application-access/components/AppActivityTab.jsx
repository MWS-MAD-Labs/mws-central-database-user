import { Eye } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { DateRangeFilter } from "../../../components/ui/DateRangeFilter.jsx";
import { FilterResetButton } from "../../../components/ui/FilterResetButton.jsx";
import { LiveIndicator } from "../../../components/ui/LiveIndicator.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { formatDateTime, formatStatus } from "../../../lib/format.js";
import { titleCase } from "../utils/roleLabel.js";

function toneOf(title) {
  if (/Deleted|Revoked|Retired|Hidden/.test(title)) return "red";
  if (/Added|Made|Shown|Restored/.test(title)) return "green";
  if (/Rotated/.test(title)) return "amber";
  return "neutral";
}

function changeNames(item) {
  return item.changes?.length > 0 ? item.changes.map((change) => titleCase(change.label)).join(", ") : "-";
}

// The changes made to one application, in the same table form as Audit Logs.
export function AppActivityTab({ data, range, isDefaultRange, isFetching, onRangeChange, onReset, onPage, onPageSize }) {
  const [selected, setSelected] = useState(null);
  const rows = data?.activity ?? [];

  return (
    <div className="-m-5 overflow-hidden rounded-2xl">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3 border-b border-(--mws-line) p-4">
        <div className="flex items-center gap-3">
          <LiveIndicator isSyncing={isFetching} />
          <FilterResetButton visible={!isDefaultRange} onReset={onReset} />
        </div>
        <DateRangeFilter value={range} onChange={onRangeChange} />
      </div>

      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Changes</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-(--mws-muted)" colSpan={5}>
                  No changes in this period.
                </td>
              </tr>
            ) : (
              rows.map((item) => (
                <tr
                  key={item.id}
                  tabIndex={0}
                  className="cursor-pointer border-t border-(--mws-line) bg-white hover:bg-(--mws-soft) focus:bg-(--mws-soft) focus:outline-none"
                  onClick={() => setSelected(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelected(item);
                    }
                  }}
                >
                  <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(item.at)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={toneOf(item.title)}>{item.title}</StatusBadge>
                  </td>
                  <td className="max-w-[260px] truncate px-4 py-3 text-(--mws-muted)" title={changeNames(item)}>
                    {changeNames(item)}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-(--mws-charcoal)">{item.by || "System"}</p>
                    <p className="text-xs text-(--mws-muted)">{item.by_role ? formatStatus(item.by_role) : "-"}</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected(item);
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

      {data?.activity_paging ? (
        <PaginationBar
          paging={data.activity_paging}
          itemLabel="changes"
          isLoading={isFetching}
          onPrevious={() => onPage(Math.max(data.activity_paging.current_page - 1, 1))}
          onNext={() => onPage(data.activity_paging.current_page + 1)}
          onPageChange={onPage}
          onPageSizeChange={onPageSize}
        />
      ) : null}

      {selected ? (
        <CrudDialog title="Change Details" description={`${selected.title} on ${formatDateTime(selected.at)}.`} onClose={() => setSelected(null)}>
          <div className="space-y-4">
            <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-(--mws-muted)">Actor</dt>
              <dd className="font-semibold text-(--mws-charcoal)">{selected.by || "System"}</dd>
              {selected.by_email ? (
                <>
                  <dt className="text-(--mws-muted)">Email</dt>
                  <dd>{selected.by_email}</dd>
                </>
              ) : null}
              {selected.ip_address ? (
                <>
                  <dt className="text-(--mws-muted)">IP Address</dt>
                  <dd>{selected.ip_address}</dd>
                </>
              ) : null}
            </dl>
            {selected.changes?.length > 0 ? (
              <table className="w-full text-left text-sm">
                <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
                  <tr>
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Before</th>
                    <th className="px-3 py-2">After</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.changes.map((change) => (
                    <tr key={change.label} className="border-t border-(--mws-line)">
                      <td className="px-3 py-2 font-semibold text-(--mws-charcoal)">{titleCase(change.label)}</td>
                      {change.to !== undefined ? (
                        <>
                          <td className="px-3 py-2 text-(--mws-muted)">{change.from}</td>
                          <td className="px-3 py-2">{change.to}</td>
                        </>
                      ) : (
                        <td className="px-3 py-2 text-(--mws-muted)" colSpan={2}>
                          Changed
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-(--mws-muted)">{selected.summary}</p>
            )}
          </div>
        </CrudDialog>
      ) : null}
    </div>
  );
}
