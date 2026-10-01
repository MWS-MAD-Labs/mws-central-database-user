import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Ban,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Eye,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import {
  ActionsMenu,
  ActionsMenuItem,
} from "../../../components/ui/ActionsMenu.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  DateField,
  DebouncedSearchInput,
  Field,
  FilterSelect,
  SearchableSelect,
  TextAreaInput,
} from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { PaginatedSingleSelect } from "../../../components/ui/PaginatedSingleSelect.jsx";
import { SortableHeader } from "../../../components/ui/SortableHeader.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { LiveIndicator } from "../../../components/ui/LiveIndicator.jsx";
import { FilterResetButton } from "../../../components/ui/FilterResetButton.jsx";
import { cleanPayload, trimmedOrUndefined } from "../../../lib/form.js";
import {
  adminRoleTone,
  formatDate,
  formatStatus,
} from "../../../lib/format.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { fetchAllPages } from "../../../lib/pagination.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { changeRequestsApi } from "../../change-requests/api/changeRequestsApi.js";
import { gradesApi } from "../../academic/api/academicApi.js";
import { employeesApi } from "../../employees/api/employeesApi.js";
import { unitsApi } from "../../master-data/api/masterDataApi.js";
import {
  distinctGradeUnits,
  isOperationalUnit,
} from "../../master-data/utils/pcActivityUnits.js";
import { auditLogsApi } from "../../audit/api/auditLogsApi.js";
import { AuditDiffTable } from "../../audit/pages/AuditLogsPage.jsx";
import { adminRoles, adminUsersApi, workingDaysApi } from "../api/accessApi.js";

const tabs = [
  { id: "admins", label: "Admin Users" },
  { id: "working-days", label: "Working Saturdays" },
];

