import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Ban,
  CalendarPlus,
  Clock3,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  DebouncedSearchInput,
  Field,
  FilterSelect,
  SearchableSelect,
  SelectInput,
  TextAreaInput,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { SortableHeader } from "../../../components/ui/SortableHeader.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { cleanPayload, trimmedOrUndefined } from "../../../lib/form.js";
import { formatDate, formatStatus } from "../../../lib/format.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { employeesApi } from "../../employees/api/employeesApi.js";
import { adminRoles, adminUsersApi, workingDaysApi } from "../api/accessApi.js";

const tabs = [
  { id: "admins", label: "Admin Users" },
  { id: "working-days", label: "Working Saturdays" },
];

export function AccessPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = tabs.some((tab) => tab.id === searchParams.get("tab"))
    ? searchParams.get("tab")
    : "admins";
  const { user } = useAuth();

  function setTab(tab) {
    setSearchParams({ tab });
  }

  if (user?.role !== "SUPER_ADMIN") {
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
    );
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
            variant={activeTab === tab.id ? "primary" : "secondary"}
            onClick={() => setTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === "working-days" ? (
        <WorkingDaysPanel />
      ) : (
        <AdminUsersPanel />
      )}
    </div>
  );
}

function AdminUsersPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    search: "",
    role: "",
    is_active: "",
    sort_by: "created_at",
    sort_order: "desc",
  });
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [grantDialog, setGrantDialog] = useState(null);

  const queryParams = useMemo(
    () => ({
      ...params,
      is_active: params.is_active === "" ? undefined : params.is_active,
    }),
    [params],
  );

  const adminsQuery = useQuery({
    queryKey: ["admin-users", queryParams],
    queryFn: () => adminUsersApi.list(queryParams),
  });
  const employeesQuery = useQuery({
    queryKey: ["access-promotable-employees"],
    queryFn: () =>
      employeesApi.list({
        page: 1,
        size: 100,
        status: "ACTIVE",
        sort_by: "full_name",
        sort_order: "asc",
      }),
  });

  const promoteMutation = useMutation({
    mutationFn: adminUsersApi.promote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setPromoteOpen(false);
      showSuccessToast("Employee promoted to admin.");
    },
  });
  const demoteMutation = useMutation({
    mutationFn: adminUsersApi.demote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      showSuccessToast("Admin access deactivated.");
    },
  });
  const reactivateMutation = useMutation({
    mutationFn: async (admin) => {
      const response = await employeesApi.list({
        page: 1,
        size: 10,
        search: admin.email,
        status: "ACTIVE",
      });
      const employee = (response.data || []).find(
        (record) => record.identity.email === admin.email,
      );

      if (!employee) {
        throw new Error("Active employee with the same email was not found.");
      }

      return adminUsersApi.promote({
        employee_id: employee.id,
        role: admin.role,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      showSuccessToast("Admin access reactivated.");
    },
  });
  const changeRoleMutation = useMutation({
    mutationFn: ({ id, role }) => adminUsersApi.changeRole(id, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      showSuccessToast("Admin role updated.");
    },
  });
  const sensitiveMutation = useMutation({
    mutationFn: ({ id, value }) =>
      adminUsersApi.setCanViewSensitiveData(id, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      showSuccessToast("Sensitive-data permission updated.");
    },
  });
  const allUnitsMutation = useMutation({
    mutationFn: ({ id, value }) => adminUsersApi.setCanViewAllUnits(id, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      showSuccessToast("Cross-unit visibility updated.");
    },
  });
  const employeePiiMutation = useMutation({
    mutationFn: ({ id, value }) =>
      adminUsersApi.setCanViewEmployeePii(id, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      showSuccessToast("Employee PII permission updated.");
    },
  });
  const writeEmployeeDataMutation = useMutation({
    mutationFn: ({ id, value }) =>
      adminUsersApi.setCanWriteEmployeeData(id, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      showSuccessToast("Employee data write permission updated.");
    },
  });
  const writeStudentDataMutation = useMutation({
    mutationFn: ({ id, value }) =>
      adminUsersApi.setCanWriteStudentData(id, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      showSuccessToast("Student data write permission updated.");
    },
  });
  const grantMutation = useMutation({
    mutationFn: ({ id, minutes }) => adminUsersApi.grantAfterHours(id, minutes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setGrantDialog(null);
      showSuccessToast("After-hours write grant applied.");
    },
  });

  const paging = adminsQuery.data?.paging || {
    current_page: params.page,
    total_page: 1,
    total_item: 0,
    size: params.size,
  };
  const employees = employeesQuery.data?.data || [];

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }));
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 });
  }

  async function togglePermission(mutation, admin, value, label) {
    const action = value ? "Grant" : "Revoke";
    if (
      await confirm({
        title: `${action} ${label}`,
        description: `${action} "${label}" permission for ${admin.email}?`,
        confirmLabel: action,
        tone: value ? undefined : "danger",
      })
    ) {
      mutation.mutate({ id: admin.id, value });
    }
  }

  async function handleDemote(admin) {
    if (
      await confirm({
        title: "Deactivate admin access",
        description: `Deactivate admin access for ${admin.email}?`,
        confirmLabel: "Deactivate",
        tone: "danger",
      })
    ) {
      demoteMutation.mutate(admin.id);
    }
  }

  async function handleChangeRole(admin) {
    const targetRole =
      admin.role === "DATABASE_ADMIN" ? "VIEWER" : "DATABASE_ADMIN";
    const description =
      targetRole === "VIEWER"
        ? `Change ${admin.email} from Database Admin to Viewer? Their write permissions (Write Employee Data / Write Student Data) will be cleared.`
        : `Change ${admin.email} from Viewer to Database Admin? Write permissions stay disabled until granted separately.`;

    if (
      await confirm({
        title: "Change admin role",
        description,
        confirmLabel: "Change Role",
        tone: targetRole === "VIEWER" ? "danger" : undefined,
      })
    ) {
      changeRoleMutation.mutate({ id: admin.id, role: targetRole });
    }
  }

  async function handleReactivate(admin) {
    if (
      await confirm({
        title: "Reactivate admin access",
        description: `Reactivate admin access for ${admin.email}?`,
        confirmLabel: "Reactivate",
      })
    ) {
      reactivateMutation.mutate(admin);
    }
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--mws-line)] p-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 xl:max-w-lg">
          <DebouncedSearchInput
            value={params.search}
            placeholder="Search Admin Name Or Email"
            className="min-w-0 flex-1"
            onChange={(search) => resetPageAndUpdate({ search })}
          />
          <StatusBadge
            tone={adminsQuery.isFetching ? "amber" : "green"}
            className="shrink-0"
          >
            {adminsQuery.isFetching ? "Syncing" : "Live"}
          </StatusBadge>
        </div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:flex xl:flex-wrap xl:items-end xl:justify-end xl:gap-2">
          <FilterSelect
            label="Role"
            value={params.role}
            onChange={(value) => resetPageAndUpdate({ role: value })}
            options={[
              { value: "", label: "All Roles" },
              ...adminRoles.map((role) => ({
                value: role,
                label: formatStatus(role),
              })),
            ]}
          />
          <FilterSelect
            label="Status"
            value={params.is_active}
            onChange={(value) => resetPageAndUpdate({ is_active: value })}
            options={[
              { value: "", label: "All Statuses" },
              { value: "true", label: "Active" },
              { value: "false", label: "Inactive" },
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
              <HeaderCell
                label="Name"
                column="full_name"
                params={params}
                onSort={resetPageAndUpdate}
              />
              <HeaderCell
                label="Email"
                column="email"
                params={params}
                onSort={resetPageAndUpdate}
              />
              <HeaderCell
                label="Role"
                column="role"
                params={params}
                onSort={resetPageAndUpdate}
              />
              <th className="px-4 py-3">Permissions</th>
              <th className="px-4 py-3">After-Hours Grant</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {adminsQuery.isLoading ? (
              <tr>
                <td
                  className="px-4 py-10 text-center text-[var(--mws-muted)]"
                  colSpan={7}
                >
                  Loading admin users...
                </td>
              </tr>
            ) : (adminsQuery.data?.data || []).length === 0 ? (
              <tr>
                <td
                  className="px-4 py-10 text-center text-[var(--mws-muted)]"
                  colSpan={7}
                >
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
                    <p className="text-xs text-[var(--mws-muted)]">
                      {admin.admin_no}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-[var(--mws-charcoal)]">
                    <span className="block max-w-72 truncate">
                      {admin.email}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={roleTone(admin.role)}>
                      {formatStatus(admin.role)}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                      <PermissionToggle
                        label="Sensitive"
                        checked={Boolean(admin.can_view_sensitive_data)}
                        disabled={
                          !admin.is_active ||
                          admin.role === "SUPER_ADMIN" ||
                          (sensitiveMutation.isPending &&
                            sensitiveMutation.variables?.id === admin.id)
                        }
                        onChange={(value) =>
                          togglePermission(
                            sensitiveMutation,
                            admin,
                            value,
                            "Sensitive",
                          )
                        }
                      />
                      <PermissionToggle
                        label="All Units"
                        checked={Boolean(admin.can_view_all_units)}
                        disabled={
                          !admin.is_active ||
                          admin.role === "SUPER_ADMIN" ||
                          (allUnitsMutation.isPending &&
                            allUnitsMutation.variables?.id === admin.id)
                        }
                        onChange={(value) =>
                          togglePermission(
                            allUnitsMutation,
                            admin,
                            value,
                            "All Units",
                          )
                        }
                      />
                      <PermissionToggle
                        label="Employee PII"
                        checked={Boolean(admin.can_view_employee_pii)}
                        disabled={
                          !admin.is_active ||
                          admin.role === "SUPER_ADMIN" ||
                          (employeePiiMutation.isPending &&
                            employeePiiMutation.variables?.id === admin.id)
                        }
                        onChange={(value) =>
                          togglePermission(
                            employeePiiMutation,
                            admin,
                            value,
                            "Employee PII",
                          )
                        }
                      />
                      <PermissionToggle
                        label="Write Employee Data"
                        checked={Boolean(admin.can_write_employee_data)}
                        disabled={
                          admin.role !== "DATABASE_ADMIN" ||
                          !admin.is_active ||
                          (writeEmployeeDataMutation.isPending &&
                            writeEmployeeDataMutation.variables?.id ===
                              admin.id)
                        }
                        onChange={(value) =>
                          togglePermission(
                            writeEmployeeDataMutation,
                            admin,
                            value,
                            "Write Employee Data",
                          )
                        }
                      />
                      <PermissionToggle
                        label="Write Student Data"
                        checked={Boolean(admin.can_write_student_data)}
                        disabled={
                          admin.role !== "DATABASE_ADMIN" ||
                          !admin.is_active ||
                          (writeStudentDataMutation.isPending &&
                            writeStudentDataMutation.variables?.id ===
                              admin.id)
                        }
                        onChange={(value) =>
                          togglePermission(
                            writeStudentDataMutation,
                            admin,
                            value,
                            "Write Student Data",
                          )
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
                        admin.role !== "DATABASE_ADMIN" ||
                        (!admin.can_write_employee_data &&
                          !admin.can_write_student_data) ||
                        !admin.is_active
                      }
                      onClick={() => setGrantDialog(admin)}
                    >
                      <Clock3 size={15} />
                      Grant
                    </Button>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={admin.is_active ? "green" : "red"}>
                      {admin.is_active ? "Active" : "Inactive"}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {admin.is_active ? (
                      <div className="flex items-center justify-end gap-1">
                        {admin.role !== "SUPER_ADMIN" ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={
                              changeRoleMutation.isPending &&
                              changeRoleMutation.variables?.id === admin.id
                            }
                            onClick={() => handleChangeRole(admin)}
                          >
                            <ArrowLeftRight size={15} />
                            {admin.role === "DATABASE_ADMIN"
                              ? "Make Viewer"
                              : "Make DB Admin"}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={admin.role === "SUPER_ADMIN"}
                          onClick={() => handleDemote(admin)}
                        >
                          <Ban size={15} />
                          Demote
                        </Button>
                      </div>
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
          onSubmit={(minutes) =>
            grantMutation.mutate({ id: grantDialog.id, minutes })
          }
        />
      ) : null}
    </section>
  );
}

function WorkingDaysPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [createOpen, setCreateOpen] = useState(false);

  const workingDaysQuery = useQuery({
    queryKey: ["working-days"],
    queryFn: workingDaysApi.list,
  });
  const createMutation = useMutation({
    mutationFn: workingDaysApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["working-days"] });
      setCreateOpen(false);
      showSuccessToast("Working Saturday added.");
    },
  });
  const deleteMutation = useMutation({
    mutationFn: workingDaysApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["working-days"] });
      showSuccessToast("Working Saturday removed.");
    },
  });

  async function handleDelete(day) {
    if (
      await confirm({
        title: "Remove working Saturday",
        description: `Remove working Saturday on ${formatDate(day.date)}?`,
        confirmLabel: "Remove",
        tone: "danger",
      })
    ) {
      deleteMutation.mutate(day.id);
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
          <StatusBadge tone={workingDaysQuery.isFetching ? "amber" : "green"}>
            {workingDaysQuery.isFetching ? "Syncing" : "Live"}
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
                <td
                  className="px-4 py-10 text-center text-[var(--mws-muted)]"
                  colSpan={4}
                >
                  Loading working Saturdays...
                </td>
              </tr>
            ) : (workingDaysQuery.data || []).length === 0 ? (
              <tr>
                <td
                  className="px-4 py-10 text-center text-[var(--mws-muted)]"
                  colSpan={4}
                >
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
                  <td className="px-4 py-3 text-[var(--mws-muted)]">
                    {day.reason || "-"}
                  </td>
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
  );
}

