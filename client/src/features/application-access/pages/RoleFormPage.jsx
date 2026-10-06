import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Field, TextInput } from "../../../components/ui/FormControls.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { OrganizationNote } from "../components/OrganizationNote.jsx";
import { PermissionChecklist } from "../components/PermissionChecklist.jsx";
import { useApplicationRoles } from "../hooks/useApplicationRoles.js";


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
  const [permissions, setPermissions] = useState(role?.permissions || []);
  const [attempted, setAttempted] = useState(false);

  // Every permission already used by a role of this application, plus the ones
  // added here, so a role can reuse them as a checklist.
  const catalog = [
    ...new Set([
      ...roles.filter((item) => item.application_id === application).flatMap((item) => item.permissions),
      ...permissions,
    ]),
  ].sort();
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
        ? applicationAccessApi.updateRole(role.id, { label: label.trim(), permissions })
        : applicationAccessApi.createRole({
            application_id: application,
            key: key.trim(),
            label: label.trim(),
            permissions,
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
    if (twin || !label.trim() || (!isEdit && !key.trim())) return;
    mutation.mutate();
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title={isEdit ? `Edit ${role.key}` : `Add role to ${applicationId}`}
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
            <Field label="Permissions" hint="Check what this role may do. The application decides what each permission means.">
              <PermissionChecklist catalog={catalog} value={permissions} onChange={setPermissions} />
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
                  <Field label="Role key" error={attempted && !key.trim() ? "Role key is required." : undefined}>
                    <TextInput value={key} onChange={(event) => setKey(event.target.value)} />
                  </Field>
                </>
              )}
              <Field label="Label" error={attempted && !label.trim() ? "Label is required." : undefined}>
                <TextInput value={label} maxLength={64} onChange={(event) => setLabel(event.target.value)} />
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
