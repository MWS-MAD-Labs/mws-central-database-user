import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BriefcaseBusiness,
  Building2,
  Edit,
  Layers3,
  MapPinned,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import {
  CheckboxField,
  Field,
  TextInput,
} from '../../../components/ui/FormControls.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
import { SortableHeader } from '../../../components/ui/SortableHeader.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { cleanPayload, trimmedOrUndefined } from '../../../lib/form.js'
import { formatDate } from '../../../lib/format.js'
import { useAuth } from '../../auth/hooks/useAuth.js'
import {
  buildingsApi,
  jobLevelsApi,
  jobPositionsApi,
  unitsApi,
} from '../api/masterDataApi.js'

const resources = [
  {
    id: 'units',
    label: 'Units',
    singular: 'Unit',
    description: 'School branches and organization units used by employees and admin access scope.',
    icon: Building2,
    api: unitsApi,
    itemLabel: 'units',
  },
  {
    id: 'job-positions',
    label: 'Job Positions',
    singular: 'Job Position',
    description: 'Position names used in employee records, reporting, and internal directories.',
    icon: BriefcaseBusiness,
    api: jobPositionsApi,
    itemLabel: 'positions',
  },
  {
    id: 'job-levels',
    label: 'Job Levels',
    singular: 'Job Level',
    description: 'Employment levels, including whether a level counts as a teaching role.',
    icon: Layers3,
    api: jobLevelsApi,
    itemLabel: 'levels',
    hasTeachingRole: true,
  },
  {
    id: 'buildings',
    label: 'Buildings',
    singular: 'Building',
    description: 'Reusable building names used by employee records and import validation.',
    icon: MapPinned,
    api: buildingsApi,
    itemLabel: 'buildings',
  },
]

export default function MasterData() {
  const [searchParams] = useSearchParams()
  const activeResource =
    resources.find((resource) => resource.id === searchParams.get('tab')) ||
    resources[0]

  return (
    <div className="min-w-0">
      <PageHeader
        title="Master Data"
        description="Manage reusable data lists that are stored in the database and referenced across employee and admin workflows."
      />

      <MasterResourcePanel resource={activeResource} />
    </div>
  )
}

function MasterResourcePanel({ resource }) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
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

  function handleDelete(item) {
    if (window.confirm(`Delete ${resource.singular.toLowerCase()} "${item.name}"?`)) {
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
            {resource.hasTeachingRole ? (
              <th className="px-4 py-3">Teaching Role</th>
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
            colSpan={resource.hasTeachingRole ? 4 : 3}
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
                  {resource.hasTeachingRole ? (
                    <td className="px-4 py-3">
                      <StatusBadge tone={item.is_teaching_role ? 'green' : 'neutral'}>
                        {item.is_teaching_role ? 'Teaching' : 'Non-teaching'}
                      </StatusBadge>
                    </td>
                  ) : null}
                  <td className="px-4 py-3 text-[var(--mws-muted)]">
                    {formatDate(item.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <RowActions
                      disabled={!canWrite}
                      onEdit={() => setDialog({ mode: 'edit', record: item })}
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

function MasterDataDialog({ dialog, resource, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    name: dialog.record?.name || '',
    is_teaching_role: Boolean(dialog.record?.is_teaching_role),
  }))
  const title =
    dialog.mode === 'create'
      ? `New ${resource.singular}`
      : `Edit ${resource.singular}`

  function handleSubmit(event) {
    event.preventDefault()
    const payload = cleanPayload({
      name: trimmedOrUndefined(values.name),
      is_teaching_role: resource.hasTeachingRole
        ? values.is_teaching_role
        : undefined,
    })
    onSubmit(payload)
  }

  return (
    <CrudDialog
      title={title}
      description={resource.description}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="master-data-form" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="master-data-form" className="space-y-4" onSubmit={handleSubmit}>
        <Field label={`${resource.singular} Name`}>
          <TextInput
            required
            value={values.name}
            placeholder={`Enter ${resource.singular.toLowerCase()} name`}
            onChange={(event) =>
              setValues((current) => ({ ...current, name: event.target.value }))
            }
          />
        </Field>

        {resource.hasTeachingRole ? (
          <CheckboxField
            checked={values.is_teaching_role}
            label="Teaching role"
            description="Use this for job levels that should be treated as teaching staff."
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                is_teaching_role: event.target.checked,
              }))
            }
          />
        ) : null}
      </form>
    </CrudDialog>
  )
}

function PanelFrame({
  title,
  description,
  icon: Icon,
  action,
  toolbar,
  isFetching,
  notice,
  children,
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--mws-line)] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
            <Icon size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-[var(--mws-charcoal)]">
                {title}
              </h2>
              <StatusBadge tone={isFetching ? 'amber' : 'green'}>
                {isFetching ? 'Syncing' : 'Live'}
              </StatusBadge>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--mws-muted)]">
              {description}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">{action}</div>
      </div>
      {toolbar ? (
        <div className="flex min-w-0 flex-col gap-2 border-b border-[var(--mws-line)] p-4 lg:flex-row lg:items-center">
          {toolbar}
        </div>
      ) : null}
      {notice ? (
        <div className="border-b border-[var(--mws-line)] bg-[#fffaf0] px-4 py-3 text-sm text-[#8a6419]">
          {notice}
        </div>
      ) : null}
      <div className="w-full min-w-0 overflow-x-auto">{children}</div>
    </section>
  )
}

function SearchBox({ value, placeholder, onChange }) {
  return (
    <label className="relative block w-full min-w-0 lg:max-w-lg">
      <Search
        size={17}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--mws-muted)]"
      />
      <input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-[var(--mws-line)] bg-white pl-10 pr-3 text-sm outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A]"
      />
    </label>
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

function RowActions({ disabled, onEdit, onDelete }) {
  return (
    <div className="flex justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={onEdit}
      >
        <Edit size={15} />
        Edit
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={onDelete}
      >
        <Trash2 size={15} />
        Delete
      </Button>
    </div>
  )
}

function LoadingRows({ isLoading, isEmpty, colSpan, label }) {
  if (isLoading) {
    return (
      <tr>
        <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={colSpan}>
          Loading {label}...
        </td>
      </tr>
    )
  }

  if (isEmpty) {
    return (
      <tr>
        <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={colSpan}>
          No {label} found.
        </td>
      </tr>
    )
  }

  return null
}

function invalidateMasterData(queryClient, resourceId) {
  queryClient.invalidateQueries({ queryKey: ['master-data', resourceId] })
  queryClient.invalidateQueries({ queryKey: ['student-form-options'] })
  queryClient.invalidateQueries({ queryKey: ['employee-form-options'] })
}

function defaultPaging(params) {
  return {
    current_page: params.page,
    total_page: 1,
    total_item: 0,
    size: params.size,
  }
}
