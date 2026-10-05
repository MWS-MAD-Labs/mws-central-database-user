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
  CheckboxField,
  DebouncedSearchInput,
  Field,
  FilterSelect,
  SearchableSelect,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { PageHint } from "../../../components/ui/PageHint.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { enumOptions, formatDate } from "../../../lib/format.js";
import { showBulkFailureToast, showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { PaginatedCandidatePicker } from "../../academic/components/pc-activity-room/PaginatedCandidatePicker.jsx";
import { employeesApi, employmentTypes } from "../../employees/api/employeesApi.js";
import { loadEmployeeFormOptions } from "../../employees/api/employeeFormOptions.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";

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

const audienceLabels = {
  EMPLOYEES: "All Active Employees",
  STUDENTS: "All Active Students",
  EMPLOYEES_AND_STUDENTS: "All Active Employees and Students",
};

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
        Give access to people or to a group. If someone matches several, the most specific one wins:
        the person, then job position, job level, unit, and everyone last. A person who was revoked stays
        blocked even if a group covers them.
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
  const [grantOpen, setGrantOpen] = useState(false);
  const [editPerson, setEditPerson] = useState(null);
  const [editGroup, setEditGroup] = useState(null);

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
      showSuccessToast("Access revoked.");
    },
    onError: (error) => showErrorToast(error, "Could not revoke this access."),
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
      showSuccessToast("Access restored.");
    },
    onError: (error) => showErrorToast(error, "Could not restore this access."),
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
                    {row.is_active ? "Active" : isGroup ? "Off" : "Revoked"}
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
                              setEditGroup(row);
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
            );
          })}
        </DenseTable>
      )}

      {grantOpen ? (
        <GrantDialog roles={roles} onClose={() => setGrantOpen(false)} onDone={invalidate} />
      ) : null}
      {editPerson ? (
        <ChangeRoleDialog
          entitlement={{ ...editPerson, person: editPerson.person }}
          roles={roles}
          onClose={() => setEditPerson(null)}
          onDone={invalidate}
        />
      ) : null}
      {editGroup ? (
        <GroupEditDialog
          row={editGroup}
          roles={roles}
          onClose={() => setEditGroup(null)}
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

function MultiCheckList({ label, allLabel, items, value, onChange, hint }) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const shown = items.filter((item) => !needle || item.name.toLowerCase().includes(needle));

  function toggle(id) {
    onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  }

  return (
    <Field label={label} hint={hint}>
      <div className="space-y-2">
        {items.length > 12 ? (
          <TextInput
            value={filter}
            placeholder={`Search ${label.toLowerCase()}`}
            onChange={(event) => setFilter(event.target.value)}
          />
        ) : null}
        <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          <CheckboxField
            checked={value.length === 0}
            label={allLabel}
            onChange={(event) => {
              if (event.target.checked) onChange([]);
            }}
          />
          {shown.map((item) => (
            <CheckboxField
              key={item.id}
              checked={value.includes(item.id)}
              label={item.name}
              onChange={() => toggle(item.id)}
            />
          ))}
        </div>
      </div>
    </Field>
  );
}

// Unit, job position and job level filters of a group. Empty means all.
function GroupFilters({ audience, options, state }) {
  const { unitIds, setUnitIds, positionIds, setPositionIds, levelIds, setLevelIds } = state;
  const employeesOnly = audience !== "STUDENTS";
  return (
    <>
      <MultiCheckList
        label="Units"
        allLabel="All Units"
        items={(options.units || []).map((unit) => ({ id: unit.id, name: unit.name }))}
        value={unitIds}
        onChange={setUnitIds}
      />
      {employeesOnly ? (
        <>
          <MultiCheckList
            label="Job Positions"
            allLabel="All Positions"
            items={(options.jobPositions || []).map((item) => ({ id: item.id, name: item.name }))}
            value={positionIds}
            onChange={setPositionIds}
            hint="Only applies to employees."
          />
          <MultiCheckList
            label="Job Levels"
            allLabel="All Levels"
            items={(options.jobLevels || []).map((item) => ({ id: item.id, name: item.name }))}
            value={levelIds}
            onChange={setLevelIds}
            hint="Only applies to employees."
          />
        </>
      ) : null}
    </>
  );
}

function useGroupFilterState(initial = {}) {
  const [unitIds, setUnitIds] = useState(initial.unit_ids || []);
  const [positionIds, setPositionIds] = useState(initial.job_position_ids || []);
  const [levelIds, setLevelIds] = useState(initial.job_level_ids || []);
  return { unitIds, setUnitIds, positionIds, setPositionIds, levelIds, setLevelIds };
}

function GrantDialog({ roles, onClose, onDone }) {
  const [mode, setMode] = useState("PEOPLE");
  const [params, setParams] = useState({ page: 1, size: 10, search: "" });
  const [filter, setFilter] = useState({ unit_id: "", job_position_id: "", job_level_id: "", employment_type: "" });
  const [selected, setSelected] = useState(() => new Map());
  const [audience, setAudience] = useState("EMPLOYEES");
  const groupFilters = useGroupFilterState();
  const [application, setApplication] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [organization, setOrganization] = useState("");
  const [attempted, setAttempted] = useState(false);

  const optionsQuery = useQuery({
    queryKey: ["employee-form-options"],
    queryFn: loadEmployeeFormOptions,
  });
  const employeesQuery = useQuery({
    queryKey: ["application-access", "employees", params, filter],
    queryFn: () =>
      employeesApi.list({
        status: "ACTIVE",
        search: params.search || undefined,
        unit_id: filter.unit_id || undefined,
        job_position_id: filter.job_position_id || undefined,
        job_level_id: filter.job_level_id || undefined,
        employment_type: filter.employment_type || undefined,
        page: params.page,
        size: params.size,
      }),
    enabled: mode === "PEOPLE",
    placeholderData: (previous) => previous,
  });
  const rows = employeesQuery.data?.data || [];
  const paging = employeesQuery.data?.paging || {
    current_page: params.page,
    total_page: 1,
    total_item: rows.length,
    size: params.size,
  };
  const items = rows.map((employee) => ({
    id: employee.person_id,
    label: employee.identity.full_name,
    sublabel: [employee.identity.email, employee.employment?.unit, employee.employment?.job_position]
      .filter(Boolean)
      .join(" / "),
  }));

  function setFilterValue(patch) {
    setFilter((current) => ({ ...current, ...patch }));
    setParams((current) => ({ ...current, page: 1 }));
  }

  function toggle(item, checked) {
    setSelected((current) => {
      const next = new Map(current);
      if (checked) next.set(item.id, item);
      else next.delete(item.id);
      return next;
    });
  }

  function togglePage(checked, pageItems) {
    setSelected((current) => {
      const next = new Map(current);
      pageItems.forEach((item) => {
        if (checked) next.set(item.id, item);
        else next.delete(item.id);
      });
      return next;
    });
  }

  const applications = [...new Set(roles.map((role) => role.application_id))].sort();
  const roleOptions = roles.filter((role) => role.application_id === application && role.is_active);
  const selectedRole = roleOptions.find((role) => role.key === roleKey);
  const hasActiveFilter = Object.values(filter).some(Boolean);
  const options = optionsQuery.data || {};

  const peopleMutation = useMutation({
    mutationFn: () =>
      applicationAccessApi.bulkGrant({
        person_ids: Array.from(selected.keys()),
        application_id: application,
        organization_id: organization.trim(),
        role: roleKey,
      }),
    onSuccess: (result) => {
      onDone();
      if (result.success_count > 0) showSuccessToast(`Access granted to ${result.success_count} person(s).`);
      if (result.failed_count > 0) showBulkFailureToast("person(s) could not be granted", result);
      onClose();
    },
    onError: (error) => showErrorToast(error, "Could not grant this access."),
  });

  const groupMutation = useMutation({
    mutationFn: () =>
      applicationAccessApi.createRule({
        application_id: application,
        audience,
        unit_ids: groupFilters.unitIds,
        job_position_ids: audience === "STUDENTS" ? [] : groupFilters.positionIds,
        job_level_ids: audience === "STUDENTS" ? [] : groupFilters.levelIds,
        default_role_key: roleKey,
        organization_id: organization.trim(),
      }),
    onSuccess: () => {
      onDone();
      showSuccessToast("Group access added.");
      onClose();
    },
    onError: (error) => showErrorToast(error, "Could not add this group access."),
  });

  function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (!application || !roleKey || !organization.trim()) return;
    if (mode === "PEOPLE") {
      if (selected.size === 0) return;
      peopleMutation.mutate();
    } else {
      groupMutation.mutate();
    }
  }

  return (
    <CrudDialog
      title="Grant Access"
      description="Give access to specific people, or to a whole group such as every active employee."
      onClose={onClose}
      panelClassName="max-w-3xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="grant-access-form"
            type="submit"
            loading={peopleMutation.isPending || groupMutation.isPending}
          >
            Grant
          </Button>
        </>
      }
    >
      <form id="grant-access-form" className="space-y-4" onSubmit={submit} noValidate>
        <Field label="Who" hint="A group follows people automatically, new employees included.">
          <SearchableSelect
            value={mode}
            onChange={setMode}
            options={[
              { value: "PEOPLE", label: "Specific People" },
              { value: "GROUP", label: "A Group" },
            ]}
            placeholder="Select who"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Application" error={attempted && !application ? "Application is required." : undefined}>
            <SearchableSelect
              value={application}
              onChange={(value) => {
                setApplication(value);
                setRoleKey("");
              }}
              options={applications.map((item) => ({ value: item, label: item }))}
              placeholder="Select an application"
              searchPlaceholder="Search application"
            />
          </Field>
          <Field label="Role" error={attempted && !roleKey ? "Role is required." : undefined}>
            <SearchableSelect
              value={roleKey}
              disabled={!application}
              onChange={setRoleKey}
              options={roleOptions.map((role) => ({ value: role.key, label: role.key, description: role.label }))}
              placeholder="Select a role"
              searchPlaceholder="Search role"
            />
          </Field>
        </div>
        {selectedRole ? (
          <p className="-mt-2 text-xs text-(--mws-muted)">
            {selectedRole.permissions.length === 0
              ? "This role has no permissions."
              : `Permissions: ${selectedRole.permissions.join(", ")}`}
          </p>
        ) : null}
        <Field
          label="Organization ID"
          hint="Sent to the application with the role. It must match how the application names this organization, for Exima the value mapped with its db:map-central-organization script."
          error={attempted && !organization.trim() ? "Organization ID is required." : undefined}
        >
          <TextInput value={organization} onChange={(event) => setOrganization(event.target.value)} />
        </Field>

        {mode === "GROUP" ? (
          <>
            <Field label="Audience">
              <SearchableSelect
                value={audience}
                onChange={setAudience}
                options={Object.entries(audienceLabels).map(([value, label]) => ({ value, label }))}
                placeholder="Select an audience"
              />
            </Field>
            <GroupFilters audience={audience} options={options} state={groupFilters} />
          </>
        ) : (
          <Field
            label="People"
            error={attempted && selected.size === 0 ? "Pick at least one employee." : undefined}
          >
            <PaginatedCandidatePicker
              items={items}
              selected={selected}
              paging={paging}
              search={params.search}
              isLoading={employeesQuery.isLoading}
              emptyMessage="No active employees match."
              itemLabel="employee"
              filters={
                <div className="flex flex-wrap gap-3">
                  <FilterSelect
                    label="Unit"
                    value={filter.unit_id}
                    onChange={(value) => setFilterValue({ unit_id: value })}
                    options={[
                      { value: "", label: "All Units" },
                      ...(options.units || []).map((unit) => ({ value: unit.id, label: unit.name })),
                    ]}
                  />
                  <FilterSelect
                    label="Job Position"
                    value={filter.job_position_id}
                    onChange={(value) => setFilterValue({ job_position_id: value })}
                    options={[
                      { value: "", label: "All Positions" },
                      ...(options.jobPositions || []).map((item) => ({ value: item.id, label: item.name })),
                    ]}
                  />
                  <FilterSelect
                    label="Job Level"
                    value={filter.job_level_id}
                    onChange={(value) => setFilterValue({ job_level_id: value })}
                    options={[
                      { value: "", label: "All Levels" },
                      ...(options.jobLevels || []).map((item) => ({ value: item.id, label: item.name })),
                    ]}
                  />
                  <FilterSelect
                    label="Employment Type"
                    value={filter.employment_type}
                    onChange={(value) => setFilterValue({ employment_type: value })}
                    options={[{ value: "", label: "All Employment Types" }, ...enumOptions(employmentTypes)]}
                  />
                  {hasActiveFilter ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-end"
                      onClick={() => {
                        setFilter({ unit_id: "", job_position_id: "", job_level_id: "", employment_type: "" });
                        setParams((current) => ({ ...current, page: 1 }));
                      }}
                    >
                      Reset Filters
                    </Button>
                  ) : null}
                </div>
              }
              onSearchChange={(search) => setParams((current) => ({ ...current, page: 1, search }))}
              onToggle={toggle}
              onTogglePage={togglePage}
              onPageChange={(page) => setParams((current) => ({ ...current, page }))}
              onPageSizeChange={(nextSize) => setParams((current) => ({ ...current, page: 1, size: nextSize }))}
            />
          </Field>
        )}
      </form>
    </CrudDialog>
  );
}

