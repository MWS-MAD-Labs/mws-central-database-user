import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Field, TextInput, ToggleChip } from "../../../components/ui/FormControls.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { OrganizationNote } from "../components/OrganizationNote.jsx";
import { PermissionChecklist } from "../components/PermissionChecklist.jsx";
import { useApplicationPermissions } from "../hooks/useApplicationPermissions.js";
import { useApplicationRoles } from "../hooks/useApplicationRoles.js";


// Keys are exact: capital letters, digits and underscores.
function normalizeRoleKey(value) {
  return value
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}

// SUPPORT_STAFF becomes "Support Staff".
function suggestLabel(key) {
  return key
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

export function RoleFormPage() {
  const { user } = useAuth();
  const { applicationId, roleId } = useParams();
  const rolesQuery = useApplicationRoles();

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-w-0">
        <PageHeader title="Role" />
        <PanelMessage>Only Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }
  if (rolesQuery.isLoading) return <PanelMessage>Loading roles…</PanelMessage>;
  const roles = rolesQuery.data || [];
  const role = roleId ? roles.find((item) => item.id === roleId && item.application_id === applicationId) : null;
  if (roleId && !role) return <PanelMessage tone="error">This role could not be found.</PanelMessage>;
  return <RoleForm applicationId={applicationId} role={role} roles={roles} />;
}

