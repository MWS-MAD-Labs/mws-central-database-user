import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Field, FilterSelect, SearchableSelect } from "../../../components/ui/FormControls.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { enumOptions } from "../../../lib/format.js";
import { showBulkFailureToast, showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { PaginatedCandidatePicker } from "../../academic/components/pc-activity-room/PaginatedCandidatePicker.jsx";
import { employmentTypes } from "../../employees/api/employeesApi.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { useApplicationRoles } from "../hooks/useApplicationRoles.js";
import { groupScopeSummary, groupTitle } from "../utils/groupSummary.js";

// Another role for people inside one group. Only people that group covers are listed.
export function ExceptionAddPage() {
  const { user } = useAuth();
  const { applicationId, ruleId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const back = `/application-access/apps/${applicationId}`;
  const [roleKey, setRoleKey] = useState("");
  const [params, setParams] = useState({ page: 1, size: 10, search: "", employment_type: "" });
  const [selected, setSelected] = useState(() => new Map());
  const [attempted, setAttempted] = useState(false);

  const detail = useQuery({
    queryKey: ["application-access", "app", applicationId],
    queryFn: () => applicationAccessApi.getApplication(applicationId),
  }).data;
  const group = detail?.groups.find((item) => item.id === ruleId);
  const roles = (useApplicationRoles().data || []).filter(
    (role) => role.application_id === applicationId && role.is_active,
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
        search: params.search || undefined,
        page: params.page,
        size: params.size,
      }),
    enabled: Boolean(group),
    placeholderData: (previous) => previous,
  });

  const mutation = useMutation({
    mutationFn: () =>
      applicationAccessApi.bulkGrant({
        person_ids: Array.from(selected.keys()),
        application_id: applicationId,
        role: roleKey,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["application-access"] });
      if (result.success_count > 0) showSuccessToast(`Exception added for ${result.success_count} person(s).`);
      if (result.failed_count > 0) showBulkFailureToast("person(s) could not be added", result);
      navigate(back);
    },
    onError: (error) => showErrorToast(error, "Could not add these exceptions."),
  });

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-w-0">
        <PageHeader title="Add exception" />
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
  const items = rows.map((employee) => {
    const inherited = employee.inherited_role;
    const same = Boolean(roleKey) && inherited === roleKey;
    return {
      id: employee.person_id,
      label: employee.full_name,
      sublabel: [employee.email, employee.unit, employee.job_position].filter(Boolean).join(" / "),
      extra: inherited ? `Gets ${inherited}${same ? ", pick a different role" : ""}` : null,
      disabled: same,
      inheritedRole: inherited,
    };
  });

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

  function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (!roleKey || selected.size === 0) return;
    mutation.mutate();
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title={`Add exception to ${applicationId}`}
        description={`Inside ${groupTitle(group)}: ${groupScopeSummary(group)}. Everyone there gets ${group.default_role_key}. Check the people who should get another role.`}
        actions={
          <Button asChild variant="secondary">
            <Link to={back}>
              <ArrowLeft size={16} />
              Back
            </Link>
          </Button>
        }
      />
      <form onSubmit={submit} noValidate>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="min-w-0 space-y-3 rounded-2xl border border-(--mws-line) bg-white p-5">
            {attempted && selected.size === 0 ? (
              <p className="text-sm font-semibold text-[#a43c41]">Pick at least one employee.</p>
            ) : null}
            <PaginatedCandidatePicker
              items={items}
              selected={selected}
              paging={paging}
              search={params.search}
              isLoading={candidatesQuery.isLoading}
              emptyMessage="No one in this group is waiting for an exception."
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
          <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
            <div className="space-y-4 rounded-2xl border border-(--mws-line) bg-white p-5">
              <Field label="Role" error={attempted && !roleKey ? "Role is required." : undefined}>
                <SearchableSelect
                  value={roleKey}
                  onChange={chooseRole}
                  options={roles.map((role) => ({ value: role.key, label: role.key, description: role.label }))}
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
              <p className="text-xs text-(--mws-muted)">
                The group gives {group.default_role_key}. Someone already getting the role you pick is not listed as an
                option.
              </p>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="secondary" className="flex-1">
                <Link to={back}>Cancel</Link>
              </Button>
              <Button type="submit" className="flex-1" loading={mutation.isPending}>
                Add exception
              </Button>
            </div>
          </aside>
        </div>
      </form>
    </div>
  );
}
