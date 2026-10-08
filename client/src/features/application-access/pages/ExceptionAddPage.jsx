import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { DenseTable, denseCellClass, denseRowClass } from "../../../components/ui/DenseTable.jsx";
import { DebouncedSearchInput, Field, FilterSelect, SearchableSelect, ToggleChip } from "../../../components/ui/FormControls.jsx";
import { FilterResetButton } from "../../../components/ui/FilterResetButton.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { enumOptions, formatStatus } from "../../../lib/format.js";
import { showBulkFailureToast, showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { loadEmployeeFormOptions } from "../../employees/api/employeeFormOptions.js";
import { loadStudentFormOptions } from "../../students/api/studentFormOptions.js";
import { employmentTypes } from "../../employees/api/employeesApi.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { useApplicationRoles } from "../hooks/useApplicationRoles.js";
import { GroupSummary } from "../components/GroupSummary.jsx";
import { Tip } from "../components/Tip.jsx";
import { PermissionPopover } from "../components/PermissionPopover.jsx";
import { isRealUnit } from "../utils/legacyUnit.js";
import { roleOptions } from "../utils/roleOptions.js";

// Another role for people inside one group. Only people that group covers are listed.
export function ExceptionAddPage() {
  const { user } = useAuth();
  const { applicationId, ruleId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const back = `/application-access/apps/${applicationId}`;
  const [roleKey, setRoleKey] = useState("");
  // Blocked shuts the people out instead of giving them another role.
  const [blocked, setBlocked] = useState(false);
  const emptyFilters = { search: "", employment_type: "", unit_id: "", job_position_id: "", job_level_id: "", grade_id: "", class_id: "" };
  const [params, setParams] = useState({ page: 1, size: 10, ...emptyFilters });
  const [selected, setSelected] = useState(() => new Map());
  const [attempted, setAttempted] = useState(false);

  const detail = useQuery({
    queryKey: ["application-access", "app", applicationId],
    queryFn: () => applicationAccessApi.getApplication(applicationId),
  }).data;
  const formOptions = useQuery({ queryKey: ["employee-form-options"], queryFn: loadEmployeeFormOptions }).data || {};
  const group = detail?.groups.find((item) => item.id === ruleId);
  const isStudents = group?.audience === "STUDENTS";
  const studentOptions =
    useQuery({ queryKey: ["student-form-options"], queryFn: loadStudentFormOptions, enabled: isStudents }).data || {};
  // Classes of the year that is running, the ones a class leader belongs to.
  const activeYearId = (studentOptions.academicYears || []).find((year) => year.status === "ACTIVE")?.id;
  const classChoices = (studentOptions.classes || []).filter(
    (item) => !activeYearId || (item.academic_year?.id ?? item.academic_year_id) === activeYearId,
  );
  const roles = (useApplicationRoles().data || []).filter(
    (role) => role.application_id === applicationId && role.is_active && (isStudents ? role.allows_students : role.allows_employees !== false),
  );
  const selectedRole = roles.find((role) => role.key === roleKey);

  const candidatesQuery = useQuery({
    queryKey: ["application-access", "candidates", applicationId, ruleId, params],
    queryFn: () =>
      applicationAccessApi.listCandidates({
        application_id: applicationId,
        coverage: "GROUP",
        group_id: ruleId,
        exclude_own_access: true,
        employment_type: params.employment_type || undefined,
        unit_id: params.unit_id || undefined,
        job_position_id: params.job_position_id || undefined,
        job_level_id: params.job_level_id || undefined,
        grade_id: params.grade_id || undefined,
        class_id: params.class_id || undefined,
        search: params.search || undefined,
        page: params.page,
        size: params.size,
      }),
    enabled: Boolean(group),
    placeholderData: (previous) => previous,
  });

  const mutation = useMutation({
    mutationFn: () =>
      applicationAccessApi.bulkGrant(
        blocked
          ? { person_ids: Array.from(selected.keys()), application_id: applicationId, blocked: true }
          : { person_ids: Array.from(selected.keys()), application_id: applicationId, role: roleKey },
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["application-access"] });
      if (result.success_count > 0) {
        showSuccessToast(
          blocked
            ? `Access blocked for ${result.success_count} person(s).`
            : `Exception added for ${result.success_count} person(s).`,
        );
      }
      if (result.failed_count > 0) {
        showBulkFailureToast(blocked ? "person(s) could not be blocked" : "person(s) could not be added", result);
      }
      navigate(back);
    },
    onError: (error) => showErrorToast(error, "Could not add these exceptions."),
  });

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-w-0">
        <PageHeader title="Add Exception" />
        <PanelMessage>Only Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }
  if (!detail) return <PanelMessage>Loading…</PanelMessage>;
  if (!group) return <PanelMessage tone="error">This group could not be found.</PanelMessage>;

  const rows = candidatesQuery.data?.data || [];
  const paging = candidatesQuery.data?.paging || {
    current_page: params.page,
    total_page: 1,
    total_item: rows.length,
    size: params.size,
  };
  const items = rows.map((employee) => ({
    ...employee,
    id: employee.person_id,
    inheritedRole: employee.inherited_role,
    disabled: !blocked && Boolean(roleKey) && employee.inherited_role === roleKey,
  }));
  const selectable = items.filter((item) => !item.disabled);
  const allPageSelected = selectable.length > 0 && selectable.every((item) => selected.has(item.id));

  // Someone who already gets this role cannot be picked for it.
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

  function setFilter(patch) {
    setParams((current) => ({ ...current, page: 1, ...patch }));
  }

  function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if ((!blocked && !roleKey) || selected.size === 0) return;
    mutation.mutate();
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title={`Add Exception to ${applicationId}`}
        description={
          blocked
            ? "Check the people who should lose access even though their group gives it."
            : isStudents
              ? "Check the students who should get another role than their group, such as a class leader."
              : "Check the people who should get another role than their group."
        }
        actions={
          <Button asChild variant="secondary">
            <Link to={back}>
              <ArrowLeft size={16} />
              Back
            </Link>
          </Button>
        }
      />
      <GroupSummary
        group={group}
        hasNarrower={detail.groups.some((item) => item.parent_group_id === group.id)}
      />
      <form onSubmit={submit} noValidate>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="min-w-0 space-y-3 rounded-2xl border border-(--mws-line) bg-white p-5">
            {attempted && selected.size === 0 ? (
              <p className="text-sm font-semibold text-[#a43c41]">Pick at least one {isStudents ? "student" : "employee"}.</p>
            ) : null}
            <DebouncedSearchInput
              value={params.search}
              onChange={(search) => setParams((current) => ({ ...current, page: 1, search }))}
              placeholder={isStudents ? "Search name or NIS" : "Search employees"}
            />
            <div className="flex min-w-0 flex-wrap items-end gap-3">
              {isStudents ? (
                <>
                  <FilterSelect
                    label="Grade"
                    value={params.grade_id}
                    onChange={(value) => setFilter({ grade_id: value })}
                    options={[{ value: "", label: "All Grades" }, ...(studentOptions.grades || []).map((item) => ({ value: item.id, label: item.name }))]}
                  />
                  <FilterSelect
                    label="Class"
                    value={params.class_id}
                    onChange={(value) => setFilter({ class_id: value })}
                    options={[{ value: "", label: "All Classes" }, ...classChoices.map((item) => ({ value: item.id, label: item.name }))]}
                  />
                </>
              ) : (
                <>
              <FilterSelect
                label="Unit"
                value={params.unit_id}
                onChange={(value) => setFilter({ unit_id: value })}
                options={[{ value: "", label: "All Units" }, ...(formOptions.units || []).filter(isRealUnit).map((item) => ({ value: item.id, label: item.name }))]}
              />
              <FilterSelect
                label="Job Position"
                value={params.job_position_id}
                onChange={(value) => setFilter({ job_position_id: value })}
                options={[{ value: "", label: "All Job Positions" }, ...(formOptions.jobPositions || []).map((item) => ({ value: item.id, label: item.name }))]}
              />
              <FilterSelect
                label="Job Level"
                value={params.job_level_id}
                onChange={(value) => setFilter({ job_level_id: value })}
                options={[{ value: "", label: "All Job Levels" }, ...(formOptions.jobLevels || []).map((item) => ({ value: item.id, label: item.name }))]}
              />
              <FilterSelect
                label="Employment Type"
                value={params.employment_type}
                onChange={(value) => setFilter({ employment_type: value })}
                options={[{ value: "", label: "All Employment Types" }, ...enumOptions(employmentTypes)]}
              />
                </>
              )}
              <FilterResetButton
                visible={Boolean(params.unit_id || params.job_position_id || params.job_level_id || params.employment_type || params.grade_id || params.class_id || params.search)}
                onReset={() => setParams((current) => ({ ...current, page: 1, ...emptyFilters }))}
              />
            </div>
            <DenseTable
              dimmed={candidatesQuery.isPlaceholderData}
              minWidth={900}
              head={
                <>
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Select All on This Page"
                      checked={allPageSelected}
                      disabled={candidatesQuery.isLoading || selectable.length === 0}
                      onChange={(event) => togglePage(event.target.checked, selectable)}
                      className="h-4 w-4 accent-(--mws-burgundy)"
                    />
                  </th>
                  <th className="px-4 py-2.5">Name</th>
                  {isStudents ? (
                    <>
                      <th className="px-4 py-2.5">NIS</th>
                      <th className="px-4 py-2.5">Grade</th>
                      <th className="px-4 py-2.5">Class</th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-2.5">Unit</th>
                      <th className="px-4 py-2.5">Job Position</th>
                      <th className="px-4 py-2.5">Job Level</th>
                      <th className="px-4 py-2.5">Employment Type</th>
                    </>
                  )}
                  <th className="px-4 py-2.5">Current Role</th>
                </>
              }
              footer={
                <PaginationBar
                  paging={paging}
                  itemLabel={isStudents ? "students" : "employees"}
                  isLoading={candidatesQuery.isFetching}
                  onPrevious={() => setParams((current) => ({ ...current, page: Math.max(current.page - 1, 1) }))}
                  onNext={() => setParams((current) => ({ ...current, page: current.page + 1 }))}
                  onPageChange={(page) => setParams((current) => ({ ...current, page }))}
                  onPageSizeChange={(size) => setParams((current) => ({ ...current, page: 1, size }))}
                />
              }
            >
              {items.length === 0 ? (
                <tr>
                  <td colSpan={isStudents ? 6 : 7} className="px-4 py-8 text-center text-sm text-(--mws-muted)">
                    {candidatesQuery.isLoading ? (isStudents ? "Loading students..." : "Loading employees...") : "No one in this group is waiting for an exception."}
                  </td>
                </tr>
              ) : null}
              {items.map((item) => (
                <tr key={item.id} className={`${denseRowClass} ${item.disabled ? "opacity-60" : ""}`}>
                  <td className={denseCellClass}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.full_name}`}
                      checked={selected.has(item.id)}
                      disabled={item.disabled}
                      onChange={(event) => toggle(item, event.target.checked)}
                      className="h-4 w-4 accent-(--mws-burgundy)"
                    />
                  </td>
                  <td className={`${denseCellClass} max-w-64`}>
                    <span className="block truncate font-semibold text-(--mws-charcoal)">{item.full_name}</span>
                    <span className="block truncate text-xs text-(--mws-muted)">{item.email}</span>
                  </td>
                  {isStudents ? (
                    <>
                      <td className={denseCellClass}>{item.nis || "-"}</td>
                      <td className={denseCellClass}>{item.grade || "-"}</td>
                      <td className={denseCellClass}>{item.class_name || "-"}</td>
                    </>
                  ) : (
                    <>
                      <td className={denseCellClass}>{item.unit || "-"}</td>
                      <td className={denseCellClass}>{item.job_position || "-"}</td>
                      <td className={denseCellClass}>{item.job_level || "-"}</td>
                      <td className={denseCellClass}>{item.employment_type ? formatStatus(item.employment_type) : "-"}</td>
                    </>
                  )}
                  <td className={denseCellClass}>
                    {item.inherited_role ?? "-"}
                    {item.disabled ? (
                      <span className="block text-xs text-(--mws-muted)">Pick a Different Role</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </DenseTable>
          </section>
          <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
            <div className="space-y-4 rounded-2xl border border-(--mws-line) bg-white p-5">
              <Field label="Add As">
                <div className="flex flex-wrap gap-2" role="group" aria-label="Add As">
                  <ToggleChip checked={!blocked} onChange={() => setBlocked(false)}>
                    Different Role
                  </ToggleChip>
                  <ToggleChip checked={blocked} onChange={() => setBlocked(true)}>
                    Blocked
                  </ToggleChip>
                </div>
              </Field>
              {blocked ? (
                <p className="text-xs leading-5 text-(--mws-muted)">
                  Blocked people get no access to {applicationId}, even though group {group.default_role_key} gives it. You can
                  unblock them later.
                </p>
              ) : (
                <>
                  <Field label="Role" error={attempted && !roleKey ? "Role is required." : undefined}>
                    <SearchableSelect
                      value={roleKey}
                      onChange={chooseRole}
                      options={roleOptions(roles)}
                      placeholder="Select a role"
                      searchPlaceholder="Search role"
                    />
                  </Field>
                  {selectedRole ? <PermissionPopover permissions={selectedRole.permissions} /> : null}
                  <p className="flex items-center gap-1.5 text-xs leading-none text-(--mws-muted)">
                    Group role {group.default_role_key}
                    <Tip text={`People who already get the role you pick cannot be selected for it.`} label="About Roles" />
                  </p>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button asChild variant="secondary" className="flex-1">
                <Link to={back}>Cancel</Link>
              </Button>
              <Button type="submit" className="flex-1" loading={mutation.isPending}>
                {blocked ? "Block Access" : "Add Exception"}
              </Button>
            </div>
          </aside>
        </div>
      </form>
    </div>
  );
}
