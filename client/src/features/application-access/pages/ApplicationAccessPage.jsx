import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { ActionsMenu, ActionsMenuItem } from "../../../components/ui/ActionsMenu.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { DenseTable, denseCellClass, denseRowClass } from "../../../components/ui/DenseTable.jsx";
import {
  DebouncedSearchInput,
  Field,
  SelectInput,
  TextAreaInput,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { PageHint } from "../../../components/ui/PageHint.jsx";
import { PaginatedSingleSelect } from "../../../components/ui/PaginatedSingleSelect.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { formatDate } from "../../../lib/format.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { employeesApi } from "../../employees/api/employeesApi.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";

const tabs = [
  { id: "entitlements", label: "Entitlements" },
  { id: "roles", label: "Roles" },
];

const statusOptions = [
  { value: "true", label: "Active" },
  { value: "false", label: "Revoked" },
  { value: "", label: "All" },
];

export function ApplicationAccessPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = tabs.some((tab) => tab.id === searchParams.get("tab"))
    ? searchParams.get("tab")
    : "entitlements";

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-w-0">
        <PageHeader title="Application Access" />
        <PanelMessage>Only Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="Application Access"
        description="Who can open each application and with which role. Roles are defined once here and every application reads them from Central."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            type="button"
            variant={activeTab === tab.id ? "primary" : "secondary"}
            onClick={() => setSearchParams({ tab: tab.id })}
          >
            {tab.label}
          </Button>
        ))}
      </div>
      {activeTab === "roles" ? <RolesPanel /> : <EntitlementsPanel />}
      <PageHint id="application-access-source-of-truth">
        Roles are exact, uppercase keys such as ADMIN. An application cannot invent its own role,
        it only receives the one set here.
      </PageHint>
    </div>
  );
}

function useRoles() {
  return useQuery({
    queryKey: ["application-access", "roles"],
    queryFn: () => applicationAccessApi.listRoles(),
  });
}

function EntitlementsPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [filters, setFilters] = useState({ application_id: "", is_active: "true", search: "" });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [grantOpen, setGrantOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  const rolesQuery = useRoles();
  const roles = rolesQuery.data || [];
  const applications = [...new Set(roles.map((role) => role.application_id))].sort();

  const query = useQuery({
    queryKey: ["application-access", "entitlements", { ...filters, page, size }],
    queryFn: () =>
      applicationAccessApi.listEntitlements({
        application_id: filters.application_id || undefined,
        is_active: filters.is_active === "" ? undefined : filters.is_active,
        search: filters.search || undefined,
        page,
        size,
      }),
    placeholderData: (previous) => previous,
  });
  const rows = query.data?.data || [];
  const paging = query.data?.paging;

  function setFilter(patch) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["application-access"] });

  const revokeMutation = useMutation({
    mutationFn: (id) => applicationAccessApi.revoke(id),
    onSuccess: () => {
      invalidate();
      showSuccessToast("Access revoked.");
    },
    onError: (error) => showErrorToast(error, "Could not revoke this access."),
  });

  const restoreMutation = useMutation({
    mutationFn: (row) =>
      applicationAccessApi.grant({
        person_id: row.person_id,
        application_id: row.application_id,
        organization_id: row.organization_id,
        role: row.role,
      }),
    onSuccess: () => {
      invalidate();
      showSuccessToast("Access restored.");
    },
    onError: (error) => showErrorToast(error, "Could not restore this access."),
  });

  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <DebouncedSearchInput
            value={filters.search}
            onChange={(search) => setFilter({ search })}
            placeholder="Search by name or email"
          />
        </div>
        <Field label="Application" className="w-48">
          <SelectInput
            value={filters.application_id}
            onChange={(event) => setFilter({ application_id: event.target.value })}
          >
            <option value="">All applications</option>
            {applications.map((application) => (
              <option key={application} value={application}>
                {application}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Status" className="w-40">
          <SelectInput
            value={filters.is_active}
            onChange={(event) => setFilter({ is_active: event.target.value })}
          >
            {statusOptions.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Button type="button" onClick={() => setGrantOpen(true)}>
          <Plus size={16} />
          Grant Access
        </Button>
      </div>

      {query.isLoading ? (
        <PanelMessage>Loading access…</PanelMessage>
      ) : rows.length === 0 ? (
        <PanelMessage>No access matches these filters.</PanelMessage>
      ) : (
        <DenseTable
          dimmed={query.isPlaceholderData}
          minWidth={900}
          head={
            <>
              <th className="px-4 py-2.5">Person</th>
              <th className="px-4 py-2.5">Application</th>
              <th className="px-4 py-2.5">Organization</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Granted</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </>
          }
          footer={
            paging && paging.total_item > 0 ? (
              <PaginationBar
                paging={paging}
                itemLabel="entitlements"
                isLoading={query.isFetching}
                onPrevious={() => setPage((current) => Math.max(current - 1, 1))}
                onNext={() => setPage((current) => current + 1)}
                onPageSizeChange={(nextSize) => {
                  setSize(nextSize);
                  setPage(1);
                }}
              />
            ) : null
          }
        >
          {rows.map((row) => (
            <tr key={row.id} className={denseRowClass}>
              <td className={`${denseCellClass} max-w-56`}>
                <span className="block truncate font-semibold text-(--mws-charcoal)">
                  {row.person.full_name}
                </span>
                <span className="block truncate text-xs text-(--mws-muted)">
                  {row.person.email}
                  {row.person.unit ? ` · ${row.person.unit}` : ""}
                </span>
              </td>
              <td className={denseCellClass}>{row.application_id}</td>
              <td className={denseCellClass}>{row.organization_id}</td>
              <td className={denseCellClass}>
                <span title={row.permissions.join(", ")}>{row.role}</span>
              </td>
              <td className={denseCellClass}>
                <StatusBadge tone={row.is_active ? "green" : "neutral"}>
                  {row.is_active ? "Active" : "Revoked"}
                </StatusBadge>
              </td>
              <td className={`${denseCellClass} whitespace-nowrap text-xs text-(--mws-muted)`}>
                {formatDate(row.granted_at)}
              </td>
              <td className={`${denseCellClass} text-right`}>
                <ActionsMenu label={`Actions for ${row.person.email} on ${row.application_id}`}>
                  {(closeMenu) =>
                    row.is_active ? (
                      <>
                        <ActionsMenuItem
                          onClick={() => {
                            closeMenu();
                            setEditTarget(row);
                          }}
                        >
                          Change role
                        </ActionsMenuItem>
                        <ActionsMenuItem
                          tone="danger"
                          onClick={async () => {
                            closeMenu();
                            const confirmed = await confirm({
                              title: "Revoke access",
                              description: `${row.person.full_name} will no longer be able to open ${row.application_id}.`,
                              confirmLabel: "Revoke",
                            });
                            if (confirmed) revokeMutation.mutate(row.id);
                          }}
                        >
                          Revoke
                        </ActionsMenuItem>
                      </>
                    ) : (
                      <ActionsMenuItem
                        onClick={() => {
                          closeMenu();
                          restoreMutation.mutate(row);
                        }}
                      >
                        Restore with the same role
                      </ActionsMenuItem>
                    )
                  }
                </ActionsMenu>
              </td>
            </tr>
          ))}
        </DenseTable>
      )}

      {grantOpen ? (
        <GrantDialog roles={roles} onClose={() => setGrantOpen(false)} onDone={invalidate} />
      ) : null}
      {editTarget ? (
        <ChangeRoleDialog
          entitlement={editTarget}
          roles={roles}
          onClose={() => setEditTarget(null)}
          onDone={invalidate}
        />
      ) : null}
    </section>
  );
}

function RolePermissions({ role }) {
  if (!role) return null;
  return (
    <p className="text-xs text-(--mws-muted)">
      {role.permissions.length === 0
        ? "This role has no permissions."
        : `Permissions: ${role.permissions.join(", ")}`}
    </p>
  );
}

function GrantDialog({ roles, onClose, onDone }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [personId, setPersonId] = useState("");
  const [application, setApplication] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [organization, setOrganization] = useState("");
  const [attempted, setAttempted] = useState(false);

  const employeesQuery = useQuery({
    queryKey: ["application-access", "employees", { search, page, pageSize }],
    queryFn: () =>
      employeesApi.list({ status: "ACTIVE", search: search || undefined, page, size: pageSize }),
    placeholderData: (previous) => previous,
  });
  const employees = employeesQuery.data?.data || [];
  const options = employees.map((employee) => ({
    value: employee.person_id,
    label: employee.identity.full_name,
    description: employee.identity.email,
    badge: employee.employment?.unit,
  }));

  const applications = [...new Set(roles.map((role) => role.application_id))].sort();
  const roleOptions = roles.filter((role) => role.application_id === application && role.is_active);
  const selectedRole = roleOptions.find((role) => role.key === roleKey);

  const mutation = useMutation({
    mutationFn: () =>
      applicationAccessApi.grant({
        person_id: personId,
        application_id: application,
        organization_id: organization.trim(),
        role: roleKey,
      }),
    onSuccess: () => {
      onDone();
      showSuccessToast("Access granted.");
      onClose();
    },
    onError: (error) => showErrorToast(error, "Could not grant this access."),
  });

  function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (!personId || !application || !roleKey || !organization.trim()) return;
    mutation.mutate();
  }

  return (
    <CrudDialog
      title="Grant Access"
      description="Pick an active employee, an application and one of its roles."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="grant-access-form" type="submit" loading={mutation.isPending}>
            Grant
          </Button>
        </>
      }
    >
      <form id="grant-access-form" className="space-y-4" onSubmit={submit} noValidate>
        <Field label="Employee" error={attempted && !personId ? "Employee is required." : undefined}>
          <PaginatedSingleSelect
            itemLabel="employee"
            isLoading={employeesQuery.isFetching}
            value={personId}
            paging={
              employeesQuery.data?.paging || {
                current_page: page,
                total_page: 1,
                total_item: employees.length,
                size: pageSize,
              }
            }
            search={search}
            onChange={setPersonId}
            onSearchChange={(next) => {
              setSearch(next);
              setPage(1);
            }}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPage(1);
            }}
            options={options}
            emptyMessage="No active employees match."
          />
        </Field>
        <Field label="Application" error={attempted && !application ? "Application is required." : undefined}>
          <SelectInput
            value={application}
            onChange={(event) => {
              setApplication(event.target.value);
              setRoleKey("");
            }}
          >
            <option value="">Select an application</option>
            {applications.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Role" error={attempted && !roleKey ? "Role is required." : undefined}>
          <SelectInput
            value={roleKey}
            disabled={!application}
            onChange={(event) => setRoleKey(event.target.value)}
          >
            <option value="">Select a role</option>
            {roleOptions.map((role) => (
              <option key={role.id} value={role.key}>
                {role.key}
              </option>
            ))}
          </SelectInput>
          <RolePermissions role={selectedRole} />
        </Field>
        <Field
          label="Organization ID"
          hint="The organization this person belongs to inside that application."
          error={attempted && !organization.trim() ? "Organization ID is required." : undefined}
        >
          <TextInput value={organization} onChange={(event) => setOrganization(event.target.value)} />
        </Field>
      </form>
    </CrudDialog>
  );
}