function PromoteDialog({
  employees,
  isLoadingEmployees,
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const [values, setValues] = useState({
    employee_id: "",
    role: "DATABASE_ADMIN",
  });
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const employeeError =
    hasAttemptedSubmit && !values.employee_id
      ? "Employee is required."
      : undefined;
  const employeeOptions = employees.map((employee) => ({
    value: employee.id,
    label: employee.identity.full_name,
    description: employee.identity.email,
    badge: employee.employment.unit,
    searchText: `${employee.employment.employee_id} ${employee.employment.job_position}`,
  }));

  function handleSubmit(event) {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    if (!values.employee_id) return;
    onSubmit({
      employee_id: values.employee_id,
      role: values.role,
    });
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
          <Button
            form="promote-admin-form"
            type="submit"
            disabled={isSubmitting}
          >
            Promote
          </Button>
        </>
      }
    >
      <form
        id="promote-admin-form"
        className="space-y-4"
        onSubmit={handleSubmit}
        noValidate
      >
        <Field label="Employee" error={employeeError}>
          <SearchableSelect
            value={values.employee_id}
            onChange={(employeeId) =>
              setValues({ ...values, employee_id: employeeId })
            }
            options={employeeOptions}
            placeholder={
              isLoadingEmployees ? "Loading employees..." : "Select employee"
            }
            searchPlaceholder="Search Employee"
            emptyLabel="No active employees found"
            disabled={isLoadingEmployees}
            searchableThreshold={1}
            required={hasAttemptedSubmit}
          />
        </Field>
        <Field
          label="Role"
          hint={
            values.role === "DATABASE_ADMIN"
              ? 'Write access starts disabled - grant "Write Employee Data" and/or "Write Student Data" from the table below after promoting.'
              : undefined
          }
        >
          <SelectInput
            value={values.role}
            onChange={(event) =>
              setValues({ ...values, role: event.target.value })
            }
          >
            {adminRoles.map((role) => (
              <option key={role} value={role}>
                {formatStatus(role)}
              </option>
            ))}
          </SelectInput>
        </Field>
      </form>
    </CrudDialog>
  );
}

