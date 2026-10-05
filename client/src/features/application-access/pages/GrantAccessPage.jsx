import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Field, FilterSelect, SearchableSelect } from "../../../components/ui/FormControls.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { enumOptions } from "../../../lib/format.js";
import { showBulkFailureToast, showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { PaginatedCandidatePicker } from "../../academic/components/pc-activity-room/PaginatedCandidatePicker.jsx";
import { employmentTypes } from "../../employees/api/employeesApi.js";
import { loadEmployeeFormOptions } from "../../employees/api/employeeFormOptions.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { GroupFilters } from "../components/GroupFilters.jsx";
import { OrganizationNote } from "../components/OrganizationNote.jsx";
import { useApplicationRoles } from "../hooks/useApplicationRoles.js";
import {
  audienceLabels,
  groupFilterPayload,
  hasGroupFilterError,
  useGroupFilterState,
} from "../utils/groupFilterState.js";

const BACK = "/application-access?tab=access";

const applyOptions = [
  { value: "SCOPE", label: "Everyone in this scope" },
  { value: "PEOPLE", label: "Only the people I check" },
];

// Comma list for the candidates endpoint. "All" sends nothing.
const idList = (selection) => (selection.selected && selection.selected.length ? selection.selected.join(",") : undefined);

export function GrantAccessPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [application, setApplication] = useState("");
  const [audience, setAudience] = useState("EMPLOYEES");
  const [applyTo, setApplyTo] = useState("SCOPE");
  const [roleKey, setRoleKey] = useState("");
  const [params, setParams] = useState({ page: 1, size: 10, search: "", employment_type: "" });
  const [selected, setSelected] = useState(() => new Map());
  const [attempted, setAttempted] = useState(false);
  const scope = useGroupFilterState();

  const roles = useApplicationRoles().data || [];
  const options = useQuery({ queryKey: ["employee-form-options"], queryFn: loadEmployeeFormOptions }).data || {};
  const groupsQuery = useQuery({
    queryKey: ["application-access", "groups", application],
    queryFn: () =>
      applicationAccessApi.listAccess({
        application_id: application,
        kind: "GROUP",
        is_active: true,
        size: 100,
      }),
    enabled: Boolean(application),
  });

  // Group access of this application for employees. Exceptions live inside it.
  const groups = (groupsQuery.data?.data || []).filter((row) => row.group.audience !== "STUDENTS");
  const canExceptions = Boolean(application) && groups.length > 0 && audience !== "STUDENTS";
  const applying = canExceptions ? applyTo : "SCOPE";
  const scopeInvalid = hasGroupFilterError(scope, audience);

  const candidatesQuery = useQuery({
    queryKey: [
      "application-access",
      "candidates",
      application,
      params,
      scope.units.selected,
      scope.positions.selected,
      scope.levels.selected,
    ],
    queryFn: () =>
      applicationAccessApi.listCandidates({
        application_id: application,
        coverage: "COVERED",
        exclude_own_access: true,
        unit_ids: idList(scope.units),
        job_position_ids: idList(scope.positions),
        job_level_ids: idList(scope.levels),
        employment_type: params.employment_type || undefined,
        search: params.search || undefined,
        page: params.page,
        size: params.size,
      }),
    enabled: applying === "PEOPLE" && !scopeInvalid,
    placeholderData: (previous) => previous,
  });

  const rows = candidatesQuery.data?.data || [];
  const paging = candidatesQuery.data?.paging || {
    current_page: params.page,
    total_page: 1,
    total_item: rows.length,
    size: params.size,
  };
  const items = rows.map((employee) => {
    const inherited = employee.inherited_role;
    const same = Boolean(roleKey) && inherited === roleKey;
    return {
      id: employee.person_id,
      label: employee.full_name,
      sublabel: [employee.email, employee.unit, employee.job_position].filter(Boolean).join(" / "),
      extra: inherited ? `Gets ${inherited} from a group${same ? ", pick a different role" : ""}` : null,
      disabled: same,
      inheritedRole: inherited,
    };
  });

  const applications = [...new Set(roles.map((role) => role.application_id))].sort();
  const roleOptions = roles.filter((role) => role.application_id === application && role.is_active);
  const selectedRole = roleOptions.find((role) => role.key === roleKey);
  const groupSummary = (row) =>
    [
      audienceLabels[row.group.audience],
      row.group.units.length ? row.group.units.map((item) => item.name).join(", ") : null,
      row.group.job_positions.length ? row.group.job_positions.map((item) => item.name).join(", ") : null,
      row.group.job_levels.length ? row.group.job_levels.map((item) => item.name).join(", ") : null,
    ]
      .filter(Boolean)
      .join(" · ");

  // Someone who already gets this role from a group cannot be picked for it.
  function chooseRole(value) {
    setRoleKey(value);
    setSelected((current) => new Map([...current].filter(([, item]) => item.inheritedRole !== value)));
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

  function finish() {
    queryClient.invalidateQueries({ queryKey: ["application-access"] });
    navigate(BACK);
  }

  const groupMutation = useMutation({
    mutationFn: () =>
      applicationAccessApi.createRule({
        application_id: application,
        audience,
        ...groupFilterPayload(scope, audience),
        default_role_key: roleKey,
      }),
    onSuccess: () => {
      showSuccessToast("Group access added.");
      finish();
    },
    onError: (error) => showErrorToast(error, "Could not add this group access."),
  });

  const peopleMutation = useMutation({
    mutationFn: () =>
      applicationAccessApi.bulkGrant({
        person_ids: Array.from(selected.keys()),
        application_id: application,
        role: roleKey,
      }),
    onSuccess: (result) => {
      if (result.success_count > 0) showSuccessToast(`Exception added for ${result.success_count} person(s).`);
      if (result.failed_count > 0) showBulkFailureToast("person(s) could not be added", result);
      finish();
    },
    onError: (error) => showErrorToast(error, "Could not add these exceptions."),
  });

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-w-0">
        <PageHeader title="Add Access" />
        <PanelMessage>Only Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }

  function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (!application || !roleKey || scopeInvalid) return;
    if (applying === "PEOPLE") {
      if (selected.size === 0) return;
      peopleMutation.mutate();
    } else {
      groupMutation.mutate();
    }
  }

  const applyHint = !application
    ? "Pick an application first."
    : audience === "STUDENTS"
      ? "Exceptions are for employees. Choose an employee audience to pick people."
      : groups.length === 0
        ? `Add a group for ${application} first. It decides who can use the app, then exceptions go inside it.`
        : "Check people to give them a different role than their group. Only people the groups cover are listed.";

  return (
    <div className="min-w-0">
      <PageHeader
        title="Add Access"
        description="Define a scope, then give a role to everyone in it or only to the people you check."
        actions={
          <Button asChild variant="secondary">
            <Link to={BACK}>
              <ArrowLeft size={16} />
              Back
            </Link>
          </Button>
        }
      />
      <form id="grant-access-form" onSubmit={submit} noValidate>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-5">
            <section className="min-w-0 space-y-5 rounded-2xl border border-(--mws-line) bg-white p-5">
              <div>
                <h2 className="font-display text-base font-bold text-(--mws-charcoal)">Scope</h2>
                <p className="text-sm text-(--mws-muted)">
                  Who this covers. Leave a list on All to include every unit, position or level.
                </p>
              </div>
              <GroupFilters audience={audience} options={options} state={scope} showErrors={attempted} />
            </section>

            {applying === "PEOPLE" ? (
              <section className="min-w-0 space-y-3 rounded-2xl border border-(--mws-line) bg-white p-5">
                <div>
                  <h2 className="font-display text-base font-bold text-(--mws-charcoal)">People</h2>
                  <p className="text-sm text-(--mws-muted)">
                    Active employees in this scope that a group of {application} covers.
                  </p>
                </div>
                {attempted && selected.size === 0 ? (
                  <p className="text-sm font-semibold text-[#a43c41]">Pick at least one employee.</p>
                ) : null}
                <PaginatedCandidatePicker
                  items={items}
                  selected={selected}
                  paging={paging}
                  search={params.search}
                  isLoading={candidatesQuery.isLoading}
                  emptyMessage="No one in this scope is waiting for an exception."
                  itemLabel="employee"
                  dense
                  filters={
                    <div className="flex flex-wrap gap-3">
                      <FilterSelect
                        label="Employment Type"
                        value={params.employment_type}
                        onChange={(value) => setParams((current) => ({ ...current, page: 1, employment_type: value }))}
                        options={[{ value: "", label: "All Employment Types" }, ...enumOptions(employmentTypes)]}
                      />
                    </div>
                  }
                  onSearchChange={(search) => setParams((current) => ({ ...current, page: 1, search }))}
                  onToggle={toggle}
                  onTogglePage={togglePage}
                  onPageChange={(page) => setParams((current) => ({ ...current, page }))}
                  onPageSizeChange={(size) => setParams((current) => ({ ...current, page: 1, size }))}
                />
              </section>
            ) : null}
          </div>

          <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
            <div className="space-y-4 rounded-2xl border border-(--mws-line) bg-white p-5">
              <Field label="Application" error={attempted && !application ? "Application is required." : undefined}>
                <SearchableSelect
                  value={application}
                  onChange={(value) => {
                    setApplication(value);
                    setRoleKey("");
                    setSelected(new Map());
                  }}
                  options={applications.map((item) => ({ value: item, label: item }))}
                  placeholder="Select an application"
                  searchPlaceholder="Search application"
                />
              </Field>
              <Field label="Audience">
                <SearchableSelect
                  value={audience}
                  onChange={setAudience}
                  options={Object.entries(audienceLabels).map(([value, label]) => ({ value, label }))}
                  placeholder="Select an audience"
                />
              </Field>
              <Field label="Apply to" hint={applyHint}>
                <SearchableSelect value={applying} onChange={setApplyTo} options={applyOptions} placeholder="Apply to" />
              </Field>
              <Field label="Role" error={attempted && !roleKey ? "Role is required." : undefined}>
                <SearchableSelect
                  value={roleKey}
                  disabled={!application}
                  onChange={chooseRole}
                  options={roleOptions.map((role) => ({ value: role.key, label: role.key, description: role.label }))}
                  placeholder="Select a role"
                  searchPlaceholder="Search role"
                />
              </Field>
              {selectedRole ? (
                <p className="text-xs text-(--mws-muted)">
                  {selectedRole.permissions.length === 0
                    ? "This role has no permissions."
                    : `Permissions: ${selectedRole.permissions.join(", ")}`}
                </p>
              ) : null}
              {groups.length > 0 ? (
                <div className="space-y-1 text-xs text-(--mws-muted)">
                  <p>Group access on {application} (employees):</p>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {groups.map((row) => (
                      <li key={row.id}>
                        {groupSummary(row)} get {row.role}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <OrganizationNote applicationId={application} />
            </div>
            <div className="flex gap-2">
              <Button asChild variant="secondary" className="flex-1">
                <Link to={BACK}>Cancel</Link>
              </Button>
              <Button
                type="submit"
                className="flex-1"
                loading={peopleMutation.isPending || groupMutation.isPending}
              >
                Add
              </Button>
            </div>
          </aside>
        </div>
      </form>
    </div>
  );
}