function ChangeRoleDialog({ entitlement, roles, onClose, onDone }) {
  const [roleKey, setRoleKey] = useState(entitlement.role);
  const options = roles.filter(
    (role) => role.application_id === entitlement.application_id && role.is_active,
  );
  const selectedRole = options.find((role) => role.key === roleKey);

  const mutation = useMutation({
    mutationFn: () => applicationAccessApi.updateEntitlement(entitlement.id, { role: roleKey }),
    onSuccess: () => {
      onDone();
      showSuccessToast("Role changed.");
      onClose();
    },
    onError: (error) => showErrorToast(error, "Could not change the role."),
  });

  return (
    <CrudDialog
      title="Change Role"
      description={`${entitlement.person.full_name} on ${entitlement.application_id}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={mutation.isPending}
            disabled={roleKey === entitlement.role}
            onClick={() => mutation.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Role">
        <SelectInput value={roleKey} onChange={(event) => setRoleKey(event.target.value)}>
          {options.map((role) => (
            <option key={role.id} value={role.key}>
              {role.key}
            </option>
          ))}
        </SelectInput>
        <RolePermissions role={selectedRole} />
      </Field>
    </CrudDialog>
  );
}

function RolesPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const rolesQuery = useRoles();
  const roles = rolesQuery.data || [];
  const [dialog, setDialog] = useState(null);

  const toggleMutation = useMutation({
    mutationFn: (role) => applicationAccessApi.updateRole(role.id, { is_active: !role.is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["application-access"] });
      showSuccessToast("Role updated.");
    },
    onError: (error) => showErrorToast(error, "Could not update this role."),
  });

  return (
    <section className="min-w-0 space-y-4">
      <div className="flex justify-end">
        <Button type="button" onClick={() => setDialog({ mode: "create" })}>
          <Plus size={16} />
          Add Role
        </Button>
      </div>
      {rolesQuery.isLoading ? (
        <PanelMessage>Loading roles…</PanelMessage>
      ) : roles.length === 0 ? (
        <PanelMessage>No roles are defined yet.</PanelMessage>
      ) : (
        <DenseTable
          minWidth={800}
          head={
            <>
              <th className="px-4 py-2.5">Application</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Label</th>
              <th className="px-4 py-2.5">Permissions</th>
              <th className="px-4 py-2.5">In use</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </>
          }
        >
          {roles.map((role) => (
            <tr key={role.id} className={denseRowClass}>
              <td className={denseCellClass}>{role.application_id}</td>
              <td className={`${denseCellClass} font-semibold text-(--mws-charcoal)`}>{role.key}</td>
              <td className={denseCellClass}>{role.label}</td>
              <td className={denseCellClass} title={role.permissions.join(", ")}>
                {role.permissions.length}
              </td>
              <td className={denseCellClass}>{role.active_entitlement_count}</td>
              <td className={denseCellClass}>
                <StatusBadge tone={role.is_active ? "green" : "neutral"}>
                  {role.is_active ? "Active" : "Inactive"}
                </StatusBadge>
              </td>
              <td className={`${denseCellClass} text-right`}>
                <ActionsMenu label={`Actions for ${role.application_id} ${role.key}`}>
                  {(closeMenu) => (
                    <>
                      <ActionsMenuItem
                        onClick={() => {
                          closeMenu();
                          setDialog({ mode: "edit", role });
                        }}
                      >
                        Edit
                      </ActionsMenuItem>
                      <ActionsMenuItem
                        tone={role.is_active ? "danger" : undefined}
                        onClick={async () => {
                          closeMenu();
                          if (role.is_active) {
                            const confirmed = await confirm({
                              title: "Deactivate role",
                              description: `${role.key} can no longer be granted for ${role.application_id}.`,
                              confirmLabel: "Deactivate",
                            });
                            if (!confirmed) return;
                          }
                          toggleMutation.mutate(role);
                        }}
                      >
                        {role.is_active ? "Deactivate" : "Activate"}
                      </ActionsMenuItem>
                    </>
                  )}
                </ActionsMenu>
              </td>
            </tr>
          ))}
        </DenseTable>
      )}
      {dialog ? (
        <RoleDialog
          dialog={dialog}
          applications={[...new Set(roles.map((role) => role.application_id))].sort()}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  );
}

function RoleDialog({ dialog, applications, onClose }) {
  const queryClient = useQueryClient();
  const isEdit = dialog.mode === "edit";
  const role = dialog.role;
  const [application, setApplication] = useState(role?.application_id || "");
  const [key, setKey] = useState(role?.key || "");
  const [label, setLabel] = useState(role?.label || "");
  const [permissionText, setPermissionText] = useState((role?.permissions || []).join("\n"));
  const [attempted, setAttempted] = useState(false);

  const permissions = permissionText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const changesPermissions =
    isEdit && permissions.join("\n") !== (role.permissions || []).join("\n");

  const mutation = useMutation({
    mutationFn: () =>
      isEdit
        ? applicationAccessApi.updateRole(role.id, { label: label.trim(), permissions })
        : applicationAccessApi.createRole({
            application_id: application.trim(),
            key: key.trim(),
            label: label.trim(),
            permissions,
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["application-access"] });
      showSuccessToast(isEdit ? "Role updated." : "Role added.");
      onClose();
    },
    onError: (error) => showErrorToast(error, "Could not save this role."),
  });

  function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (!label.trim() || (!isEdit && (!application.trim() || !key.trim()))) return;
    mutation.mutate();
  }

  return (
    <CrudDialog
      title={isEdit ? `Edit ${role.key}` : "Add Role"}
      description={
        changesPermissions && role.active_entitlement_count > 0
          ? `${role.active_entitlement_count} active entitlement(s) hold this role and will get the new permissions right away.`
          : "Role keys are exact and uppercase, for example ADMIN or SUPPORT_STAFF."
      }
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="role-form" type="submit" loading={mutation.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="role-form" className="space-y-4" onSubmit={submit} noValidate>
        {isEdit ? null : (
          <>
            <Field
              label="Application ID"
              hint="Lowercase, for example exima. Pick an existing one or type a new one."
              error={attempted && !application.trim() ? "Application is required." : undefined}
            >
              <TextInput
                list="application-ids"
                value={application}
                onChange={(event) => setApplication(event.target.value)}
              />
              <datalist id="application-ids">
                {applications.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
            <Field
              label="Role key"
              error={attempted && !key.trim() ? "Role key is required." : undefined}
            >
              <TextInput value={key} onChange={(event) => setKey(event.target.value)} />
            </Field>
          </>
        )}
        <Field label="Label" error={attempted && !label.trim() ? "Label is required." : undefined}>
          <TextInput value={label} maxLength={64} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <Field label="Permissions" hint="One permission per line.">
          <TextAreaInput
            rows={6}
            value={permissionText}
            onChange={(event) => setPermissionText(event.target.value)}
          />
        </Field>
      </form>
    </CrudDialog>
  );
}