function buildPermissionsPayload(admin, patch = {}) {
  return {
    can_view_student_data: Boolean(admin.can_view_student_data),
    can_view_employee_data: Boolean(admin.can_view_employee_data),
    can_view_employee_disciplinary_data: Boolean(
      admin.can_view_employee_disciplinary_data,
    ),
    can_view_sensitive_data: Boolean(admin.can_view_sensitive_data),
    can_view_employee_pii: Boolean(admin.can_view_employee_pii),
    can_view_all_student_units: Boolean(admin.can_view_all_student_units),
    can_view_all_employee_units: Boolean(admin.can_view_all_employee_units),
    student_view_unit_ids: admin.student_view_unit_ids || [],
    employee_view_unit_ids: admin.employee_view_unit_ids || [],
    can_write_student_data: Boolean(admin.can_write_student_data),
    can_write_employee_data: Boolean(admin.can_write_employee_data),
    can_manage_enrollments: Boolean(admin.can_manage_enrollments),
    can_manage_teacher_assignments: Boolean(
      admin.can_manage_teacher_assignments,
    ),
    ...patch,
  };
}

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
        <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-6 text-sm text-(--mws-muted)">
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
  const { user } = useAuth();
  const approverStatusQuery = useQuery({
    queryKey: ["change-requests", "approver-status"],
    queryFn: () => changeRequestsApi.approverStatus(),
  });
  const noEmployeeApprover =
    approverStatusQuery.data && !approverStatusQuery.data.employee;
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
  const [historyAdmin, setHistoryAdmin] = useState(null);
  const [unitScopeDialog, setUnitScopeDialog] = useState(null);

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
  const demoteSuperAdminMutation = useMutation({
    mutationFn: ({ id, role }) => adminUsersApi.demoteSuperAdmin(id, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      showSuccessToast("Super Admin demoted.");
    },
  });
  const permissionsMutation = useMutation({
    mutationFn: ({ id, permissions }) =>
      adminUsersApi.updatePermissions(id, permissions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      showSuccessToast("Access permissions updated.");
    },
  });
  const approverMutation = useMutation({
    mutationFn: ({ id, value }) =>
      adminUsersApi.setCanApproveIdentifierChanges(id, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      showSuccessToast("Approver access updated.");
    },
    onError: (error) => showErrorToast(error, "Could not update approver."),
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
  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }));
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 });
  }

  function resetFilters() {
    resetPageAndUpdate({
      search: "",
      role: "",
      is_active: "",
      sort_by: "created_at",
      sort_order: "desc",
    });
  }
  const hasActiveFilters = Boolean(
    params.search || params.role || params.is_active,
  );

  async function toggleAccessPermission(admin, field, value, label) {
    const action = value ? "Grant" : "Revoke";
    const revokedDependencies = !value
      ? {
          can_view_student_data: [
            "Sensitive student data",
            "Manage Enrollments",
            "Write Student Data",
          ],
          can_view_employee_data: [
            "Employee PII",
            "Employee Disciplinary Data",
            "Manage Teacher Assignments",
            "Write Employee Data",
          ],
        }[field] || []
      : [];
    if (
      !(await confirm({
        title: `${action} ${label}`,
        description: (
          <>
            <p>
              {action} "{label}" permission for {admin.email}?
            </p>
            {revokedDependencies.length > 0 ? (
              <div className="mt-3 rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]">
                <p className="font-semibold">This also revokes:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {revokedDependencies.map((dependency) => (
                    <li key={dependency}>{dependency}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-2 text-sm text-(--mws-muted)">
                Required parent access will be enabled automatically.
              </p>
            )}
          </>
        ),
        confirmLabel: action,
        tone: value ? undefined : "danger",
      }))
    ) {
      return;
    }

    permissionsMutation.mutate({
      id: admin.id,
      permissions: buildPermissionsPayload(admin, {
        [field]: value,
      }),
    });
  }

  async function toggleApprover(admin, value) {
    const confirmed = await confirm({
      title: value ? "Make approver" : "Remove approver",
      description: value
        ? `Let ${admin.email} approve or reject identifier change requests? For employee data they also need the Head of CARE position.`
        : `Stop ${admin.email} from approving identifier change requests?`,
      confirmLabel: value ? "Make approver" : "Remove",
      tone: value ? undefined : "danger",
    });
    if (confirmed) approverMutation.mutate({ id: admin.id, value });
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
    const roleLabel = { DATABASE_ADMIN: "Database Admin", VIEWER: "Viewer" };
    const clearedPermissions =
      targetRole === "VIEWER"
        ? [
            ["Write Employee Data", admin.can_write_employee_data],
            ["Write Student Data", admin.can_write_student_data],
            [
              "Manage Teacher Assignments",
              admin.can_manage_teacher_assignments,
            ],
            ["Manage Enrollments", admin.can_manage_enrollments],
            ["After-hours Write Grant", admin.after_hours_write_until],
          ].filter(([, enabled]) => Boolean(enabled))
        : [];
    const keptPermissions = [
      ["View Employees & Interns", admin.can_view_employee_data],
      ["Employee PII", admin.can_view_employee_pii],
      ["Employee Disciplinary Data", admin.can_view_employee_disciplinary_data],
      ["View Students", admin.can_view_student_data],
      ["Sensitive Student Data", admin.can_view_sensitive_data],
      ["All Student Units", admin.can_view_all_student_units],
      ["All Employee Units", admin.can_view_all_employee_units],
    ].filter(([, enabled]) => Boolean(enabled));

    if (
      await confirm({
        title: "Change admin role",
        description: (
          <>
            <p>Change role for {admin.email}?</p>
            <div className="mt-3 overflow-hidden rounded-xl border border-(--mws-line)">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-(--mws-line) bg-(--mws-soft) px-3 py-2">
                <span className="text-sm font-medium text-(--mws-muted)">
                  Role
                </span>
                <span className="text-sm font-semibold text-(--mws-charcoal)">
                  {roleLabel[admin.role]}{" "}
                  <span className="text-(--mws-muted)">→</span>{" "}
                  {roleLabel[targetRole]}
                </span>
              </div>
              {targetRole === "VIEWER" ? (
                <>
                  <RoleChangePermissionList
                    title="Will be cleared"
                    items={clearedPermissions}
                    emptyLabel="No active write or task permissions"
                    tone="danger"
                  />
                  <RoleChangePermissionList
                    title="Will be kept (view only)"
                    items={keptPermissions}
                    emptyLabel="No view permissions"
                  />
                </>
              ) : (
                <div className="px-3 py-3 text-sm text-(--mws-muted)">
                  View permissions stay unchanged. Write and task permissions
                  remain disabled until granted.
                </div>
              )}
            </div>
          </>
        ),
        confirmLabel: "Change Role",
        tone: targetRole === "VIEWER" ? "danger" : undefined,
      })
    ) {
      changeRoleMutation.mutate({ id: admin.id, role: targetRole });
    }
  }

  async function handleDemoteSuperAdmin(admin) {
    if (
      await confirm({
        title: "Demote Super Admin",
        description: `Demote ${admin.email} from Super Admin to Database Admin? They'll keep the account, just lose Super Admin access.`,
        confirmLabel: "Demote",
        tone: "danger",
      })
    ) {
      demoteSuperAdminMutation.mutate({ id: admin.id, role: "DATABASE_ADMIN" });
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
    <section className="min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      {noEmployeeApprover ? (
        <div
          role="status"
          className="border-b border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]"
        >
          <p className="font-semibold">No approver for employee data changes yet.</p>
          <p className="mt-0.5">
            Requests to change a locked NIK, NPWP, bank or BPJS number can't be
            reviewed. Pick an admin who is linked to an employee with the Head of
            CARE position, then tick Change Request Approver in their Employee
            permissions. Requests filed earlier appear for them automatically.
          </p>
        </div>
      ) : null}
      <div className="border-b border-(--mws-line) p-4">
        <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <DebouncedSearchInput
            value={params.search}
            placeholder="Search Admin Name Or Email"
            className="xl:max-w-lg"
            onChange={(search) => resetPageAndUpdate({ search })}
          />
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <LiveIndicator isSyncing={adminsQuery.isFetching} />
            <FilterResetButton
              visible={hasActiveFilters}
              onReset={resetFilters}
            />
            <Button type="button" onClick={() => setPromoteOpen(true)}>
              <Plus size={16} />
              Promote
            </Button>
          </div>
        </div>

        <div className="mt-4 flex min-w-0 flex-wrap gap-3">
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
        </div>
      </div>

      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
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
              <th className="whitespace-nowrap px-4 py-3">After Hours</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {adminsQuery.isLoading ? (
              <tr>
                <td
                  className="px-4 py-10 text-center text-(--mws-muted)"
                  colSpan={7}
                >
                  Loading admin users...
                </td>
              </tr>
            ) : (adminsQuery.data?.data || []).length === 0 ? (
              <tr>
                <td
                  className="px-4 py-10 text-center text-(--mws-muted)"
                  colSpan={7}
                >
                  No admin users found.
                </td>
              </tr>
            ) : (
              adminsQuery.data.data.map((admin) => (
                <tr
                  key={admin.id}
                  className="border-t border-(--mws-line) bg-white hover:bg-(--mws-soft)"
                >
                  <td className="px-4 py-3">
                    <p className="font-display font-bold text-(--mws-charcoal)">
                      {admin.full_name}
                    </p>
                    <p className="text-xs text-(--mws-muted)">
                      {admin.admin_no}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-(--mws-charcoal)">
                    <span className="block max-w-72 truncate">
                      {admin.email}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge tone={adminRoleTone(admin.role)}>
                        {formatStatus(admin.role)}
                      </StatusBadge>
                      {admin.is_protected ? (
                        <StatusBadge
                          tone="gold"
                          title="Can never be demoted, deactivated, or modified by anyone, including other Super Admins"
                        >
                          Protected
                        </StatusBadge>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {admin.role === "SUPER_ADMIN" ? (
                      <StatusBadge tone="green">
                        <CheckCircle2 size={12} className="mr-1" />
                        All Permissions
                      </StatusBadge>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <PermissionGroupMenu
                          label="Student"
                          items={[
                            {
                              label: "View Students",
                              checked: Boolean(admin.can_view_student_data),
                              disabled:
                                !admin.is_active ||
                                permissionsMutation.isPending,
                              onToggle: (value) =>
                                toggleAccessPermission(
                                  admin,
                                  "can_view_student_data",
                                  value,
                                  "View Students",
                                ),
                            },
                            {
                              label: "Sensitive",
                              checked: Boolean(admin.can_view_sensitive_data),
                              disabled:
                                !admin.is_active ||
                                admin.role === "SUPER_ADMIN" ||
                                permissionsMutation.isPending,
                              onToggle: (value) =>
                                toggleAccessPermission(
                                  admin,
                                  "can_view_sensitive_data",
                                  value,
                                  "Sensitive",
                                ),
                            },
                            {
                              label: "Manage Enrollments",
                              checked: Boolean(admin.can_manage_enrollments),
                              disabled:
                                admin.role !== "DATABASE_ADMIN" ||
                                !admin.is_active ||
                                permissionsMutation.isPending,
                              onToggle: (value) =>
                                toggleAccessPermission(
                                  admin,
                                  "can_manage_enrollments",
                                  value,
                                  "Manage Enrollments",
                                ),
                            },
                            {
                              label: "Write Student Data",
                              checked: Boolean(admin.can_write_student_data),
                              disabled:
                                admin.role !== "DATABASE_ADMIN" ||
                                !admin.is_active ||
                                permissionsMutation.isPending,
                              onToggle: (value) =>
                                toggleAccessPermission(
                                  admin,
                                  "can_write_student_data",
                                  value,
                                  "Write Student Data",
                                ),
                            },
                          ]}
                        />
                        <UnitScopeControl
                          label="Student Units"
                          allUnits={admin.can_view_all_student_units}
                          unitIds={admin.student_view_unit_ids}
                          disabled={
                            !admin.is_active ||
                            !admin.can_view_student_data ||
                            permissionsMutation.isPending
                          }
                          onClick={() =>
                            setUnitScopeDialog({ admin, domain: "student" })
                          }
                        />
                        <PermissionGroupMenu
                          label="Employee"
                          items={[
                            {
                              label: "View Employees & Interns",
                              checked: Boolean(admin.can_view_employee_data),
                              disabled:
                                !admin.is_active ||
                                permissionsMutation.isPending,
                              onToggle: (value) =>
                                toggleAccessPermission(
                                  admin,
                                  "can_view_employee_data",
                                  value,
                                  "View Employees & Interns",
                                ),
                            },
                            {
                              label: "Employee PII",
                              checked: Boolean(admin.can_view_employee_pii),
                              disabled:
                                !admin.is_active ||
                                admin.role === "SUPER_ADMIN" ||
                                permissionsMutation.isPending,
                              onToggle: (value) =>
                                toggleAccessPermission(
                                  admin,
                                  "can_view_employee_pii",
                                  value,
                                  "Employee PII",
                                ),
                            },
                            ...(user?.is_protected &&
                            (admin.is_head_of_care ||
                              admin.is_identifier_change_approver)
                              ? [
                                  {
                                    label: "Change Request Approver",
                                    checked: Boolean(
                                      admin.is_identifier_change_approver,
                                    ),
                                    disabled:
                                      !admin.is_active ||
                                      admin.role === "VIEWER" ||
                                      approverMutation.isPending,
                                    onToggle: (value) =>
                                      toggleApprover(admin, value),
                                  },
                                ]
                              : []),
                            {
                              label: "Disciplinary Data",
                              checked: Boolean(
                                admin.can_view_employee_disciplinary_data,
                              ),
                              disabled:
                                !admin.is_active ||
                                permissionsMutation.isPending,
                              onToggle: (value) =>
                                toggleAccessPermission(
                                  admin,
                                  "can_view_employee_disciplinary_data",
                                  value,
                                  "Employee Disciplinary Data",
                                ),
                            },
                            {
                              label: "Manage Teacher Assignments",
                              checked: Boolean(
                                admin.can_manage_teacher_assignments,
                              ),
                              disabled:
                                admin.role !== "DATABASE_ADMIN" ||
                                !admin.is_active ||
                                permissionsMutation.isPending,
                              onToggle: (value) =>
                                toggleAccessPermission(
                                  admin,
                                  "can_manage_teacher_assignments",
                                  value,
                                  "Manage Teacher Assignments",
                                ),
                            },
                            {
                              label: "Write Employee Data",
                              checked: Boolean(admin.can_write_employee_data),
                              disabled:
                                admin.role !== "DATABASE_ADMIN" ||
                                !admin.is_active ||
                                permissionsMutation.isPending,
                              onToggle: (value) =>
                                toggleAccessPermission(
                                  admin,
                                  "can_write_employee_data",
                                  value,
                                  "Write Employee Data",
                                ),
                            },
                          ]}
                        />
                        <UnitScopeControl
                          label="Employee Units"
                          allUnits={admin.can_view_all_employee_units}
                          unitIds={admin.employee_view_unit_ids}
                          disabled={
                            !admin.is_active ||
                            !admin.can_view_employee_data ||
                            permissionsMutation.isPending
                          }
                          onClick={() =>
                            setUnitScopeDialog({ admin, domain: "employee" })
                          }
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {admin.after_hours_write_until &&
                      new Date(admin.after_hours_write_until) > new Date() ? (
                        <StatusBadge tone="amber">
                          <Clock3 size={12} className="mr-1" />
                          Until {formatDateTime(admin.after_hours_write_until)}
                        </StatusBadge>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={admin.is_active ? "green" : "red"}>
                      {admin.is_active ? "Active" : "Inactive"}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end">
                      <ActionsMenu label={`Actions for ${admin.email}`}>
                        {(closeMenu) => (
                          <>
                            <ActionsMenuItem
                              onClick={() => {
                                closeMenu();
                                setHistoryAdmin(admin);
                              }}
                            >
                              <span className="flex items-center gap-2">
                                <Eye size={15} />
                                History
                              </span>
                            </ActionsMenuItem>
                            {admin.is_active ? (
                              <>
                                <ActionsMenuItem
                                  disabled={
                                    admin.role !== "DATABASE_ADMIN" ||
                                    (!admin.can_write_employee_data &&
                                      !admin.can_write_student_data)
                                  }
                                  title={
                                    admin.role !== "DATABASE_ADMIN"
                                      ? "Only for Database Admins"
                                      : undefined
                                  }
                                  onClick={() => {
                                    closeMenu();
                                    setGrantDialog(admin);
                                  }}
                                >
                                  <span className="flex items-center gap-2">
                                    <Clock3 size={15} />
                                    Grant after-hours write
                                  </span>
                                </ActionsMenuItem>
                                {admin.role === "SUPER_ADMIN" ? (
                                  <ActionsMenuItem
                                    disabled={
                                      admin.is_protected ||
                                      (demoteSuperAdminMutation.isPending &&
                                        demoteSuperAdminMutation.variables
                                          ?.id === admin.id)
                                    }
                                    title={
                                      admin.is_protected
                                        ? "Protected, role can't be changed"
                                        : undefined
                                    }
                                    onClick={() => {
                                      closeMenu();
                                      handleDemoteSuperAdmin(admin);
                                    }}
                                  >
                                    <span className="flex items-center gap-2">
                                      <ArrowLeftRight size={15} />
                                      Make DB Admin
                                    </span>
                                  </ActionsMenuItem>
                                ) : (
                                  <ActionsMenuItem
                                    disabled={
                                      changeRoleMutation.isPending &&
                                      changeRoleMutation.variables?.id ===
                                        admin.id
                                    }
                                    onClick={() => {
                                      closeMenu();
                                      handleChangeRole(admin);
                                    }}
                                  >
                                    <span className="flex items-center gap-2">
                                      <ArrowLeftRight size={15} />
                                      {admin.role === "DATABASE_ADMIN"
                                        ? "Make Viewer"
                                        : "Make DB Admin"}
                                    </span>
                                  </ActionsMenuItem>
                                )}
                                <div className="my-1 border-t border-(--mws-line)" />
                                <ActionsMenuItem
                                  tone="danger"
                                  disabled={admin.is_protected}
                                  title={
                                    admin.is_protected
                                      ? "Protected, can't be deactivated"
                                      : undefined
                                  }
                                  onClick={() => {
                                    closeMenu();
                                    handleDemote(admin);
                                  }}
                                >
                                  <span className="flex items-center gap-2">
                                    <Ban size={15} />
                                    Demote
                                  </span>
                                </ActionsMenuItem>
                              </>
                            ) : (
                              <ActionsMenuItem
                                disabled={
                                  reactivateMutation.variables?.id === admin.id
                                }
                                onClick={() => {
                                  closeMenu();
                                  handleReactivate(admin);
                                }}
                              >
                                <span className="flex items-center gap-2">
                                  <RotateCcw size={15} />
                                  Reactivate
                                </span>
                              </ActionsMenuItem>
                            )}
                          </>
                        )}
                      </ActionsMenu>
                    </div>
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

      {historyAdmin ? (
        <AdminHistoryDialog
          admin={historyAdmin}
          onClose={() => setHistoryAdmin(null)}
        />
      ) : null}

      {unitScopeDialog ? (
        <UnitScopeDialog
          admin={unitScopeDialog.admin}
          domain={unitScopeDialog.domain}
          isSubmitting={permissionsMutation.isPending}
          onClose={() => setUnitScopeDialog(null)}
          onSubmit={(patch) =>
            permissionsMutation.mutate(
              {
                id: unitScopeDialog.admin.id,
                permissions: buildPermissionsPayload(
                  unitScopeDialog.admin,
                  patch,
                ),
              },
              { onSuccess: () => setUnitScopeDialog(null) },
            )
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
    <section className="min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="flex min-w-0 flex-col gap-3 border-b border-(--mws-line) p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
            <CalendarPlus size={19} />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-(--mws-charcoal)">
              Working Saturday Overrides
            </h2>
            <p className="text-sm text-(--mws-muted)">
              Only Saturdays can be added here.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LiveIndicator isSyncing={workingDaysQuery.isFetching} />
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            Saturday
          </Button>
        </div>
      </div>

      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
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
                  className="px-4 py-10 text-center text-(--mws-muted)"
                  colSpan={4}
                >
                  Loading working Saturdays...
                </td>
              </tr>
            ) : (workingDaysQuery.data || []).length === 0 ? (
              <tr>
                <td
                  className="px-4 py-10 text-center text-(--mws-muted)"
                  colSpan={4}
                >
                  No working Saturday overrides yet.
                </td>
              </tr>
            ) : (
              workingDaysQuery.data.map((day) => (
                <tr
                  key={day.id}
                  className="border-t border-(--mws-line) bg-white hover:bg-(--mws-soft)"
                >
                  <td className="px-4 py-3 font-semibold text-(--mws-charcoal)">
                    {formatDate(day.date)}
                  </td>
                  <td className="px-4 py-3 text-(--mws-muted)">
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

function PromoteDialog({ isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState({
    employee_id: "",
    role: "DATABASE_ADMIN",
  });
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeePage, setEmployeePage] = useState(1);
  const [employeePageSize, setEmployeePageSize] = useState(10);
  // Kept separately from the search-page results below, so the picked
  // employee's name/unit stay visible even after the user searches for
  // someone else without selecting them.
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const employeeError =
    hasAttemptedSubmit && !values.employee_id
      ? "Employee is required."
      : undefined;

  const employeesQuery = useQuery({
    queryKey: [
      "access-promotable-employees",
      { employeePage, employeePageSize, employeeSearch },
    ],
    queryFn: () =>
      adminUsersApi.listPromotableEmployees({
        page: employeePage,
        size: employeePageSize,
        search: employeeSearch || undefined,
      }),
    // Keep the rows on screen while the next page loads so the modal holds its size.
    placeholderData: (previous) => previous,
  });
  const employees = employeesQuery.data?.data || [];
  const employeeOptions = employees.map((employee) => ({
    value: employee.id,
    label: employee.full_name,
    description: `${employee.email} · ${employee.employee_id}`,
    badge: employee.unit,
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
            loading={isSubmitting}
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
          <PaginatedSingleSelect
            itemLabel="employee"
            isLoading={employeesQuery.isFetching}
            value={values.employee_id}
            paging={employeesQuery.data?.paging || {
              current_page: employeePage,
              total_page: 1,
              total_item: employees.length,
              size: employeePageSize,
            }}
            search={employeeSearch}
            onChange={(employeeId) => {
              const employee = employees.find((e) => e.id === employeeId);
              if (employee) setSelectedEmployee(employee);
              setValues({ ...values, employee_id: employeeId });
            }}
            onSearchChange={(search) => {
              setEmployeeSearch(search);
              setEmployeePage(1);
            }}
            onPageChange={setEmployeePage}
            onPageSizeChange={(size) => {
              setEmployeePageSize(size);
              setEmployeePage(1);
            }}
            options={employeeOptions}
            emptyMessage="No promotable employees match."
          />
        </Field>
        {selectedEmployee && values.role === "DATABASE_ADMIN" ? (
          <div className="rounded-xl border border-(--mws-line) bg-(--mws-soft) px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-(--mws-muted)">
              Admin Unit
            </p>
            <p className="mt-1 font-display text-sm font-bold text-(--mws-charcoal)">
              {selectedEmployee.unit}
            </p>
            <p className="mt-1 text-xs text-(--mws-muted)">
              Admin access will inherit this employee unit. Change the
              employee's unit first if this is incorrect.
            </p>
          </div>
        ) : null}
        <Field
          label="Role"
          hint={
            values.role === "DATABASE_ADMIN"
              ? 'Write access starts disabled. Grant "Write Employee Data" and/or "Write Student Data" from the table below after promoting.'
              : values.role === "SUPER_ADMIN"
                ? "Super Admin access applies across all units."
                : "Viewer access is read-only and is not restricted to an admin unit."
          }
        >
          <SearchableSelect
            value={values.role}
            onChange={(role) => setValues({ ...values, role })}
            options={adminRoles.map((role) => ({
              value: role,
              label: formatStatus(role),
            }))}
            placeholder="Select role"
            searchPlaceholder="Search role"
          />
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
          <Button form="after-hours-form" type="submit" loading={isSubmitting}>
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
          <SearchableSelect
            value={minutes}
            onChange={(value) => setMinutes(Number(value))}
            options={[
              { value: 30, label: "30 minutes" },
              { value: 60, label: "1 hour" },
              { value: 120, label: "2 hours" },
              { value: 240, label: "4 hours" },
            ]}
            placeholder="Select Duration"
          />
        </Field>
      </form>
    </CrudDialog>
  );
}

function AdminHistoryDialog({ admin, onClose }) {
  const historyQuery = useQuery({
    queryKey: ["admin-users", admin.id, "history"],
    queryFn: () =>
      auditLogsApi.list({
        entity_type: "AdminUser",
        search: admin.id,
        size: 50,
        sort_by: "created_at",
        sort_order: "desc",
      }),
  });
  const logs = historyQuery.data?.data || [];

  return (
    <CrudDialog
      title="Access History"
      description={admin.email}
      onClose={onClose}
    >
      {historyQuery.isLoading ? (
        <p className="py-6 text-center text-sm text-(--mws-muted)">
          Loading history...
        </p>
      ) : logs.length === 0 ? (
        <p className="py-6 text-center text-sm text-(--mws-muted)">
          No recorded role or permission changes for this admin.
        </p>
      ) : (
        <ul className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
          {logs.map((log) => (
            <li
              key={log.id}
              className="rounded-xl border border-(--mws-line) p-3"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <StatusBadge tone={historyActionTone(log.action)}>
                  {formatStatus(log.action)}
                </StatusBadge>
                <span className="text-xs text-(--mws-muted)">
                  {formatDateTime(log.created_at)}
                </span>
              </div>
              <AuditDiffTable
                oldValues={log.old_values}
                newValues={log.new_values}
                resolvedLabels={log.resolved_labels}
              />
            </li>
          ))}
        </ul>
      )}
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
          <Button form="working-day-form" type="submit" loading={isSubmitting}>
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
          <DateField
            invalid={Boolean(dateError)}
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

function PermissionGroupMenu({ label, items }) {
  const anyOn = items.some((item) => item.checked);
  const allDisabled = items.every((item) => item.disabled);

  return (
    <ActionsMenu
      label={`${label} permissions`}
      disabled={allDisabled}
      renderTrigger={({ onClick, isOpen }) => (
        <button
          type="button"
          onClick={onClick}
          disabled={allDisabled}
          className="inline-flex items-center gap-1.5 rounded-full border border-(--mws-line) bg-white px-2.5 py-1 text-xs font-semibold text-(--mws-charcoal) transition hover:border-(--mws-burgundy) disabled:cursor-not-allowed disabled:opacity-50"
        >
          {anyOn ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--mws-burgundy)" />
          ) : null}
          {label}
          <ChevronDown
            size={12}
            className={`shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        </button>
      )}
    >
      {(close) =>
        items.map((item) => (
          <ActionsMenuItem
            key={item.label}
            checked={item.checked}
            disabled={item.disabled}
            title={item.title}
            onClick={() => {
              item.onToggle(!item.checked);
              close();
            }}
          >
            {item.label}
          </ActionsMenuItem>
        ))
      }
    </ActionsMenu>
  );
}

function UnitScopeControl({ label, allUnits, unitIds = [], disabled, onClick }) {
  const detail = allUnits
    ? "All"
    : unitIds.length > 0
      ? `${unitIds.length} selected`
      : "Own";

  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? `Enable ${label === "Student Units" ? "View Students" : "View Employees & Interns"} first` : undefined}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-(--mws-line) bg-white px-2.5 py-1 text-xs font-semibold text-(--mws-charcoal) transition hover:border-(--mws-burgundy) disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--mws-burgundy)" />
      {label}: {detail}
    </button>
  );
}

function UnitScopeDialog({ admin, domain, isSubmitting, onClose, onSubmit }) {
  const isStudent = domain === "student";
  const allField = isStudent
    ? "can_view_all_student_units"
    : "can_view_all_employee_units";
  const idsField = isStudent
    ? "student_view_unit_ids"
    : "employee_view_unit_ids";
  const initialIds = admin[idsField] || [];
  const [mode, setMode] = useState(
    admin[allField] ? "all" : initialIds.length > 0 ? "custom" : "own",
  );
  const [selectedIds, setSelectedIds] = useState(initialIds);
  const unitsQuery = useQuery({
    queryKey: isStudent
      ? ["access-scope", "student-units"]
      : ["access-scope", "employee-units"],
    queryFn: isStudent
      ? () => fetchAllPages(gradesApi.list)
      : () => fetchAllPages(unitsApi.list),
  });
  const selectableUnits = isStudent
    ? distinctGradeUnits(unitsQuery.data?.data || [])
    : (unitsQuery.data?.data || []).filter(isOperationalUnit);
  const unitsById = new Map(selectableUnits.map((unit) => [unit.id, unit]));
  const units = [
    ...selectableUnits,
    ...initialIds
      .filter((id) => !unitsById.has(id))
      .map((id) => ({ id, name: `Unavailable unit (${id})` })),
  ];
  const title = isStudent ? "Student Units" : "Employee Units";

  function toggleUnit(unitId) {
    setSelectedIds((current) =>
      current.includes(unitId)
        ? current.filter((id) => id !== unitId)
        : [...current, unitId],
    );
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (mode === "custom" && selectedIds.length === 0) return;
    onSubmit({
      [allField]: mode === "all",
      [idsField]: mode === "custom" ? selectedIds : [],
    });
  }

  return (
    <CrudDialog
      title={title}
      description={`Choose which ${isStudent ? "academic" : "organization"} units ${admin.full_name || admin.email} can view and edit, based on their permissions.`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="unit-scope-form"
            type="submit"
            disabled={
              isSubmitting ||
              unitsQuery.isLoading ||
              (mode === "custom" && selectedIds.length === 0)
            }
            loading={isSubmitting}
          >
            Save Scope
          </Button>
        </>
      }
    >
      <form id="unit-scope-form" className="space-y-3" onSubmit={handleSubmit}>
        <ScopeModeOption
          label="Assigned unit only"
          description="Only the unit this admin is assigned to."
          checked={mode === "own"}
          onChange={() => setMode("own")}
        />
        <ScopeModeOption
          label={`Selected ${isStudent ? "academic" : "organization"} units`}
          description="Only the units on this list, for viewing and editing."
          checked={mode === "custom"}
          onChange={() => setMode("custom")}
        />
        {mode === "custom" ? (
          <div className="ml-7 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-(--mws-line) p-2">
            {unitsQuery.isLoading ? (
              <p className="px-2 py-3 text-sm text-(--mws-muted)">Loading units...</p>
            ) : units.length === 0 ? (
              <p className="px-2 py-3 text-sm text-(--mws-muted)">No units available.</p>
            ) : (
              units.map((unit) => (
                <label
                  key={unit.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-(--mws-charcoal) hover:bg-(--mws-soft)"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(unit.id)}
                    onChange={() => toggleUnit(unit.id)}
                    className="h-4 w-4 accent-(--mws-burgundy)"
                  />
                  {unit.name}
                </label>
              ))
            )}
          </div>
        ) : null}
        <ScopeModeOption
          label="All units"
          description="Every unit, for viewing and editing."
          checked={mode === "all"}
          onChange={() => setMode("all")}
        />
      </form>
    </CrudDialog>
  );
}

function ScopeModeOption({ label, description, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-(--mws-line) px-3 py-3 hover:bg-(--mws-soft)">
      <input
        type="radio"
        name="unit-scope-mode"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 accent-(--mws-burgundy)"
      />
      <span>
        <span className="block text-sm font-semibold text-(--mws-charcoal)">
          {label}
        </span>
        <span className="mt-0.5 block text-xs text-(--mws-muted)">
          {description}
        </span>
      </span>
    </label>
  );
}

function RoleChangePermissionList({ title, items, emptyLabel, tone }) {
  return (
    <div className="border-b border-(--mws-line) px-3 py-3 last:border-b-0">
      <p
        className={`text-xs font-bold uppercase tracking-wide ${tone === "danger" ? "text-[#a43c41]" : "text-(--mws-muted)"}`}
      >
        {title}
      </p>
      {items.length > 0 ? (
        <ul className="mt-1.5 space-y-1 text-sm text-(--mws-charcoal)">
          {items.map(([label]) => (
            <li key={label}>• {label}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-sm text-(--mws-muted)">{emptyLabel}</p>
      )}
    </div>
  );
}

function historyActionTone(action) {
  if (action.includes("DELETE") || action.includes("REVOKE")) return "red";
  if (action.includes("CREATE") || action.includes("LOGIN")) return "green";
  if (action.includes("ACCESS")) return "amber";
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
