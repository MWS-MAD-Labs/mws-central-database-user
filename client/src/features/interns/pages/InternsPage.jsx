import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import {
  DebouncedSearchInput,
  FilterSelect,
} from '../../../components/ui/FormControls.jsx'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { internsApi, internStatuses } from '../api/internsApi.js'
import { loadInternFormOptions } from '../api/internFormOptions.js'
import { InternsTable } from '../components/InternsTable.jsx'
import { useInternsSearchParams } from '../hooks/useInternsSearchParams.js'
import { formatStatus } from '../../../lib/format.js'

export function InternsPage() {
  const { params, updateParams, resetPageAndUpdate } = useInternsSearchParams()
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const queryParams = useMemo(
    () => ({
      page: params.page,
      size: params.size,
      search: params.search,
      status: params.status === 'ALL' ? '' : params.status,
      building_id: params.building_id,
      is_deleted: params.is_deleted,
      sort_by: params.sort_by,
      sort_order: params.sort_order,
    }),
    [params],
  )

  const internsQuery = useQuery({
    queryKey: ['interns', queryParams],
    queryFn: () => internsApi.list(queryParams),
  })

  const optionsQuery = useQuery({
    queryKey: ['intern-form-options'],
    queryFn: loadInternFormOptions,
  })

  const restoreMutation = useMutation({
    mutationFn: internsApi.restore,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['interns'] })
    },
  })

  const sorting = useMemo(
    () => [{ id: params.sort_by, desc: params.sort_order === 'desc' }],
    [params.sort_by, params.sort_order],
  )

  function handleSortingChange(updater) {
    const nextSorting = typeof updater === 'function' ? updater(sorting) : updater
    const next = nextSorting[0]

    resetPageAndUpdate({
      sort_by: next?.id || 'created_at',
      sort_order: next?.desc ? 'desc' : 'asc',
    })
  }

  const paging = internsQuery.data?.paging || {
    current_page: params.page,
    total_page: 1,
    total_item: 0,
    size: params.size,
  }
  const isTrash = params.is_deleted === 'true'
  const canWrite =
    user?.role === 'SUPER_ADMIN' ||
    (user?.role === 'DATABASE_ADMIN' && Boolean(user?.can_write_employee_data))
  const canRestore = user?.role === 'SUPER_ADMIN'
  const interns = internsQuery.data?.data || []

  const handleRestore = useCallback(
    (internId) => {
      restoreMutation.mutate(internId)
    },
    [restoreMutation],
  )

  return (
    <div className="min-w-0">
      <PageHeader
        title="Interns"
        description="Manage intern records - unit, position, and internship period."
        actions={
          canWrite ? (
            <Button asChild>
              <Link to="/interns/new">
                <Plus size={16} />
                New Intern
              </Link>
            </Button>
          ) : (
            <Button type="button" disabled>
              <Plus size={16} />
              New Intern
            </Button>
          )
        }
      />

      <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--mws-line)] p-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 xl:max-w-lg">
            <DebouncedSearchInput
              value={params.search}
              placeholder="Search Interns"
              className="min-w-0 flex-1"
              onChange={(search) => resetPageAndUpdate({ search })}
            />
            <StatusBadge tone={internsQuery.isFetching ? 'amber' : 'green'} className="shrink-0">
              {internsQuery.isFetching ? 'Syncing' : 'Live'}
            </StatusBadge>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:flex xl:flex-wrap xl:items-end xl:justify-end xl:gap-2">
            <FilterSelect
              label="Status"
              value={params.status}
              onChange={(value) => resetPageAndUpdate({ status: value })}
              options={[
                { value: 'ALL', label: 'All Statuses' },
                ...statusOptions(internStatuses),
              ]}
            />
            <FilterSelect
              label="Records"
              value={params.is_deleted}
              onChange={(value) => resetPageAndUpdate({ is_deleted: value })}
              options={[
                { value: '', label: 'Active Records' },
                { value: 'true', label: 'Trash bin' },
              ]}
            />
            <FilterSelect
              label="Building"
              value={params.building_id}
              onChange={(value) => resetPageAndUpdate({ building_id: value })}
              options={[
                { value: '', label: 'All Buildings' },
                ...buildingOptions(optionsQuery.data?.buildings || []),
              ]}
            />
          </div>
        </div>

        <InternsTable
          interns={interns}
          sorting={sorting}
          onSortingChange={handleSortingChange}
          isLoading={internsQuery.isLoading}
          isTrash={isTrash}
          canRestore={canRestore}
          restoringId={restoreMutation.variables}
          onRestore={handleRestore}
        />

        <PaginationBar
          paging={paging}
          itemLabel="interns"
          isLoading={internsQuery.isLoading}
          onPrevious={() => updateParams({ page: params.page - 1 })}
          onNext={() => updateParams({ page: params.page + 1 })}
          onPageSizeChange={(size) => updateParams({ page: 1, size })}
        />
      </div>
    </div>
  )
}

function buildingOptions(buildings) {
  return buildings.map((building) => ({ value: building.id, label: building.name }))
}

function statusOptions(statuses) {
  return statuses.map((status) => ({ value: status, label: formatStatus(status) }))
}
