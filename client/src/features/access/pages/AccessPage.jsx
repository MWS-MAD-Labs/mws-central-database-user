import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  CalendarPlus,
  Clock3,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import {
  CheckboxField,
  DebouncedSearchInput,
  Field,
  FilterSelect,
  SearchableSelect,
  SelectInput,
  TextAreaInput,
  TextInput,
} from '../../../components/ui/FormControls.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
import { SortableHeader } from '../../../components/ui/SortableHeader.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { cleanPayload, trimmedOrUndefined } from '../../../lib/form.js'
import { formatDate, formatStatus } from '../../../lib/format.js'
import { showErrorToast, showSuccessToast } from '../../../lib/toast.js'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { employeesApi } from '../../employees/api/employeesApi.js'
import { adminRoles, adminUsersApi, workingDaysApi } from '../api/accessApi.js'

const tabs = [
  { id: 'admins', label: 'Admin Users' },
  { id: 'working-days', label: 'Working Saturdays' },
]

export function AccessPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = tabs.some((tab) => tab.id === searchParams.get('tab'))
    ? searchParams.get('tab')
    : 'admins'
  const { user } = useAuth()

  function setTab(tab) {
    setSearchParams({ tab })
  }

  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="min-w-0">
        <PageHeader
          title="Access"
          description="Permission management is available for Super Admin accounts."
        />
        <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-6 text-sm text-[var(--mws-muted)]">
          You are not authorized to manage access settings.
        </section>
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="Access"
        description="Manage admin panel access, emergency write grants, and working Saturday overrides."
      />

      <div className="mb-4 flex min-w-0 flex-wrap gap-2">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            type="button"
            variant={activeTab === tab.id ? 'primary' : 'secondary'}
            onClick={() => setTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === 'working-days' ? <WorkingDaysPanel /> : <AdminUsersPanel />}
    </div>
  )
}

