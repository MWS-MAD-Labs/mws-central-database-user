import { useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import { DebouncedSearchInput, FilterSelect } from '../../../components/ui/FormControls.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
import { SortableHeader } from '../../../components/ui/SortableHeader.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { formatDate, formatStatus } from '../../../lib/format.js'
import { auditActions, auditLogsApi, auditSources } from '../api/auditLogsApi.js'

export function AuditLogsPage() {
  const [selectedLog, setSelectedLog] = useState(null)
  const [params, setParams] = useState({
    page: 1,
    size: 20,
    search: '',
    action: '',
    source: '',
    entity_type: '',
    sort_by: 'created_at',
    sort_order: 'desc',
  })

  const queryParams = useMemo(() => params, [params])
  const logsQuery = useQuery({
    queryKey: ['audit-logs', queryParams],
    queryFn: () => auditLogsApi.list(queryParams),
  })
  const paging = logsQuery.data?.paging || {
    current_page: params.page,
    total_page: 1,
    total_item: 0,
    size: params.size,
  }

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }))
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 })
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="Audit Logs"
        description="Review admin, API, sensitive-data, and data-change activity."
      />

      <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--mws-line)] p-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 xl:max-w-lg">
            <DebouncedSearchInput
              value={params.search}
              placeholder="Search actor, API client, or entity ID"
              className="min-w-0 flex-1"
              onChange={(search) => resetPageAndUpdate({ search })}
            />
            <StatusBadge tone={logsQuery.isFetching ? 'amber' : 'green'} className="shrink-0">
              {logsQuery.isFetching ? 'Syncing' : 'Live'}
            </StatusBadge>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:flex xl:flex-wrap xl:items-end xl:justify-end xl:gap-2">
            <FilterSelect
              label="Action"
              value={params.action}
              onChange={(value) => resetPageAndUpdate({ action: value })}
              options={[
                { value: '', label: 'All actions' },
                ...enumOptions(auditActions),
              ]}
            />
            <FilterSelect
              label="Source"
              value={params.source}
              onChange={(value) => resetPageAndUpdate({ source: value })}
              options={[
                { value: '', label: 'All sources' },
                ...enumOptions(auditSources),
              ]}
            />
            <FilterSelect
              label="Entity"
              value={params.entity_type}
              onChange={(value) => resetPageAndUpdate({ entity_type: value })}
              options={[
                { value: '', label: 'All entities' },
                { value: 'Student', label: 'Student' },
                { value: 'Employee', label: 'Employee' },
                { value: 'ConsentRecord', label: 'Consent' },
                { value: 'HealthRecord', label: 'Health Record' },
                { value: 'HealthNote', label: 'Health Note' },
                { value: 'ApiClient', label: 'API Client' },
              ]}
            />
          </div>
        </div>

        <div className="w-full min-w-0 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
              <tr>
                <HeaderCell label="Time" column="created_at" params={params} onSort={resetPageAndUpdate} />
                <HeaderCell label="Action" column="action" params={params} onSort={resetPageAndUpdate} />
                <HeaderCell label="Source" column="source" params={params} onSort={resetPageAndUpdate} />
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {logsQuery.isLoading ? (
                <tr>
                  <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={6}>
                    Loading audit logs...
                  </td>
                </tr>
              ) : (logsQuery.data?.data || []).length === 0 ? (
                <tr>
                  <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={6}>
                    No audit logs found.
                  </td>
                </tr>
              ) : (
                logsQuery.data.data.map((log) => (
                  <tr
                    key={log.id}
                    tabIndex={0}
                    className="cursor-pointer border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)] focus:bg-[var(--mws-soft)] focus:outline-none"
                    onClick={() => setSelectedLog(log)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedLog(log)
                      }
                    }}
                  >
                    <td className="px-4 py-3">{formatDate(log.created_at)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={actionTone(log.action)}>{formatStatus(log.action)}</StatusBadge>
                    </td>
                    <td className="px-4 py-3">{formatStatus(log.source)}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[var(--mws-charcoal)]">
                        {log.admin?.email || log.api_client?.name || 'System'}
                      </p>
                      <p className="text-xs text-[var(--mws-muted)]">
                        {log.admin?.role || log.api_client?.token_prefix || '-'}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[var(--mws-charcoal)]">
                        {log.entity_type || '-'}
                      </p>
                      <p className="max-w-[220px] truncate text-xs text-[var(--mws-muted)]">
                        {log.entity_id || '-'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelectedLog(log)
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
        <AuditLogDetailsDialog log={selectedLog} onClose={() => setSelectedLog(null)} />
      ) : null}
    </div>
  )
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
  )
}

function enumOptions(values) {
  return values.map((value) => ({ value, label: formatStatus(value) }))
}

function actionTone(action) {
  if (action.includes('DELETE') || action.includes('REVOKE')) return 'red'
  if (action.includes('CREATE') || action.includes('LOGIN')) return 'green'
  if (action.includes('ACCESS')) return 'amber'
  return 'neutral'
}

function AuditLogDetailsDialog({ log, onClose }) {
  return (
    <CrudDialog
      title="Audit Details"
      description={`${formatStatus(log.action)} from ${formatStatus(log.source)}.`}
      onClose={onClose}
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <DetailItem label="Time" value={formatDate(log.created_at)} />
          <DetailItem label="Action" value={formatStatus(log.action)} />
          <DetailItem label="Source" value={formatStatus(log.source)} />
          <DetailItem label="Actor" value={log.admin?.email || log.api_client?.name || 'System'} />
          <DetailItem label="Actor Role / Token" value={log.admin?.role || log.api_client?.token_prefix || '-'} />
          <DetailItem label="Entity" value={log.entity_type || '-'} />
          <DetailItem label="Entity ID" value={log.entity_id || '-'} />
          <DetailItem label="IP Address" value={log.ip_address || '-'} />
        </div>

        <div>
          <h3 className="mb-2 font-display text-sm font-bold text-[var(--mws-charcoal)]">
            Before
          </h3>
          <JsonBlock value={log.old_values} />
        </div>

        <div>
          <h3 className="mb-2 font-display text-sm font-bold text-[var(--mws-charcoal)]">
            After
          </h3>
          <JsonBlock value={log.new_values} />
        </div>

        <div>
          <h3 className="mb-2 font-display text-sm font-bold text-[var(--mws-charcoal)]">
            User Agent
          </h3>
          <p className="rounded-xl bg-[var(--mws-soft)] p-3 text-xs leading-5 text-[var(--mws-muted)]">
            {log.user_agent || '-'}
          </p>
        </div>
      </div>
    </CrudDialog>
  )
}

function DetailItem({ label, value }) {
  return (
    <div className="rounded-xl border border-[var(--mws-line)] bg-white p-3">
      <p className="text-xs font-semibold text-[var(--mws-muted)]">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-[var(--mws-charcoal)]">
        {value}
      </p>
    </div>
  )
}

function JsonBlock({ value }) {
  if (!value) {
    return (
      <p className="rounded-xl bg-[var(--mws-soft)] p-3 text-sm text-[var(--mws-muted)]">
        -
      </p>
    )
  }

  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--mws-soft)] p-3 text-xs leading-5 text-[var(--mws-charcoal)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}
