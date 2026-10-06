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
import { roleOptions } from "../utils/roleOptions.js";
import { GroupFilters } from "../components/GroupFilters.jsx";
import { OrganizationNote } from "../components/OrganizationNote.jsx";
import { useApplicationRoles } from "../hooks/useApplicationRoles.js";
import {
  audienceLabels,
  groupFilterPayload,
  hasGroupFilterError,
  useGroupFilterState,
} from "../utils/groupFilterState.js";

// A new group for one application: who it covers and the role they get.
export function GroupFormPage() {
  const { user } = useAuth();
  const { applicationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const back = `/application-access/apps/${applicationId}`;
  const [audience, setAudience] = useState("EMPLOYEES");
  const [roleKey, setRoleKey] = useState("");
  const [attempted, setAttempted] = useState(false);
  const scope = useGroupFilterState();

  const roles = (useApplicationRoles().data || []).filter(
    (role) => role.application_id === applicationId && role.is_active,
  );
  const options = useQuery({ queryKey: ["employee-form-options"], queryFn: loadEmployeeFormOptions }).data || {};
  const selectedRole = roles.find((role) => role.key === roleKey);

  const mutation = useMutation({
    mutationFn: () =>
      applicationAccessApi.createRule({
        application_id: applicationId,
        audience,
        ...groupFilterPayload(scope, audience),
        default_role_key: roleKey,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["application-access"] });
      showSuccessToast("Group access added.");
      navigate(back);
    },
    onError: (error) => showErrorToast(error, "Could not add this group access."),
  });

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-w-0">
        <PageHeader title="Add group" />
        <PanelMessage>Only Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }

  function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (!roleKey || hasGroupFilterError(scope, audience)) return;
    mutation.mutate();
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title={`Add group to ${applicationId}`}
        description="Everyone this group covers gets the role. If the group sits inside a broader one, the role has to differ from it."
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
          <section className="min-w-0 space-y-5 rounded-2xl border border-(--mws-line) bg-white p-5">
            <div>
              <h2 className="font-display text-base font-bold text-(--mws-charcoal)">Scope</h2>
              <p className="text-sm text-(--mws-muted)">
                Who this covers. Leave a list on All to include every unit, position or level.
              </p>
            </div>
            <GroupFilters audience={audience} options={options} state={scope} showErrors={attempted} />
          </section>
          <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
            <div className="space-y-4 rounded-2xl border border-(--mws-line) bg-white p-5">
              <Field label="Audience">
                <SearchableSelect
                  value={audience}
                  onChange={setAudience}
                  options={Object.entries(audienceLabels).map(([value, label]) => ({ value, label }))}
                  placeholder="Select an audience"
                />
              </Field>
              <Field label="Role" error={attempted && !roleKey ? "Role is required." : undefined}>
                <SearchableSelect
                  value={roleKey}
                  onChange={setRoleKey}
                  options={roleOptions(roles)}
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
              <OrganizationNote applicationId={applicationId} />
            </div>
            <div className="flex gap-2">
              <Button asChild variant="secondary" className="flex-1">
                <Link to={back}>Cancel</Link>
              </Button>
              <Button type="submit" className="flex-1" loading={mutation.isPending}>
                Add group
              </Button>
            </div>
          </aside>
        </div>
      </form>
    </div>
  );
}
