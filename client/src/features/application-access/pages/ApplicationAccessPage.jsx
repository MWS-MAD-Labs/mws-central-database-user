import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { ActionsMenu, ActionsMenuItem } from "../../../components/ui/ActionsMenu.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { DenseTable, denseCellClass, denseRowClass } from "../../../components/ui/DenseTable.jsx";
import { DebouncedSearchInput } from "../../../components/ui/FormControls.jsx";
import { PageHint } from "../../../components/ui/PageHint.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { useApplicationRoles } from "../hooks/useApplicationRoles.js";
import { useOrganizations } from "../hooks/useOrganizations.js";
import { copyText } from "../utils/copyText.js";

const tabs = [
  { id: "applications", label: "Applications" },
  { id: "roles", label: "Roles" },
];

export function ApplicationAccessPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = tabs.some((tab) => tab.id === searchParams.get("tab"))
    ? searchParams.get("tab")
    : "applications";

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
      {activeTab === "roles" ? <RolesPanel /> : <ApplicationsPanel />}
      <PageHint id="application-access-source-of-truth">
        Open an application to give access. Start with a group: it says who can use the app and with which role.
        Then add exceptions inside a group for people who need another role. The most specific access wins, a
        blocked person stays blocked, and a group can only be removed after its exceptions.
      </PageHint>
    </div>
  );
}

function ApplicationsPanel() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["application-access", "applications"],
    queryFn: () => applicationAccessApi.listApplications(),
  });
  const needle = search.trim().toLowerCase();
  const rows = (query.data || []).filter((row) => !needle || row.application_id.toLowerCase().includes(needle));

  return (
    <section className="min-w-0 space-y-4">
      <div className="w-full sm:w-72">
        <DebouncedSearchInput value={search} onChange={setSearch} placeholder="Search applications" />
      </div>
      {query.isLoading ? (
        <PanelMessage>Loading applications…</PanelMessage>
      ) : rows.length === 0 ? (
        <PanelMessage>No applications match.</PanelMessage>
      ) : (
        <DenseTable
          minWidth={760}
          head={
            <>
              <th className="px-4 py-2.5">Application</th>
              <th className="px-4 py-2.5">Organization ID</th>
              <th className="px-4 py-2.5">Groups</th>
              <th className="px-4 py-2.5">Exceptions</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </>
          }
        >
          {rows.map((row) => (
            <tr key={row.application_id} className={denseRowClass}>
              <td className={`${denseCellClass} font-semibold text-(--mws-charcoal)`}>{row.application_id}</td>
              <td className={denseCellClass}>
                {row.organization_id ? (
                  <span className="inline-flex items-center gap-2">
                    <code className="text-sm">{row.organization_id}</code>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Copy Organization ID of ${row.application_id}`}
                      onClick={() => copyText(row.organization_id)}
                    >
                      Copy
                    </Button>
                  </span>
                ) : (
                  "-"
                )}
              </td>
              <td className={denseCellClass}>
                {row.active_group_count === 0 ? (
                  <StatusBadge tone="amber">No group yet</StatusBadge>
                ) : (
                  row.active_group_count
                )}
              </td>
              <td className={denseCellClass}>{row.exception_count}</td>
              <td className={`${denseCellClass} text-right`}>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label={`Manage ${row.application_id}`}
                  onClick={() => navigate(`/application-access/apps/${row.application_id}`)}
                >
                  Manage
                </Button>
              </td>
            </tr>
          ))}
        </DenseTable>
      )}
    </section>
  );
}

function RolesPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const rolesQuery = useApplicationRoles();
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