function AdminUsersPanel() {
  const queryClient = useQueryClient()
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    search: '',
    role: '',
    is_active: '',
    sort_by: 'created_at',
    sort_order: 'desc',
  })
  const [promoteOpen, setPromoteOpen] = useState(false)
  const [grantDialog, setGrantDialog] = useState(null)

  const queryParams = useMemo(
    () => ({
      ...params,
      is_active: params.is_active === '' ? undefined : params.is_active,
    }),
    [params],
  )

  const adminsQuery = useQuery({
    queryKey: ['admin-users', queryParams],
    queryFn: () => adminUsersApi.list(queryParams),
  })
  const employeesQuery = useQuery({
    queryKey: ['access-promotable-employees'],
    queryFn: () =>
      employeesApi.list({
        page: 1,
        size: 100,
        status: 'ACTIVE',
        sort_by: 'full_name',
        sort_order: 'asc',
      }),
  })

  const promoteMutation = useMutation({
    mutationFn: adminUsersApi.promote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setPromoteOpen(false)
      showSuccessToast('Employee promoted to admin.')
    },
  })
  const demoteMutation = useMutation({
    mutationFn: adminUsersApi.demote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      showSuccessToast('Admin access deactivated.')
    },
  })
  const reactivateMutation = useMutation({
    mutationFn: async (admin) => {
      const response = await employeesApi.list({
        page: 1,
        size: 10,
        search: admin.email,
        status: 'ACTIVE',
      })
      const employee = (response.data || []).find(
        (record) => record.identity.email === admin.email,
      )

      if (!employee) {
        throw new Error('Active employee with the same email was not found.')
      }

      return adminUsersApi.promote({
        employee_id: employee.id,
        role: admin.role,
        can_write_data:
          admin.role === 'DATABASE_ADMIN' ? Boolean(admin.can_write_data) : undefined,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      showSuccessToast('Admin access reactivated.')
    },
  })
  const writeMutation = useMutation({
    mutationFn: ({ id, value }) => adminUsersApi.setCanWriteData(id, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      showSuccessToast('Write permission updated.')
    },
  })
  const sensitiveMutation = useMutation({
    mutationFn: ({ id, value }) => adminUsersApi.setCanViewSensitiveData(id, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      showSuccessToast('Sensitive-data permission updated.')
    },
  })
  const allUnitsMutation = useMutation({
    mutationFn: ({ id, value }) => adminUsersApi.setCanViewAllUnits(id, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      showSuccessToast('Cross-unit visibility updated.')
    },
  })
  const employeePiiMutation = useMutation({
    mutationFn: ({ id, value }) => adminUsersApi.setCanViewEmployeePii(id, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      showSuccessToast('Employee PII permission updated.')
    },
  })
  const grantMutation = useMutation({
    mutationFn: ({ id, minutes }) => adminUsersApi.grantAfterHours(id, minutes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setGrantDialog(null)
      showSuccessToast('After-hours write grant applied.')
    },
  })

  const paging = adminsQuery.data?.paging || {
    current_page: params.page,
    total_page: 1,
    total_item: 0,
    size: params.size,
  }
  const employees = employeesQuery.data?.data || []

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }))
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 })
  }

  function handleDemote(admin) {
    if (window.confirm(`Deactivate admin access for ${admin.email}?`)) {
      demoteMutation.mutate(admin.id)
    }
  }

  function handleReactivate(admin) {
    if (window.confirm(`Reactivate admin access for ${admin.email}?`)) {
      reactivateMutation.mutate(admin)
    }
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--mws-line)] p-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 xl:max-w-lg">
          <DebouncedSearchInput
            value={params.search}
            placeholder="Search admin name or email"
            className="min-w-0 flex-1"
            onChange={(search) => resetPageAndUpdate({ search })}
          />
          <StatusBadge tone={adminsQuery.isFetching ? 'amber' : 'green'} className="shrink-0">
            {adminsQuery.isFetching ? 'Syncing' : 'Live'}
          </StatusBadge>
        </div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:flex xl:flex-wrap xl:items-end xl:justify-end xl:gap-2">
          <FilterSelect
            label="Role"
            value={params.role}
            onChange={(value) => resetPageAndUpdate({ role: value })}
            options={[
              { value: '', label: 'All roles' },
              ...adminRoles.map((role) => ({ value: role, label: formatStatus(role) })),
            ]}
          />
          <FilterSelect
            label="Status"
            value={params.is_active}
            onChange={(value) => resetPageAndUpdate({ is_active: value })}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Inactive' },
            ]}
          />
          <div className="flex items-end">
            <Button type="button" onClick={() => setPromoteOpen(true)}>
              <Plus size={16} />
              Promote
            </Button>
          </div>
        </div>
      </div>

      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
            <tr>
              <HeaderCell label="Name" column="full_name" params={params} onSort={resetPageAndUpdate} />
              <HeaderCell label="Email" column="email" params={params} onSort={resetPageAndUpdate} />
              <HeaderCell label="Role" column="role" params={params} onSort={resetPageAndUpdate} />
              <th className="px-4 py-3">Permissions</th>
              <th className="px-4 py-3">After-Hours Grant</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {adminsQuery.isLoading ? (
              <tr>
                <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={7}>
                  Loading admin users...
                </td>
              </tr>
            ) : (adminsQuery.data?.data || []).length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={7}>
                  No admin users found.
                </td>
              </tr>
            ) : (
              adminsQuery.data.data.map((admin) => (
                <tr
                  key={admin.id}
                  className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                >
                  <td className="px-4 py-3">
                    <p className="font-display font-bold text-[var(--mws-charcoal)]">
                      {admin.full_name}
                    </p>
                    <p className="text-xs text-[var(--mws-muted)]">{admin.admin_no}</p>
                  </td>
                  <td className="px-4 py-3 text-[var(--mws-charcoal)]">
                    <span className="block max-w-72 truncate">{admin.email}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={roleTone(admin.role)}>{formatStatus(admin.role)}</StatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                      <PermissionToggle
                        label="Write"
                        checked={Boolean(admin.can_write_data)}
                        disabled={
                          admin.role !== 'DATABASE_ADMIN' ||
                          !admin.is_active ||
                          writeMutation.variables?.id === admin.id
                        }
                        onChange={(value) =>
                          writeMutation.mutate({ id: admin.id, value })
                        }
                      />
                      <PermissionToggle
                        label="Sensitive"
                        checked={Boolean(admin.can_view_sensitive_data)}
                        disabled={
                          !admin.is_active ||
                          admin.role === 'SUPER_ADMIN' ||
                          sensitiveMutation.variables?.id === admin.id
                        }
                        onChange={(value) =>
                          sensitiveMutation.mutate({ id: admin.id, value })
                        }
                      />
                      <PermissionToggle
                        label="All units"
                        checked={Boolean(admin.can_view_all_units)}
                        disabled={
                          !admin.is_active ||
                          admin.role === 'SUPER_ADMIN' ||
                          allUnitsMutation.variables?.id === admin.id
                        }
                        onChange={(value) =>
                          allUnitsMutation.mutate({ id: admin.id, value })
                        }
                      />
                      <PermissionToggle
                        label="Employee PII"
                        checked={Boolean(admin.can_view_employee_pii)}
                        disabled={
                          !admin.is_active ||
                          admin.role === 'SUPER_ADMIN' ||
                          employeePiiMutation.variables?.id === admin.id
                        }
                        onChange={(value) =>
                          employeePiiMutation.mutate({ id: admin.id, value })
                        }
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm font-semibold text-[var(--mws-charcoal)]">
                      {formatDateTime(admin.after_hours_write_until)}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={
                        admin.role !== 'DATABASE_ADMIN' ||
                        !admin.can_write_data ||
                        !admin.is_active
                      }
                      onClick={() => setGrantDialog(admin)}
                    >
                      <Clock3 size={15} />
                      Grant
                    </Button>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={admin.is_active ? 'green' : 'red'}>
                      {admin.is_active ? 'Active' : 'Inactive'}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {admin.is_active ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={admin.role === 'SUPER_ADMIN'}
                        onClick={() => handleDemote(admin)}
                      >
                        <Ban size={15} />
                        Demote
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={reactivateMutation.variables?.id === admin.id}
                        onClick={() => handleReactivate(admin)}
                      >
                        <RotateCcw size={15} />
                        Reactivate
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        paging={paging}
        itemLabel="admins"
        isLoading={adminsQuery.isLoading}
        onPrevious={() => updateParams({ page: params.page - 1 })}
        onNext={() => updateParams({ page: params.page + 1 })}
        onPageSizeChange={(size) => updateParams({ page: 1, size })}
      />

      {promoteOpen ? (
        <PromoteDialog
          employees={employees}
          isLoadingEmployees={employeesQuery.isLoading}
          isSubmitting={promoteMutation.isPending}
          onClose={() => setPromoteOpen(false)}
          onSubmit={(payload) => promoteMutation.mutate(payload)}
        />
      ) : null}

      {grantDialog ? (
        <GrantDialog
          admin={grantDialog}
          isSubmitting={grantMutation.isPending}
          onClose={() => setGrantDialog(null)}
          onSubmit={(minutes) => grantMutation.mutate({ id: grantDialog.id, minutes })}
        />
      ) : null}
    </section>
  )
}

function WorkingDaysPanel() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)

  const workingDaysQuery = useQuery({
    queryKey: ['working-days'],
    queryFn: workingDaysApi.list,
  })
  const createMutation = useMutation({
    mutationFn: workingDaysApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['working-days'] })
      setCreateOpen(false)
      showSuccessToast('Working Saturday added.')
    },
  })
  const deleteMutation = useMutation({
    mutationFn: workingDaysApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['working-days'] })
      showSuccessToast('Working Saturday removed.')
    },
  })

  function handleDelete(day) {
    if (window.confirm(`Remove working Saturday on ${formatDate(day.date)}?`)) {
      deleteMutation.mutate(day.id)
    }
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--mws-line)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
            <CalendarPlus size={19} />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-[var(--mws-charcoal)]">
              Working Saturday Overrides
            </h2>
            <p className="text-sm text-[var(--mws-muted)]">
              Only Saturdays can be added here.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={workingDaysQuery.isFetching ? 'amber' : 'green'}>
            {workingDaysQuery.isFetching ? 'Syncing' : 'Live'}
          </StatusBadge>
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            Saturday
          </Button>
        </div>
      </div>

      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {workingDaysQuery.isLoading ? (
              <tr>
                <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={4}>
                  Loading working Saturdays...
                </td>
              </tr>
            ) : (workingDaysQuery.data || []).length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={4}>
                  No working Saturday overrides yet.
                </td>
              </tr>
            ) : (
              workingDaysQuery.data.map((day) => (
                <tr
                  key={day.id}
                  className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                >
                  <td className="px-4 py-3 font-semibold text-[var(--mws-charcoal)]">
                    {formatDate(day.date)}
                  </td>
                  <td className="px-4 py-3 text-[var(--mws-muted)]">{day.reason || '-'}</td>
                  <td className="px-4 py-3">{formatDate(day.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={deleteMutation.variables === day.id}
                      onClick={() => handleDelete(day)}
                    >
                      <Trash2 size={15} />
                      Remove
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {createOpen ? (
        <WorkingDayDialog
          isSubmitting={createMutation.isPending}
          onClose={() => setCreateOpen(false)}
          onSubmit={(payload) => createMutation.mutate(payload)}
        />
      ) : null}
    </section>
  )
}

function PromoteDialog({ employees, isLoadingEmployees, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState({
    employee_id: '',
    role: 'DATABASE_ADMIN',
    can_write_data: false,
  })
  const employeeOptions = employees.map((employee) => ({
    value: employee.id,
    label: employee.identity.full_name,
    description: employee.identity.email,
    badge: employee.employment.unit,
    searchText: `${employee.employment.employee_id} ${employee.employment.job_position}`,
  }))

  function handleSubmit(event) {
    event.preventDefault()
    if (!values.employee_id) {
      showErrorToast('Employee is required.')
      return
    }
    onSubmit({
      employee_id: values.employee_id,
      role: values.role,
      can_write_data: values.role === 'DATABASE_ADMIN' ? values.can_write_data : undefined,
    })
  }

  return (
    <CrudDialog
      title="Promote Employee"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="promote-admin-form" type="submit" disabled={isSubmitting}>
            Promote
          </Button>
        </>
      }
    >
      <form id="promote-admin-form" className="space-y-4" onSubmit={handleSubmit}>
        <Field label="Employee">
          <SearchableSelect
            value={values.employee_id}
            onChange={(employeeId) => setValues({ ...values, employee_id: employeeId })}
            options={employeeOptions}
            placeholder={isLoadingEmployees ? 'Loading employees...' : 'Select employee'}
            searchPlaceholder="Search employee"
            emptyLabel="No active employees found"
            disabled={isLoadingEmployees}
            searchableThreshold={1}
            required
          />
        </Field>
        <Field label="Role">
          <SelectInput
            value={values.role}
            onChange={(event) =>
              setValues({
                ...values,
                role: event.target.value,
                can_write_data:
                  event.target.value === 'DATABASE_ADMIN' ? values.can_write_data : false,
              })
            }
          >
            {adminRoles.map((role) => (
              <option key={role} value={role}>
                {formatStatus(role)}
              </option>
            ))}
          </SelectInput>
        </Field>
        <CheckboxField
          label="Allow database writes"
          description="Only applies to Database Admin accounts."
          checked={values.can_write_data}
          disabled={values.role !== 'DATABASE_ADMIN'}
          onChange={(event) =>
            setValues({ ...values, can_write_data: event.target.checked })
          }
        />
      </form>
    </CrudDialog>
  )
}

function GrantDialog({ admin, isSubmitting, onClose, onSubmit }) {
  const [minutes, setMinutes] = useState(60)

  function handleSubmit(event) {
    event.preventDefault()
    const parsed = Number(minutes)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 240) {
      showErrorToast('Grant duration must be between 1 and 240 minutes.')
      return
    }
    onSubmit(parsed)
  }

  return (
    <CrudDialog
      title="Grant After-Hours Write"
      description={admin.email}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="after-hours-form" type="submit" disabled={isSubmitting}>
            Grant
          </Button>
        </>
      }
    >
      <form id="after-hours-form" className="space-y-4" onSubmit={handleSubmit}>
        <Field label="Duration">
          <SelectInput
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
          >
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={120}>2 hours</option>
            <option value={240}>4 hours</option>
          </SelectInput>
        </Field>
      </form>
    </CrudDialog>
  )
}

function WorkingDayDialog({ isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState({ date: '', reason: '' })

  function handleSubmit(event) {
    event.preventDefault()
    onSubmit(
      cleanPayload({
        date: values.date,
        reason: trimmedOrUndefined(values.reason),
      }),
    )
  }

  return (
    <CrudDialog
      title="Add Working Saturday"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="working-day-form" type="submit" disabled={isSubmitting}>
            Add
          </Button>
        </>
      }
    >
      <form id="working-day-form" className="space-y-4" onSubmit={handleSubmit}>
        <Field label="Date">
          <TextInput
            required
            type="date"
            value={values.date}
            onChange={(event) => setValues({ ...values, date: event.target.value })}
          />
        </Field>
        <Field label="Reason">
          <TextAreaInput
            value={values.reason}
            onChange={(event) => setValues({ ...values, reason: event.target.value })}
          />
        </Field>
      </form>
    </CrudDialog>
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

function PermissionToggle({ label, checked, disabled, onChange }) {
  return (
    <label className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--mws-muted)]">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[var(--mws-burgundy)]"
      />
      {label}
    </label>
  )
}

function roleTone(role) {
  if (role === 'SUPER_ADMIN') return 'red'
  if (role === 'DATABASE_ADMIN') return 'amber'
  return 'neutral'
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