function RoleForm({ applicationId, role, roles }) {
  const back = `/application-access/apps/${applicationId}?tab=roles`;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = Boolean(role);
  const application = applicationId;
  const [key, setKey] = useState(role?.key || "");
  const [label, setLabel] = useState(role?.label || "");
  // The label follows the key as a suggestion until someone types in it.
  const [labelEdited, setLabelEdited] = useState(false);
  const [permissions, setPermissions] = useState(role?.permissions || []);
  const [allowsEmployees, setAllowsEmployees] = useState(role?.allows_employees ?? true);
  const [allowsStudents, setAllowsStudents] = useState(role?.allows_students ?? false);
  const [attempted, setAttempted] = useState(false);

  const permissionsQuery = useApplicationPermissions(application);
  const registry = permissionsQuery.data;
  // The registered permissions, plus any the role carries that the application dropped.
  const options = [
    ...(registry?.permissions || []).filter((item) => !item.deprecated || permissions.includes(item.key)),
    ...permissions
      .filter((key) => !(registry?.permissions || []).some((item) => item.key === key))
      .map((key) => ({ key, description: null, deprecated: false })),
  ].sort((left, right) => left.key.localeCompare(right.key));
  const register = useMutation({
    mutationFn: (permission) => applicationAccessApi.createPermission({ application_id: application, key: permission }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["application-access", "permissions", application] }),
    onError: (error) => showErrorToast(error, "Could not add this permission."),
  });
  async function registerPermission(permission) {
    try {
      await register.mutateAsync(permission);
    } catch {
      return false;
    }
    setPermissions((current) => (current.includes(permission) ? current : [...current, permission]));
    return true;
  }
  // Another active role of this application with exactly these permissions.
  const twin = roles.find(
    (item) =>
      item.application_id === application &&
      item.is_active &&
      item.id !== role?.id &&
      [...item.permissions].sort().join("\n") === [...permissions].sort().join("\n"),
  );
  const changesPermissions =
    isEdit && [...permissions].sort().join("\n") !== [...role.permissions].sort().join("\n");

  const mutation = useMutation({
    mutationFn: () =>
      isEdit
        ? applicationAccessApi.updateRole(role.id, {
            label: label.trim(),
            permissions,
            allows_employees: allowsEmployees,
            allows_students: allowsStudents,
          })
        : applicationAccessApi.createRole({
            application_id: application,
            key: key.trim(),
            label: label.trim(),
            permissions,
            allows_employees: allowsEmployees,
            allows_students: allowsStudents,
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["application-access"] });
      showSuccessToast(isEdit ? "Role updated." : "Role added.");
      navigate(back);
    },
    onError: (error) => showErrorToast(error, "Could not save this role."),
  });

  function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (!allowsEmployees && !allowsStudents) return;
    if (twin || !label.trim() || (!isEdit && !key.trim())) return;
    mutation.mutate();
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title={isEdit ? `Edit ${role.key}` : `Add Role to ${applicationId}`}
        description={
          isEdit
            ? `Role of ${role.application_id}. The key stays as created.`
            : "Role keys are exact and uppercase, for example ADMIN or SUPPORT_STAFF."
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
      <form onSubmit={submit} noValidate>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="min-w-0 space-y-5 rounded-2xl border border-(--mws-line) bg-white p-5">
            {permissionsQuery.data && !permissionsQuery.data.has_manifest ? (
              <p className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-3 py-2 text-xs text-[#805b18]">
                This application has not published its permissions. These are not checked against its code, so a typo here is saved as is.
              </p>
            ) : null}
            <Field label="Permissions" hint="Check what this role may do. The application decides what each permission means.">
              {permissionsQuery.isLoading ? (
                <p className="text-sm text-(--mws-muted)">Loading permissions…</p>
              ) : permissionsQuery.isError ? (
                <p className="text-sm font-semibold text-[#a43c41]">The permissions of this application could not be loaded.</p>
              ) : (
                <PermissionChecklist
                  options={options}
                  value={permissions}
                  onChange={setPermissions}
                  canRegister={!registry?.has_manifest}
                  onRegister={registerPermission}
                  registering={register.isPending}
                />
              )}
              {twin ? (
                <p className="text-sm font-semibold text-[#a43c41]">
                  {twin.key} already has exactly these permissions. Reuse it, or change the permissions.
                </p>
              ) : null}
            </Field>
          </section>
          <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
            <div className="space-y-4 rounded-2xl border border-(--mws-line) bg-white p-5">
              {isEdit ? null : (
                <>
                  <Field label="Role Key" error={attempted && !key.trim() ? "Role key is required." : undefined}>
                    <TextInput
                      value={key}
                      onChange={(event) => {
                        const next = normalizeRoleKey(event.target.value);
                        setKey(next);
                        if (!labelEdited) setLabel(suggestLabel(next));
                      }}
                    />
                  </Field>
                </>
              )}
              <Field label="Label" error={attempted && !label.trim() ? "Label is required." : undefined}>
                <TextInput
                  value={label}
                  maxLength={64}
                  onChange={(event) => {
                    setLabelEdited(event.target.value !== "");
                    setLabel(event.target.value);
                  }}
                />
                {!isEdit ? <p className="mt-1 text-xs text-(--mws-muted)">Suggested from the role key. You can change it.</p> : null}
              </Field>
              <Field
                label="Who It Is For"
                hint="Groups of students can only use roles that allow students."
                error={attempted && !allowsEmployees && !allowsStudents ? "Pick employees, students or both." : undefined}
              >
                <div className="flex flex-wrap gap-2" role="group" aria-label="Who It Is For">
                  <ToggleChip checked={allowsEmployees} onChange={setAllowsEmployees}>
                    Employees
                  </ToggleChip>
                  <ToggleChip checked={allowsStudents} onChange={setAllowsStudents}>
                    Students
                  </ToggleChip>
                </div>
              </Field>
              {changesPermissions && role.active_entitlement_count > 0 ? (
                <p className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-3 py-2 text-xs text-[#805b18]">
                  {role.active_entitlement_count} active entitlement(s) hold this role and will get the new
                  permissions right away.
                </p>
              ) : null}
              <OrganizationNote applicationId={application} />
            </div>
            <div className="flex gap-2">
              <Button asChild variant="secondary" className="flex-1">
                <Link to={back}>Cancel</Link>
              </Button>
              <Button type="submit" className="flex-1" loading={mutation.isPending} disabled={Boolean(twin)}>
                Save
              </Button>
            </div>
          </aside>
        </div>
      </form>
    </div>
  );
}
