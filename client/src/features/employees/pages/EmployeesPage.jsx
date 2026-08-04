import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { BulkActionBar } from '../../../components/ui/BulkActionBar.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { DebouncedSearchInput } from '../../../components/ui/FormControls.jsx'
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
import { showErrorToast, showSuccessToast } from '../../../lib/toast.js'

export function EmployeesPage() {
  const { params, updateParams, resetPageAndUpdate } =
    useEmployeesSearchParams()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState(() => new Set())

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

  const bulkMutation = useMutation({
    mutationFn: ({ action, ids }) =>
      action === 'restore'
        ? employeesApi.bulkRestore(ids)
        : employeesApi.bulkRemove(ids),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      setSelectedEmployeeIds(new Set())

      const actionLabel = variables.action === 'restore' ? 'restored' : 'archived'
      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} employee(s) ${actionLabel}.`)
      }
      if (result.failed_count > 0) {
        showErrorToast(`${result.failed_count} employee(s) failed to ${variables.action}.`)
      }
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

    resetPageAndClearSelection({
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
  const canBulkManage = user?.role === 'SUPER_ADMIN'
  const employees = useMemo(
    () => employeesQuery.data?.data || [],
    [employeesQuery.data?.data],
  )
  const visibleEmployeeIds = useMemo(
    () => employees.map((employee) => employee.id),
    [employees],
  )
  const selectedCount = selectedEmployeeIds.size
  const allVisibleSelected =
    visibleEmployeeIds.length > 0 &&
    visibleEmployeeIds.every((id) => selectedEmployeeIds.has(id))

  const handleRestore = useCallback((employeeId) => {
    restoreMutation.mutate(employeeId)
  }, [restoreMutation])

  const clearSelection = useCallback(() => {
    setSelectedEmployeeIds(new Set())
  }, [])

  const toggleSelected = useCallback((employeeId) => {
    setSelectedEmployeeIds((current) => {
      const next = new Set(current)
      if (next.has(employeeId)) {
        next.delete(employeeId)
      } else {
        next.add(employeeId)
      }
      return next
    })
  }, [])

  const toggleAllVisible = useCallback(() => {
    setSelectedEmployeeIds((current) => {
      if (visibleEmployeeIds.every((id) => current.has(id))) {
        return new Set()
      }
      return new Set(visibleEmployeeIds)
    })
  }, [visibleEmployeeIds])

  const resetPageAndClearSelection = useCallback((nextParams) => {
    setSelectedEmployeeIds(new Set())
    resetPageAndUpdate(nextParams)
  }, [resetPageAndUpdate])

  const updateParamsAndClearSelection = useCallback((nextParams) => {
    setSelectedEmployeeIds(new Set())
    updateParams(nextParams)
  }, [updateParams])

  function runBulkAction(action) {
    const ids = Array.from(selectedEmployeeIds)
    if (ids.length === 0) return

    if (
      action === 'delete' &&
      !window.confirm(`Archive ${ids.length} selected employee(s)?`)
    ) {
      return
    }

    bulkMutation.mutate({ action, ids })
  }

  return (
    <div className="min-w-0">
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

      <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--mws-line)] p-4 xl:flex-row xl:items-start xl:justify-between">
          <DebouncedSearchInput
            value={params.search}
            placeholder="Search employees"
            className="xl:max-w-lg"
            onChange={(search) => resetPageAndClearSelection({ search })}
          />
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:flex xl:flex-wrap xl:items-end xl:justify-end xl:gap-2">
            <FilterSelect
              label="Status"
              value={params.status}
              onChange={(value) => resetPageAndClearSelection({ status: value })}
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
              onChange={(value) => resetPageAndClearSelection({ is_deleted: value })}
            >
              <option value="">Active records</option>
              <option value="true">Trash bin</option>
            </FilterSelect>
            <FilterSelect
              label="Building"
              value={params.building_id}
              onChange={(value) => resetPageAndClearSelection({ building_id: value })}
            >
              <option value="">All buildings</option>
              {(optionsQuery.data?.buildings || []).map((building) => (
                <option key={building.id} value={building.id}>
                  {building.name}
                </option>
              ))}
            </FilterSelect>
           
            <div className="flex items-end">
              <StatusBadge tone={employeesQuery.isFetching ? 'amber' : 'green'}>
                {employeesQuery.isFetching ? 'Syncing' : 'Live'}
              </StatusBadge>
            </div>
          </div>
        </div>

        <BulkActionBar selectedCount={selectedCount} onClear={clearSelection}>
          {isTrash ? (
            <Button
              type="button"
              size="sm"
              disabled={!canBulkManage || bulkMutation.isPending}
              onClick={() => runBulkAction('restore')}
            >
              <RotateCcw size={15} />
              Restore selected
            </Button>
          ) : (
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={!canBulkManage || bulkMutation.isPending}
              onClick={() => runBulkAction('delete')}
            >
              <Trash2 size={15} />
              Archive selected
            </Button>
          )}
        </BulkActionBar>

        <EmployeesTable
          employees={employees}
          sorting={sorting}
          onSortingChange={handleSortingChange}
          isLoading={employeesQuery.isLoading}
          isTrash={isTrash}
          canRestore={canRestore}
          restoringId={restoreMutation.variables}
          onRestore={handleRestore}
          canSelect={canBulkManage}
          selectedIds={selectedEmployeeIds}
          onToggleSelected={toggleSelected}
          onToggleAll={toggleAllVisible}
          allSelected={allVisibleSelected}
        />

        <PaginationBar
          paging={paging}
          itemLabel="employees"
          isLoading={employeesQuery.isLoading}
          onPrevious={() => updateParamsAndClearSelection({ page: params.page - 1 })}
          onNext={() => updateParamsAndClearSelection({ page: params.page + 1 })}
          onPageSizeChange={(size) => updateParamsAndClearSelection({ page: 1, size })}
        />
      </div>
    </div>
  )
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label className="min-w-0 space-y-1.5 xl:min-w-36">
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
