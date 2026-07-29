import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { DataTransferActions } from '../../import-export/components/DataTransferActions.jsx'
import { useAuth } from '../../auth/hooks/useAuth.js'
import {
  employeesApi,
  employeeStatuses,
} from '../api/employeesApi.js'
import { loadEmployeeFormOptions } from '../api/employeeFormOptions.js'
import { EmployeesTable } from '../components/EmployeesTable.jsx'
import { useEmployeesSearchParams } from '../hooks/useEmployeesSearchParams.js'
import { formatStatus } from '../../../lib/format.js'

export function EmployeesPage() {
  const { params, updateParams, resetPageAndUpdate } =
    useEmployeesSearchParams()
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const queryParams = useMemo(
    () => ({
      page: params.page,
      size: params.size,
      search: params.search,
      status: params.status,
      building_id: params.building_id,
      is_deleted: params.is_deleted,
      sort_by: params.sort_by,
      sort_order: params.sort_order,
    }),
    [params],
  )

  const employeesQuery = useQuery({
    queryKey: ['employees', queryParams],
    queryFn: () => employeesApi.list(queryParams),
  })

  const optionsQuery = useQuery({
    queryKey: ['employee-form-options'],
    queryFn: loadEmployeeFormOptions,
  })

  const restoreMutation = useMutation({
    mutationFn: employeesApi.restore,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
    },
  })

  const sorting = useMemo(
    () => [
      {
        id: params.sort_by,
        desc: params.sort_order === 'desc',
      },
    ],
    [params.sort_by, params.sort_order],
  )

  function handleSortingChange(updater) {
    const nextSorting =
      typeof updater === 'function' ? updater(sorting) : updater
    const next = nextSorting[0]

    resetPageAndUpdate({
      sort_by: next?.id || 'created_at',
      sort_order: next?.desc ? 'desc' : 'asc',
    })
  }

  const paging = employeesQuery.data?.paging || {
    current_page: params.page,
    total_page: 1,
    total_item: 0,
    size: params.size,
  }
  const isTrash = params.is_deleted === 'true'
  const canWrite = user?.type === 'admin' && user?.role !== 'VIEWER'
  const canRestore = user?.role === 'SUPER_ADMIN'
  const canImport = user?.role === 'SUPER_ADMIN'

  const handleRestore = useCallback((employeeId) => {
    restoreMutation.mutate(employeeId)
  }, [restoreMutation])

  return (
    <div>
      <PageHeader
        title="Employees"
        description="Manage employee records, work assignments, and profile authority data."
        actions={
          <>
            <DataTransferActions
              entity="employees"
              exportParams={queryParams}
              canImport={canImport}
              canExport={user?.type === 'admin'}
            />
            {canWrite ? (
              <Button asChild>
                <Link to="/employees/new">
                  <Plus size={16} />
                  New employee
                </Link>
              </Button>
            ) : (
              <Button type="button" disabled>
                <Plus size={16} />
                New employee
              </Button>
            )}
          </>
        }
      />

      <div className="rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <div className="flex flex-col gap-3 border-b border-[var(--mws-line)] p-4 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full max-w-md">
            <Search
              size={17}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--mws-muted)]"
            />
            <input
              type="search"
              placeholder="Search employees"
              value={params.search}
              onChange={(event) =>
                resetPageAndUpdate({ search: event.target.value })
              }
              className="h-11 w-full rounded-xl border border-[var(--mws-line)] bg-white pl-10 pr-3 text-sm outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A]"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Status"
              value={params.status}
              onChange={(value) => resetPageAndUpdate({ status: value })}
            >
              <option value="">All statuses</option>
              {employeeStatuses.map((status) => (
                <option key={status} value={status}>
                  {formatStatus(status)}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="Records"
              value={params.is_deleted}
              onChange={(value) => resetPageAndUpdate({ is_deleted: value })}
            >
              <option value="">Active records</option>
              <option value="true">Trash bin</option>
            </FilterSelect>
            <FilterSelect
              label="Building"
              value={params.building_id}
              onChange={(value) => resetPageAndUpdate({ building_id: value })}
            >
              <option value="">All buildings</option>
              {(optionsQuery.data?.buildings || []).map((building) => (
                <option key={building.id} value={building.id}>
                  {building.name}
                </option>
              ))}
            </FilterSelect>
           
            <StatusBadge tone={employeesQuery.isFetching ? 'amber' : 'green'}>
              {employeesQuery.isFetching ? 'Syncing' : 'Live'}
            </StatusBadge>
          </div>
        </div>

        <EmployeesTable
          employees={employeesQuery.data?.data || []}
          sorting={sorting}
          onSortingChange={handleSortingChange}
          isLoading={employeesQuery.isLoading}
          isTrash={isTrash}
          canRestore={canRestore}
          restoringId={restoreMutation.variables}
          onRestore={handleRestore}
        />

        <PaginationBar
          paging={paging}
          itemLabel="employees"
          isLoading={employeesQuery.isLoading}
          onPrevious={() => updateParams({ page: params.page - 1 })}
          onNext={() => updateParams({ page: params.page + 1 })}
          onPageSizeChange={(size) => updateParams({ page: 1, size })}
        />
      </div>
    </div>
  )
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label className="space-y-1.5">
      <span className="block font-display text-xs font-bold text-[var(--mws-muted)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-[var(--mws-line)] bg-white px-3 text-sm text-[var(--mws-charcoal)] outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A]"
      >
        {children}
      </select>
    </label>
  )
}
