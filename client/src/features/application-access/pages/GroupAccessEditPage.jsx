import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Field, SearchableSelect } from "../../../components/ui/FormControls.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { loadEmployeeFormOptions } from "../../employees/api/employeeFormOptions.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { PermissionPopover } from "../components/PermissionPopover.jsx";
import { roleOptions } from "../utils/roleOptions.js";
import { GroupFilters } from "../components/GroupFilters.jsx";
import {
  audienceLabels,
  groupFilterPayload,
  hasGroupFilterError,
  useGroupFilterState,
} from "../utils/groupFilterState.js";
import { OrganizationNote } from "../components/OrganizationNote.jsx";
import { isRealUnit } from "../utils/legacyUnit.js";
import { useApplicationRoles } from "../hooks/useApplicationRoles.js";
import { useScopeCatalog } from "../hooks/useScopeCatalog.js";
import { useRoleAvailability } from "../hooks/useRoleAvailability.js";

export function GroupAccessEditPage() {
  const { user } = useAuth();
  const { ruleId } = useParams();
  const ruleQuery = useQuery({
    queryKey: ["application-access", "rule", ruleId],
    queryFn: () => applicationAccessApi.getRule(ruleId),
  });

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-w-0">
        <PageHeader title="Edit Group Access" />
        <PanelMessage>Only Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }
  if (ruleQuery.isLoading) return <PanelMessage>Loading group access…</PanelMessage>;
  if (ruleQuery.isError || !ruleQuery.data) {
    return <PanelMessage tone="error">This group access could not be found.</PanelMessage>;
  }
  return <GroupAccessForm rule={ruleQuery.data} />;
}

function GroupAccessForm({ rule }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const back = `/application-access/apps/${rule.application_id}`;
  const rules = useScopeCatalog();
  const state = useGroupFilterState(rule, rule.audience === "STUDENTS" ? null : rules);
  const [roleKey, setRoleKey] = useState(rule.default_role_key);
  const [isActive, setIsActive] = useState(rule.is_active);
  const [attempted, setAttempted] = useState(false);
  const [scopeReviewed, setScopeReviewed] = useState(false);

  const roles = (useApplicationRoles().data || []).filter(
    (role) => role.application_id === rule.application_id && role.is_active,
  );
  const options = useQuery({ queryKey: ["employee-form-options"], queryFn: loadEmployeeFormOptions }).data || {};
  // Only once the units are loaded, so an empty list is never read as All.
  const knownUnitIds = options.units?.length ? new Set(options.units.filter(isRealUnit).map((unit) => unit.id)) : undefined;
  const unavailable = useRoleAvailability({
    applicationId: rule.application_id,
    audience: rule.audience,
    scope: groupFilterPayload(state, rule.audience, knownUnitIds),
    groupId: rule.id,
  });
  const lostRole = roleKey && unavailable.has(roleKey) ? roleKey : "";
  const chosenRole = lostRole ? "" : roleKey;
  const openRoles = roles.filter((role) => !unavailable.has(role.key));
  const selectedRole = roles.find((role) => role.key === chosenRole);

  const mutation = useMutation({
    mutationFn: () =>
      applicationAccessApi.updateRule(rule.id, {
        ...groupFilterPayload(state, rule.audience, knownUnitIds),
        default_role_key: chosenRole,
        is_active: isActive,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["application-access"] });
      showSuccessToast("Group access updated.");
      navigate(back);
    },
    onError: (error) => showErrorToast(error, "Could not update this group access."),
  });

  function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (!scopeReviewed || !chosenRole || hasGroupFilterError(state, rule.audience, knownUnitIds, rules?.studentUnitIds)) return;
    mutation.mutate();
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title={`Edit ${audienceLabels[rule.audience]}`}
        description={`Group access for ${rule.application_id}. The application and audience stay as created.`}
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
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="min-w-0 space-y-5 rounded-2xl border border-(--mws-line) bg-white p-5">
            <GroupFilters
              audience={rule.audience}
              options={options}
              state={state}
              showErrors={attempted}
              studentUnits={rules?.studentUnits}
              onReviewChange={setScopeReviewed}
            />
          </section>
          <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
            <div className="space-y-4 rounded-2xl border border-(--mws-line) bg-white p-5">
              <Field label="Role" error={attempted && !chosenRole ? "Role is required." : undefined}>
                <SearchableSelect
                  value={chosenRole}
                  onChange={setRoleKey}
                  options={roleOptions(roles, unavailable)}
                  placeholder="Select a role"
                  searchPlaceholder="Search role"
                />
              </Field>
              {lostRole ? (
                <p className="text-xs text-(--mws-muted)">{lostRole} no longer fits this scope. Pick another role.</p>
              ) : null}
              {roles.length > 0 && openRoles.length === 0 ? (
                <p className="text-xs text-(--mws-muted)">
                  Every role is already used by a broader or narrower group for this scope.
                </p>
              ) : null}
              {selectedRole ? <PermissionPopover permissions={selectedRole.permissions} /> : null}
              <label className="flex items-center gap-3 text-sm text-(--mws-charcoal)">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-(--mws-burgundy)"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                />
                Group access is on
              </label>
              <OrganizationNote applicationId={rule.application_id} />
            </div>
            <div className="flex gap-2">
              <Button asChild variant="secondary" className="flex-1">
                <Link to={back}>Cancel</Link>
              </Button>
              <Button type="submit" className="flex-1" loading={mutation.isPending} disabled={!scopeReviewed}>
                Save
              </Button>
            </div>
          </aside>
        </div>
      </form>
    </div>
  );
}