function GroupEditDialog({ row, roles, onClose, onDone }) {
  const state = useGroupFilterState({
    unit_ids: row.group.units.map((item) => item.id),
    job_position_ids: row.group.job_positions.map((item) => item.id),
    job_level_ids: row.group.job_levels.map((item) => item.id),
  });
  const [roleKey, setRoleKey] = useState(row.role);
  const [organization, setOrganization] = useState(row.organization_id);
  const optionsQuery = useQuery({ queryKey: ["employee-form-options"], queryFn: loadEmployeeFormOptions });
  const roleOptions = roles.filter((role) => role.application_id === row.application_id && role.is_active);

  const mutation = useMutation({
    mutationFn: () =>
      applicationAccessApi.updateRule(row.id, {
        unit_ids: state.unitIds,
        job_position_ids: row.group.audience === "STUDENTS" ? [] : state.positionIds,
        job_level_ids: row.group.audience === "STUDENTS" ? [] : state.levelIds,
        default_role_key: roleKey,
        organization_id: organization.trim(),
      }),
    onSuccess: () => {
      onDone();
      showSuccessToast("Group access updated.");
      onClose();
    },
    onError: (error) => showErrorToast(error, "Could not update this group access."),
  });

  return (
    <CrudDialog
      title={`Edit ${audienceLabels[row.group.audience]}`}
      description={`Group access for ${row.application_id}. The audience and application stay as created.`}
      onClose={onClose}
      panelClassName="max-w-2xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={mutation.isPending}
            disabled={!roleKey || !organization.trim()}
            onClick={() => mutation.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Role">
          <SearchableSelect
            value={roleKey}
            onChange={setRoleKey}
            options={roleOptions.map((role) => ({ value: role.key, label: role.key, description: role.label }))}
            placeholder="Select a role"
            searchPlaceholder="Search role"
          />
        </Field>
        <Field label="Organization ID">
          <TextInput value={organization} onChange={(event) => setOrganization(event.target.value)} />
        </Field>
        <GroupFilters audience={row.group.audience} options={optionsQuery.data || {}} state={state} />
      </div>
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
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-(--mws-charcoal)">Roles</h2>
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
      </div>

      {dialog ? (
        <RoleDialog dialog={dialog} roles={roles} applications={applications} onClose={() => setDialog(null)} />
      ) : null}
    </section>
  );
}

function PermissionChecklist({ catalog, value, onChange }) {
  const [draft, setDraft] = useState("");
  const all = catalog.length > 0 && catalog.every((permission) => value.includes(permission));

  function toggle(permission) {
    onChange(
      value.includes(permission)
        ? value.filter((item) => item !== permission)
        : [...value, permission],
    );
  }

  function addDraft() {
    const permission = draft.trim();
    if (!permission) return;
    if (!value.includes(permission)) onChange([...value, permission]);
    setDraft("");
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <CheckboxField
          checked={all}
          disabled={catalog.length === 0}
          label="All permissions"
          onChange={(event) => onChange(event.target.checked ? [...catalog] : [])}
        />
        {catalog.map((permission) => (
          <CheckboxField
            key={permission}
            checked={value.includes(permission)}
            label={permission}
            onChange={() => toggle(permission)}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <TextInput
          value={draft}
          placeholder="Add a new permission, for example reports.read"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addDraft();
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={addDraft}>
          Add
        </Button>
      </div>
    </div>
  );
}

function RoleDialog({ dialog, roles, applications, onClose }) {
  const queryClient = useQueryClient();
  const isEdit = dialog.mode === "edit";
  const role = dialog.role;
  const [application, setApplication] = useState(role?.application_id || "");
  const [key, setKey] = useState(role?.key || "");
  const [label, setLabel] = useState(role?.label || "");
  const [permissions, setPermissions] = useState(role?.permissions || []);
  const [attempted, setAttempted] = useState(false);

  // Every permission already used by a role of this application, plus the ones
  // added here, so a new role can reuse them as a checklist.
  const catalog = [
    ...new Set([
      ...roles.filter((item) => item.application_id === application).flatMap((item) => item.permissions),
      ...permissions,
    ]),
  ].sort();
  const changesPermissions =
    isEdit && [...permissions].sort().join("\n") !== [...role.permissions].sort().join("\n");

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
      panelClassName="max-w-2xl"
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
              <SearchableSelect
                creatable
                value={application}
                onChange={setApplication}
                options={applications.map((item) => ({ value: item, label: item }))}
                placeholder="Select or type an application"
                searchPlaceholder="Search or type an application"
              />
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
        <Field label="Permissions">
          <PermissionChecklist catalog={catalog} value={permissions} onChange={setPermissions} />
        </Field>
      </form>
    </CrudDialog>
  );
}
