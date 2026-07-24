import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { employeesApi, employeeStatuses } from '../api/employeesApi.js'
import { EmployeesTable } from '../components/EmployeesTable.jsx'
import { useEmployeesSearchParams } from '../hooks/useEmployeesSearchParams.js'

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

  const handleRestore = useCallback((employeeId) => {
    restoreMutation.mutate(employeeId)
  }, [restoreMutation])

  return (
    <div>
      <PageHeader
        title="Employees"
        description="Manage employee records, work assignments, and profile authority data."
        actions={
          canWrite ? (
            <Button asChild>
              <Link to="/employees/new">
                <Plus size={16} />
                New Employee
              </Link>
            </Button>
          ) : (
            <Button type="button" disabled>
              <Plus size={16} />
              New Employee
            </Button>
          )
        }
      />

      <div className="rounded-md border border-[#deded7] bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[#e7e4dc] p-4 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full max-w-md">
            <Search
              size={17}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7a7f83]"
            />
            <input
              type="search"
              placeholder="Search employees"
              value={params.search}
              onChange={(event) =>
                resetPageAndUpdate({ search: event.target.value })
              }
              className="h-10 w-full rounded-md border border-[#d8d6cf] bg-white pl-10 pr-3 text-sm outline-none focus:border-[#48635d] focus:ring-2 focus:ring-[#d7e7df]"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={params.status}
              onChange={(event) =>
                resetPageAndUpdate({ status: event.target.value })
              }
              className="h-10 rounded-md border border-[#d8d6cf] bg-white px-3 text-sm text-[#34383c] outline-none focus:border-[#48635d] focus:ring-2 focus:ring-[#d7e7df]"
            >
              <option value="">All statuses</option>
              {employeeStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select
              value={params.is_deleted}
              onChange={(event) =>
                resetPageAndUpdate({ is_deleted: event.target.value })
              }
              className="h-10 rounded-md border border-[#d8d6cf] bg-white px-3 text-sm text-[#34383c] outline-none focus:border-[#48635d] focus:ring-2 focus:ring-[#d7e7df]"
            >
              <option value="">Active records</option>
              <option value="true">Trash bin</option>
            </select>
            <StatusBadge tone={employeesQuery.isFetching ? 'amber' : 'green'}>
              {employeesQuery.isFetching ? 'Syncing' : 'Live'}
            </StatusBadge>
          </div>
        </div>

        {employeesQuery.isError ? (
          <div className="border-b border-[#e7e4dc] bg-[#fff4f2] px-4 py-3 text-sm text-[#8f2f2f]">
            {employeesQuery.error.message || 'Failed to load employees.'}
          </div>
        ) : null}
        {restoreMutation.isError ? (
          <div className="border-b border-[#e7e4dc] bg-[#fff4f2] px-4 py-3 text-sm text-[#8f2f2f]">
            {restoreMutation.error.message || 'Failed to restore employee.'}
          </div>
        ) : null}

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
        />
      </div>
    </div>
  )
}
