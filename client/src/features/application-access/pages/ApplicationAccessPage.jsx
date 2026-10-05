import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { ActionsMenu, ActionsMenuItem } from "../../../components/ui/ActionsMenu.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { DenseTable, denseCellClass, denseRowClass } from "../../../components/ui/DenseTable.jsx";
import {
  DebouncedSearchInput,
  Field,
  FilterSelect,
  SearchableSelect,
} from "../../../components/ui/FormControls.jsx";
import { PageHint } from "../../../components/ui/PageHint.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { formatDate } from "../../../lib/format.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { useApplicationRoles } from "../hooks/useApplicationRoles.js";
import { useOrganizations } from "../hooks/useOrganizations.js";
import { copyText } from "../utils/copyText.js";
import { audienceLabels } from "../utils/groupFilterState.js";

const tabs = [
  { id: "access", label: "Access" },
  { id: "roles", label: "Roles" },
];

const statusOptions = [
  { value: "true", label: "Active" },
  { value: "false", label: "Off or Revoked" },
  { value: "", label: "All Statuses" },
];

const typeOptions = [
  { value: "", label: "Everyone and People" },
  { value: "GROUP", label: "Groups" },
  { value: "PERSON", label: "People" },
];

export function ApplicationAccessPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = tabs.some((tab) => tab.id === searchParams.get("tab"))
    ? searchParams.get("tab")
    : "access";

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
      {activeTab === "roles" ? <RolesPanel /> : <AccessPanel />}
      <PageHint id="application-access-source-of-truth">
        Start with a baseline for each application: a group for everyone with all units, positions and
        levels. Then add people or narrower groups only when they need a different role. The most specific
        access wins: the person, then job position, job level, unit, and the baseline last. Someone who
        is blocked stays blocked even if a group covers them. To remove a baseline, handle the specific
        access under it first.
      </PageHint>
    </div>
  );
}

const useRoles = useApplicationRoles;

function whoSummary(group) {
  const parts = [
    group.units.length ? `Units: ${group.units.map((item) => item.name).join(", ")}` : "All Units",
  ];
  if (group.job_positions.length) {
    parts.push(`Positions: ${group.job_positions.map((item) => item.name).join(", ")}`);
  }
  if (group.job_levels.length) {
    parts.push(`Levels: ${group.job_levels.map((item) => item.name).join(", ")}`);
  }
  return parts.join(" · ");
}

function AccessPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [filters, setFilters] = useState({ application_id: "", kind: "", is_active: "true", search: "" });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const navigate = useNavigate();
  const [editPerson, setEditPerson] = useState(null);

  const rolesQuery = useRoles();
  const roles = rolesQuery.data || [];
  const applications = [...new Set(roles.map((role) => role.application_id))].sort();

  const query = useQuery({
    queryKey: ["application-access", "list", { ...filters, page, size }],
    queryFn: () =>
      applicationAccessApi.listAccess({
        application_id: filters.application_id || undefined,
        kind: filters.kind || undefined,
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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["application-access"] });

  const revokeMutation = useMutation({
    mutationFn: (id) => applicationAccessApi.revoke(id),
    onSuccess: () => {
      invalidate();
      showSuccessToast("Access blocked.");
    },
    onError: (error) => showErrorToast(error, "Could not block this access."),
  });

  const removeMutation = useMutation({
    mutationFn: (id) => applicationAccessApi.removeEntitlement(id),
    onSuccess: () => {
      invalidate();
      showSuccessToast("Own access removed.");
    },
    onError: (error) => showErrorToast(error, "Could not remove this access."),
  });

  const restoreMutation = useMutation({
    mutationFn: (row) =>
      applicationAccessApi.grant({
        person_id: row.person.person_id,
        application_id: row.application_id,
        organization_id: row.organization_id,
        role: row.role,
      }),
    onSuccess: () => {
      invalidate();
      showSuccessToast("Access unblocked.");
    },
    onError: (error) => showErrorToast(error, "Could not unblock this access."),
  });

  const groupMutation = useMutation({
    mutationFn: ({ id, patch }) => applicationAccessApi.updateRule(id, patch),
    onSuccess: () => {
      invalidate();
      showSuccessToast("Group access updated.");
    },
    onError: (error) => showErrorToast(error, "Could not update this group access."),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (id) => applicationAccessApi.deleteRule(id),
    onSuccess: () => {
      invalidate();
      showSuccessToast("Group access deleted.");
    },
    onError: (error) => showErrorToast(error, "Could not delete this group access."),
  });

  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <DebouncedSearchInput
            value={filters.search}
            onChange={(search) => setFilter({ search })}
            placeholder="Search by name, email or application"
          />
        </div>
        <FilterSelect
          label="Application"
          value={filters.application_id}
          onChange={(value) => setFilter({ application_id: value })}
          options={[
            { value: "", label: "All Applications" },
            ...applications.map((application) => ({ value: application, label: application })),
          ]}
        />
        <FilterSelect
          label="Type"
          value={filters.kind}
          onChange={(value) => setFilter({ kind: value })}
          options={typeOptions}
        />
        <FilterSelect
          label="Status"
          value={filters.is_active}
          onChange={(value) => setFilter({ is_active: value })}
          options={statusOptions}
        />
        <Button type="button" onClick={() => navigate("/application-access/grant")}>
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
              <th className="px-4 py-2.5">Who</th>
              <th className="px-4 py-2.5">Application</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Organization</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Granted</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </>
          }
          footer={
            paging && paging.total_item > 0 ? (
              <PaginationBar
                paging={paging}
                itemLabel="access entries"
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
          {rows.map((row) => {
            const isGroup = row.kind === "GROUP";
            const label = isGroup ? audienceLabels[row.group.audience] : row.person.full_name;
            return (
              <tr key={`${row.kind}:${row.id}`} className={denseRowClass}>
                <td className={`${denseCellClass} max-w-72`}>
                  <span className="block truncate font-semibold text-(--mws-charcoal)">{label}</span>
                  <span
                    className="block truncate text-xs text-(--mws-muted)"
                    title={isGroup ? whoSummary(row.group) : undefined}
                  >
                    {isGroup
                      ? whoSummary(row.group)
                      : `${row.person.email}${row.person.unit ? ` · ${row.person.unit}` : ""}`}
                  </span>
                </td>
                <td className={denseCellClass}>{row.application_id}</td>
                <td className={denseCellClass}>
                  <span title={row.permissions.join(", ")}>{row.role}</span>
                </td>
                <td className={denseCellClass}>{row.organization_id}</td>
                <td className={denseCellClass}>
                  <StatusBadge tone={row.is_active ? "green" : "neutral"}>
                    {row.is_active ? "Active" : isGroup ? "Off" : "Blocked"}
                  </StatusBadge>
                </td>
                <td className={`${denseCellClass} whitespace-nowrap text-xs text-(--mws-muted)`}>
                  {formatDate(row.granted_at)}
                </td>
                <td className={`${denseCellClass} text-right`}>
                  <ActionsMenu label={`Actions for ${label} on ${row.application_id}`}>
                    {(closeMenu) =>
                      isGroup ? (
                        <>
                          <ActionsMenuItem
                            onClick={() => {
                              closeMenu();
                              navigate(`/application-access/groups/${row.id}`);
                            }}
                          >
                            Edit
                          </ActionsMenuItem>
                          <ActionsMenuItem
                            onClick={() => {
                              closeMenu();
                              groupMutation.mutate({ id: row.id, patch: { is_active: !row.is_active } });
                            }}
                          >
                            {row.is_active ? "Turn off" : "Turn on"}
                          </ActionsMenuItem>
                          <ActionsMenuItem
                            tone="danger"
                            onClick={async () => {
                              closeMenu();
                              const confirmed = await confirm({
                                title: "Delete group access",
                                description: `${label} will no longer get ${row.role} on ${row.application_id}.`,
                                confirmLabel: "Delete",
                              });
                              if (confirmed) deleteGroupMutation.mutate(row.id);
                            }}
                          >
                            Delete
                          </ActionsMenuItem>
                        </>
                      ) : row.is_active ? (
                        <>
                          <ActionsMenuItem
                            onClick={() => {
                              closeMenu();
                              setEditPerson(row);
                            }}
                          >
                            Change role
                          </ActionsMenuItem>
                          <ActionsMenuItem
                            onClick={async () => {
                              closeMenu();
                              const confirmed = await confirm({
                                title: "Remove own access",
                                description: `${row.person.full_name} falls back to group access on ${row.application_id}, or loses access if no group covers them.`,
                                confirmLabel: "Remove",
                              });
                              if (confirmed) removeMutation.mutate(row.id);
                            }}
                          >
                            Remove
                          </ActionsMenuItem>
                          <ActionsMenuItem
                            tone="danger"
                            onClick={async () => {
                              closeMenu();
                              const confirmed = await confirm({
                                title: "Block access",
                                description: `${row.person.full_name} will not be able to open ${row.application_id}, even if a group covers them.`,
                                confirmLabel: "Block",
                              });
                              if (confirmed) revokeMutation.mutate(row.id);
                            }}
                          >
                            Block access
                          </ActionsMenuItem>
                        </>
                      ) : (
                        <>
                          <ActionsMenuItem
                            onClick={() => {
                              closeMenu();
                              restoreMutation.mutate(row);
                            }}
                          >
                            Unblock
                          </ActionsMenuItem>
                          <ActionsMenuItem
                            onClick={async () => {
                              closeMenu();
                              const confirmed = await confirm({
                                title: "Remove own access",
                                description: `${row.person.full_name} falls back to group access on ${row.application_id}, or loses access if no group covers them.`,
                                confirmLabel: "Remove",
                              });
                              if (confirmed) removeMutation.mutate(row.id);
                            }}
                          >
                            Remove
                          </ActionsMenuItem>
                        </>
                      )
                    }
                  </ActionsMenu>
                </td>
              </tr>
            );
          })}
        </DenseTable>
      )}

      {editPerson ? (
        <ChangeRoleDialog
          entitlement={{ ...editPerson, person: editPerson.person }}
          roles={roles}
          onClose={() => setEditPerson(null)}
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
        <SearchableSelect
          value={roleKey}
          onChange={setRoleKey}
          options={options.map((role) => ({ value: role.key, label: role.key, description: role.label }))}
          placeholder="Select a role"
          searchPlaceholder="Search role"
        />
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
  const applications = [...new Set(roles.map((role) => role.application_id))].sort();
  const navigate = useNavigate();
  const organizations = useOrganizations().data || [];

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
      <div className="space-y-3">
        <div>
          <h2 className="font-display text-lg font-bold text-(--mws-charcoal)">Organization IDs</h2>
          <p className="text-sm text-(--mws-muted)">
            Each application has one Organization ID, created automatically. Map it in the application so it
            recognises its people.
          </p>
        </div>
        {applications.length === 0 ? null : (
          <DenseTable
            minWidth={600}
            head={
              <>
                <th className="px-4 py-2.5">Application</th>
                <th className="px-4 py-2.5">Organization ID</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </>
            }
          >
            {applications.map((application) => {
              const organization = organizations.find((item) => item.application_id === application);
              return (
                <tr key={application} className={denseRowClass}>
                  <td className={`${denseCellClass} font-semibold text-(--mws-charcoal)`}>{application}</td>
                  <td className={denseCellClass}>
                    {organization ? <code className="text-sm">{organization.organization_id}</code> : "-"}
                  </td>
                  <td className={`${denseCellClass} text-right`}>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!organization}
                      aria-label={`Copy Organization ID of ${application}`}
                      onClick={() => copyText(organization.organization_id)}
                    >
                      Copy
                    </Button>
                  </td>
                </tr>
              );
            })}
          </DenseTable>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-(--mws-charcoal)">Roles</h2>
          <Button type="button" onClick={() => navigate("/application-access/roles/new")}>
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
                            navigate(`/application-access/roles/${role.id}`);
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
      </div>

    </section>
  );
}