function GrantDialog({ admin, isSubmitting, onClose, onSubmit }) {
  const [minutes, setMinutes] = useState(60);

  function handleSubmit(event) {
    event.preventDefault();
    const parsed = Number(minutes);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 240) {
      showErrorToast("Grant duration must be between 1 and 240 minutes.");
      return;
    }
    onSubmit(parsed);
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
      <form
        id="after-hours-form"
        className="space-y-4"
        onSubmit={handleSubmit}
        noValidate
      >
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
  );
}

function WorkingDayDialog({ isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState({ date: "", reason: "" });
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const dateError =
    hasAttemptedSubmit && !values.date ? "Date is required." : undefined;

  function handleSubmit(event) {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    if (!values.date) return;
    onSubmit(
      cleanPayload({
        date: values.date,
        reason: trimmedOrUndefined(values.reason),
      }),
    );
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
      <form
        id="working-day-form"
        className="space-y-4"
        onSubmit={handleSubmit}
        noValidate
      >
        <Field label="Date" error={dateError}>
          <TextInput
            invalid={Boolean(dateError)}
            type="date"
            value={values.date}
            onChange={(event) =>
              setValues({ ...values, date: event.target.value })
            }
          />
        </Field>
        <Field label="Reason">
          <TextAreaInput
            value={values.reason}
            onChange={(event) =>
              setValues({ ...values, reason: event.target.value })
            }
          />
        </Field>
      </form>
    </CrudDialog>
  );
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
  );
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
  );
}

function roleTone(role) {
  if (role === "SUPER_ADMIN") return "red";
  if (role === "DATABASE_ADMIN") return "amber";
  return "neutral";
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
