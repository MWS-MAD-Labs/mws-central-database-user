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
import { employeesApi, employmentTypes } from "../../employees/api/employeesApi.js";
import { loadEmployeeFormOptions } from "../../employees/api/employeeFormOptions.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { GroupFilters } from "../components/GroupFilters.jsx";
import {
  audienceLabels,
  groupFilterPayload,
  hasGroupFilterError,
  useGroupFilterState,
} from "../utils/groupFilterState.js";
import { OrganizationNote } from "../components/OrganizationNote.jsx";
import { useApplicationRoles } from "../hooks/useApplicationRoles.js";

const BACK = "/application-access?tab=access";

export function GrantAccessPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState("PEOPLE");
  const [params, setParams] = useState({ page: 1, size: 10, search: "" });
  const [filter, setFilter] = useState({ unit_id: "", job_position_id: "", job_level_id: "", employment_type: "" });
  const [selected, setSelected] = useState(() => new Map());
  const [audience, setAudience] = useState("EMPLOYEES");
  const groupFilters = useGroupFilterState();
  const [application, setApplication] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [attempted, setAttempted] = useState(false);

  const rolesQuery = useApplicationRoles();
  const roles = rolesQuery.data || [];
  const optionsQuery = useQuery({ queryKey: ["employee-form-options"], queryFn: loadEmployeeFormOptions });
  const options = optionsQuery.data || {};
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

  const applications = [...new Set(roles.map((role) => role.application_id))].sort();
  const roleOptions = roles.filter((role) => role.application_id === application && role.is_active);
  const selectedRole = roleOptions.find((role) => role.key === roleKey);
  const hasActiveFilter = Object.values(filter).some(Boolean);

  // Specific access sits on top of a baseline: a group with no filters.
  const groups = groupsQuery.data?.data || [];
  const baselines = groups.filter(
    (row) =>
      row.group.units.length === 0 &&
      row.group.job_positions.length === 0 &&
      row.group.job_levels.length === 0,
  );
  const covers = (rowAudience, target) => rowAudience === "EMPLOYEES_AND_STUDENTS" || rowAudience === target;
  const targetAudience = mode === "PEOPLE" ? "EMPLOYEES" : audience;
  const matchingBaseline = baselines.find((row) => covers(row.group.audience, targetAudience));
  const groupIsBaseline =
    mode === "GROUP" &&
    groupFilters.units.selected === null &&
    (audience === "STUDENTS" ||
      (groupFilters.positions.selected === null && groupFilters.levels.selected === null));
  const needsBaseline = Boolean(application) && groupsQuery.isSuccess && !matchingBaseline && !groupIsBaseline;

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

  function finish() {
    queryClient.invalidateQueries({ queryKey: ["application-access"] });
    navigate(BACK);
  }

  const peopleMutation = useMutation({
    mutationFn: () =>
      applicationAccessApi.bulkGrant({
        person_ids: Array.from(selected.keys()),
        application_id: application,
        role: roleKey,
      }),
    onSuccess: (result) => {
      if (result.success_count > 0) showSuccessToast(`Access granted to ${result.success_count} person(s).`);
      if (result.failed_count > 0) showBulkFailureToast("person(s) could not be granted", result);
      finish();
    },
    onError: (error) => showErrorToast(error, "Could not grant this access."),
  });

  const groupMutation = useMutation({
    mutationFn: () =>
      applicationAccessApi.createRule({
        application_id: application,
        audience,
        ...groupFilterPayload(groupFilters, audience),
        default_role_key: roleKey,
      }),
    onSuccess: () => {
      showSuccessToast("Group access added.");
      finish();
    },
    onError: (error) => showErrorToast(error, "Could not add this group access."),
  });

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-w-0">
        <PageHeader title="Grant Access" />
        <PanelMessage>Only Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }

  function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (!application || !roleKey || needsBaseline) return;
    if (mode === "PEOPLE") {
      if (selected.size === 0) return;
      peopleMutation.mutate();
    } else {
      if (hasGroupFilterError(groupFilters, audience)) return;
      groupMutation.mutate();
    }
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="Grant Access"
        description="Give access to specific people, or to a whole group such as every active employee."
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
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="min-w-0 space-y-5 rounded-2xl border border-(--mws-line) bg-white p-5">
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
                <GroupFilters audience={audience} options={options} state={groupFilters} showErrors={attempted} />
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
                  onPageSizeChange={(size) => setParams((current) => ({ ...current, page: 1, size }))}
                />
              </Field>
            )}
          </section>

          <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
            <div className="space-y-4 rounded-2xl border border-(--mws-line) bg-white p-5">
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
              {selectedRole ? (
                <p className="text-xs text-(--mws-muted)">
                  {selectedRole.permissions.length === 0
                    ? "This role has no permissions."
                    : `Permissions: ${selectedRole.permissions.join(", ")}`}
                </p>
              ) : null}
              {needsBaseline ? (
                <p className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-3 py-2 text-xs text-[#805b18]">
                  Set up the baseline for {application} first. Switch Who to A Group, keep every filter on All,
                  and grant that group a role. People and narrower groups come after it.
                </p>
              ) : matchingBaseline && !groupIsBaseline ? (
                <p className="text-xs text-(--mws-muted)">
                  {audienceLabels[matchingBaseline.group.audience]} already get {matchingBaseline.role}. Pick a
                  different role to give someone more or less.
                </p>
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
                disabled={needsBaseline}
                loading={peopleMutation.isPending || groupMutation.isPending}
              >
                Grant
              </Button>
            </div>
          </aside>
        </div>
      </form>
    </div>
  );
}
