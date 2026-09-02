import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/hooks/useAuth'
import { useState } from 'react'
import { defaultPaging } from '../utils/params'
import { Plus } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useConfirm } from '../../../components/ui/useConfirm.js'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { formatDate } from '../../../lib/format.js'
import { HeaderCell } from './HeaderCell.jsx'
import { LoadingRows } from './LoadingRows.jsx'
import { MasterDataDialog } from './MasterDataDialog.jsx'
import { PanelFrame } from './PanelFrame.jsx'
import { RowActions } from './RowActions.jsx'
import { SearchBox } from './SearchBox.jsx'
import { invalidateMasterData } from '../utils/invalidateMasterData.js'
import { useMentorOptions } from '../hooks/useMentorOptions.js'

export function MasterResourcePanel({ resource }) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const confirm = useConfirm()
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    search: '',
    sort_by: 'name',
    sort_order: 'asc',
  })
  const [dialog, setDialog] = useState(null)

  const query = useQuery({
    queryKey: ['master-data', resource.id, params],
    queryFn: () => resource.api.list(params),
  })
  const mentorOptionsQuery = useMentorOptions(Boolean(resource.mentorField))
  const teachingEmployees = mentorOptionsQuery.data?.teachingEmployees || []

  const createMutation = useMutation({
    mutationFn: resource.api.create,
    onSuccess: () => {
      invalidateMasterData(queryClient, resource.id)
      setDialog(null)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => resource.api.update(id, payload),
    onSuccess: () => {
      invalidateMasterData(queryClient, resource.id)
      setDialog(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: resource.api.remove,
    onSuccess: () => {
      invalidateMasterData(queryClient, resource.id)
    },
  })

  const canWrite = user?.type === 'admin' && user?.role === 'SUPER_ADMIN'
  const items = query.data?.data || []
  const paging = query.data?.paging || defaultPaging(params)

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }))
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 })
  }

  async function handleDelete(item) {
    if (
      await confirm({
        title: `Delete ${resource.singular.toLowerCase()}`,
        description: `"${item.name}" will be deleted.`,
        confirmLabel: 'Delete',
        tone: 'danger',
      })
    ) {
      deleteMutation.mutate(item.id)
    }
  }

  return (
    <PanelFrame
      title={resource.label}
      description={resource.description}
      icon={resource.icon}
      isFetching={query.isFetching}
      action={
        <Button
          type="button"
          disabled={!canWrite}
          onClick={() => setDialog({ mode: 'create' })}
        >
          <Plus size={16} />
          New {resource.singular}
        </Button>
      }
      toolbar={
        <SearchBox
          value={params.search}
          placeholder={`Search ${resource.label.toLowerCase()}`}
          onChange={(value) => resetPageAndUpdate({ search: value })}
        />
      }
      notice={
        !canWrite
          ? 'Only Super Admin can create, edit, or delete master data.'
          : null
      }
    >
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
          <tr>
            <HeaderCell
              label="Name"
              column="name"
              params={params}
              onSort={resetPageAndUpdate}
            />
            {resource.teachingFlag ? (
              <th className="px-4 py-3">
                {resource.teachingFlag.checkboxLabel}
              </th>
            ) : null}
            {resource.mentorField ? (
              <th className="px-4 py-3">{resource.mentorField.label}</th>
            ) : null}
            <HeaderCell
              label="Created"
              column="created_at"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <LoadingRows
            isLoading={query.isLoading}
            isEmpty={items.length === 0}
            colSpan={
              3 + (resource.teachingFlag ? 1 : 0) + (resource.mentorField ? 1 : 0)
            }
            label={resource.itemLabel}
          />
          {!query.isLoading
            ? items.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[var(--mws-charcoal)]">
                      {item.name}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--mws-muted)]">
                      {item.id}
                    </div>
                  </td>
                  {resource.teachingFlag ? (
                    <td className="px-4 py-3">
                      <StatusBadge
                        tone={
                          item[resource.teachingFlag.field]
                            ? 'green'
                            : 'neutral'
                        }
                      >
                        {item[resource.teachingFlag.field]
                          ? 'Teaching'
                          : 'Non-teaching'}
                      </StatusBadge>
                    </td>
                  ) : null}
                  {resource.mentorField ? (
                    <td className="px-4 py-3 text-[var(--mws-muted)]">
                      {teachingEmployees.find(
                        (employee) =>
                          employee.id === item[resource.mentorField.field],
                      )?.identity.full_name || 'No default mentor'}
                    </td>
                  ) : null}
                  <td className="px-4 py-3 text-[var(--mws-muted)]">
                    {formatDate(item.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <RowActions
                      disabled={!canWrite}
                      onEdit={() =>
                        setDialog({ mode: 'edit', record: item })
                      }
                      onDelete={() => handleDelete(item)}
                    />
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>

      <PaginationBar
        paging={paging}
        itemLabel={resource.itemLabel}
        isLoading={query.isLoading}
        onPrevious={() => updateParams({ page: params.page - 1 })}
        onNext={() => updateParams({ page: params.page + 1 })}
        onPageSizeChange={(size) => updateParams({ page: 1, size })}
      />

      {dialog ? (
        <MasterDataDialog
          dialog={dialog}
          resource={resource}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => {
            if (dialog.mode === 'create') createMutation.mutate(payload)
            else updateMutation.mutate({ id: dialog.record.id, payload })
          }}
        />
      ) : null}
    </PanelFrame>
  )
}
