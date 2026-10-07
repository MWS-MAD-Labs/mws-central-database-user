import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { ActionsMenu, ActionsMenuItem } from '../../../components/ui/ActionsMenu.jsx'
import { BulkActionBar } from '../../../components/ui/BulkActionBar.jsx'
import { BulkResultDialog } from '../../../components/ui/BulkResultDialog.jsx'
import { RestoreConfirmationDialog } from '../../../components/ui/RestoreConfirmationDialog.jsx'
import { useConfirm } from '../../../components/ui/useConfirm.js'
import { LiveIndicator } from '../../../components/ui/LiveIndicator.jsx'
import { FilterResetButton } from '../../../components/ui/FilterResetButton.jsx'
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
import { useBulkSelection } from '../../../lib/useBulkSelection.js'
import { showBulkFailureToast, showSuccessToast } from '../../../lib/toast.js'

export function InternsPage() {
  const { params, updateParams, resetPageAndUpdate } = useInternsSearchParams()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const confirm = useConfirm()
  const [bulkFailureResult, setBulkFailureResult] = useState(null)
  const [restoreInternRecords, setRestoreInternRecords] = useState(null)

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

  function resetFilters() {
    resetPageAndUpdate({
      search: '',
      status: '',
      building_id: '',
      is_deleted: '',
      sort_by: '',
      sort_order: '',
    })
  }

  const optionsQuery = useQuery({
    queryKey: ['intern-form-options'],
    queryFn: loadInternFormOptions,
  })

  const restoreMutation = useMutation({
    meta: { successMessage: 'Intern restored.' },
    mutationFn: internsApi.restore,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['interns'] })
    },
  })

  const bulkMutation = useMutation({
    mutationFn: ({ action, ids }) =>
      action === 'restore' ? internsApi.bulkRestore(ids) : internsApi.bulkRemove(ids),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['interns'] })
      clearSelection()
      if (result.success_count > 0) {
        showSuccessToast(
          `${result.success_count} intern(s) ${variables.action === 'restore' ? 'restored' : 'archived'}.`,
        )
      }
      if (result.failed_count > 0) {
        showBulkFailureToast(`intern(s) failed to ${variables.action}`, result)
        setBulkFailureResult({
          title: variables.action === 'restore' ? 'Intern Restore Failures' : 'Intern Archive Failures',
          result,
        })
      }
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
  const interns = useMemo(() => internsQuery.data?.data || [], [internsQuery.data?.data])
  const visibleInternIds = useMemo(() => interns.map((intern) => intern.id), [interns])
  const hasActiveFilters = Boolean(
    params.search || params.status !== 'ACTIVE' || params.building_id || params.is_deleted,
  )
  const {
    selectedIds,
    selectedCount,
    allVisibleSelected,
    clearSelection,
    toggleSelected,
    toggleAllVisible,
  } = useBulkSelection({
    listFn: internsApi.list,
    queryParams,
    visibleIds: visibleInternIds,
    hasActiveFilters,
    paging,
    pageSize: params.size,
    entityLabel: 'interns',
  })

  function handleRestore(internId) {
    const intern = interns.find((item) => item.id === internId)
    if (intern) setRestoreInternRecords([intern])
  }

  async function runBulkAction(action) {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (
      action === 'delete' &&
      !(await confirm({
        title: 'Archive interns',
        description: `Archive ${ids.length} selected intern(s)?`,
        confirmLabel: 'Archive',
        tone: 'danger',
      }))
    ) {
      return
    }
    bulkMutation.mutate({ action, ids })
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="Interns"
        description="Manage intern records: unit, position, and internship period."
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

      <div className="min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <div className="border-b border-(--mws-line) p-4">
          <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <DebouncedSearchInput
              value={params.search}
              placeholder="Search Interns"
              className="xl:max-w-lg"
              onChange={(search) => resetPageAndUpdate({ search })}
            />
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <LiveIndicator isSyncing={internsQuery.isFetching} />
              <FilterResetButton visible={hasActiveFilters} onReset={resetFilters} />
            </div>
          </div>

          <div className="mt-4 flex min-w-0 flex-wrap gap-3">
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
              onChange={(value) =>
                resetPageAndUpdate({ is_deleted: value, status: '' })
              }
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

        <BulkActionBar selectedCount={selectedCount} onClear={clearSelection}>
          <ActionsMenu label="Bulk Actions" disabled={bulkMutation.isPending}>
            {(closeMenu) =>
              isTrash ? (
                <ActionsMenuItem onClick={() => { closeMenu(); setRestoreInternRecords(interns.filter((intern) => selectedIds.has(intern.id))) }}>
                  <RotateCcw size={15} /> Restore selected
                </ActionsMenuItem>
              ) : (
                <ActionsMenuItem tone="danger" onClick={() => { closeMenu(); runBulkAction('delete') }}>
                  <Trash2 size={15} /> Archive selected
                </ActionsMenuItem>
              )
            }
          </ActionsMenu>
        </BulkActionBar>

        <InternsTable
          interns={interns}
          sorting={sorting}
          onSortingChange={handleSortingChange}
          isLoading={internsQuery.isLoading}
          isTrash={isTrash}
          canRestore={canRestore}
          restoringId={restoreMutation.variables}
          onRestore={handleRestore}
          canSelect={user?.role === 'SUPER_ADMIN'}
          selectedIds={selectedIds}
          onToggleSelected={toggleSelected}
          onToggleAll={toggleAllVisible}
          allSelected={allVisibleSelected}
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
      <BulkResultDialog
        title={bulkFailureResult?.title}
        result={bulkFailureResult?.result}
        getDetailHref={(id) => `/interns/${id}`}
        onClose={() => setBulkFailureResult(null)}
      />
      <RestoreConfirmationDialog
        title="Confirm Intern Restore"
        description="Review the archived intern records before restoring them."
        records={restoreInternRecords}
        columns={[
          { key: 'name', label: 'Name', render: (intern) => intern.identity.full_name },
          { key: 'unit', label: 'Unit', render: (intern) => intern.employment.unit || '-' },
          { key: 'position', label: 'Position', render: (intern) => intern.employment.job_position || '-' },
          { key: 'building', label: 'Building', render: (intern) => intern.employment.building || '-' },
          { key: 'end_date', label: 'End Date', render: (intern) => intern.employment.end_date || '-' },
        ]}
        getDetailHref={(intern) => `/interns/${intern.id}`}
        isSubmitting={restoreMutation.isPending || bulkMutation.isPending}
        onClose={() => setRestoreInternRecords(null)}
        onConfirm={() => {
          if (restoreInternRecords.length === 1) {
            restoreMutation.mutate(restoreInternRecords[0].id, {
              onSettled: () => setRestoreInternRecords(null),
            })
          } else {
            bulkMutation.mutate(
              { action: 'restore', ids: restoreInternRecords.map((intern) => intern.id) },
              { onSettled: () => setRestoreInternRecords(null) },
            )
          }
        }}
      />
    </div>
  )
}

function buildingOptions(buildings) {
  return buildings.map((building) => ({ value: building.id, label: building.name }))
}

function statusOptions(statuses) {
  return statuses.map((status) => ({ value: status, label: formatStatus(status) }))
}
