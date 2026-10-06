import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { ActionsMenu, ActionsMenuItem } from "../../../components/ui/ActionsMenu.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { AppRolesTab } from "../components/AppRolesTab.jsx";
import { CopyableId } from "../components/CopyableId.jsx";
import { ExceptionsPanel } from "../components/ExceptionsPanel.jsx";
import { useApplicationRoles } from "../hooks/useApplicationRoles.js";
import { groupScopeSummary, groupTitle } from "../utils/groupSummary.js";

const BACK = "/application-access";
const GROUP_PAGE_SIZE = 5;
const tabs = [
  { id: "access", label: "Access" },
  { id: "roles", label: "Roles" },
];

export function AppAccessPage() {
  const { user } = useAuth();
  const { applicationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [groupPage, setGroupPage] = useState(1);
  const activeTab = tabs.some((tab) => tab.id === searchParams.get("tab")) ? searchParams.get("tab") : "access";

  const detailQuery = useQuery({
    queryKey: ["application-access", "app", applicationId],
    queryFn: () => applicationAccessApi.getApplication(applicationId),
  });
  const allRoles = useApplicationRoles().data || [];
  const roles = allRoles.filter((role) => role.application_id === applicationId);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["application-access"] });

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

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-w-0">
        <PageHeader title={applicationId} />
        <PanelMessage>Only Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }
  if (detailQuery.isLoading) return <PanelMessage>Loading {applicationId}…</PanelMessage>;
  if (detailQuery.isError || !detailQuery.data) {
    return <PanelMessage tone="error">This application could not be found.</PanelMessage>;
  }

  const detail = detailQuery.data;
  const totalGroupPage = Math.max(Math.ceil(detail.groups.length / GROUP_PAGE_SIZE), 1);
  const currentGroupPage = Math.min(groupPage, totalGroupPage);
  const visibleGroups = detail.groups.slice((currentGroupPage - 1) * GROUP_PAGE_SIZE, currentGroupPage * GROUP_PAGE_SIZE);
  const titleOf = (id) => {
    const group = detail.groups.find((item) => item.id === id);
    return group ? `${groupTitle(group)} (${groupScopeSummary(group)})` : null;
  };

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title={applicationId}
        description="Roles are defined here. Group access says who can use this application and with which role, and exceptions give someone inside a group a different role."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to={BACK}>
                <ArrowLeft size={16} />
                Back
              </Link>
            </Button>
            {activeTab === "access" ? (
              <Button type="button" onClick={() => navigate(`/application-access/apps/${applicationId}/groups/new`)}>
                <Plus size={16} />
                Add group
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-(--mws-line) bg-white px-5 py-3 text-sm">
        <span className="font-semibold text-(--mws-charcoal)">Organization ID</span>
        {detail.organization_id ? (
          <CopyableId value={detail.organization_id} />
        ) : (
          <span className="text-(--mws-muted)">Created automatically with the first group or role.</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
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

      {activeTab === "roles" ? (
        <AppRolesTab applicationId={applicationId} roles={roles} />
      ) : (
        <>
          {detail.groups.length === 0 ? (
            <PanelMessage>
              No group access yet. Add a group first. It decides who can use {applicationId}, and exceptions go
              inside it.
            </PanelMessage>
          ) : (
            visibleGroups.map((group) => (
              <section
                key={group.id}
                className="min-w-0 space-y-4 rounded-2xl border border-(--mws-line) bg-white p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-base font-bold text-(--mws-charcoal)">{groupTitle(group)}</h2>
                      <StatusBadge tone={group.is_active ? "green" : "neutral"}>
                        {group.is_active ? "On" : "Off"}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-sm text-(--mws-muted)">{groupScopeSummary(group)}</p>
                    {group.parent_group_id ? (
                      <p className="text-xs text-(--mws-muted)">Inside {titleOf(group.parent_group_id)}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-(--mws-charcoal)">
                      Role <strong title={group.permissions.join(", ")}>{group.default_role_key}</strong>
                    </span>
                    <ActionsMenu label={`Actions for group ${groupTitle(group)}, ${groupScopeSummary(group)}`}>
                      {(closeMenu) => (
                        <>
                          <ActionsMenuItem
                            onClick={() => {
                              closeMenu();
                              navigate(`/application-access/apps/${applicationId}/groups/${group.id}`);
                            }}
                          >
                            Edit
                          </ActionsMenuItem>
                          <ActionsMenuItem
                            onClick={() => {
                              closeMenu();
                              groupMutation.mutate({ id: group.id, patch: { is_active: !group.is_active } });
                            }}
                          >
                            {group.is_active ? "Turn off" : "Turn on"}
                          </ActionsMenuItem>
                          <ActionsMenuItem
                            tone="danger"
                            onClick={async () => {
                              closeMenu();
                              const confirmed = await confirm({
                                title: "Delete group access",
                                description: `${groupTitle(group)} will no longer get ${group.default_role_key} on ${applicationId}.`,
                                confirmLabel: "Delete",
                              });
                              if (confirmed) deleteGroupMutation.mutate(group.id);
                            }}
                          >
                            Delete
                          </ActionsMenuItem>
                        </>
                      )}
                    </ActionsMenu>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-display text-sm font-bold text-(--mws-charcoal)">
                      Exceptions
                      {group.exception_count > 0 ? (
                        <span className="ml-2 text-xs font-normal text-(--mws-muted)">
                          {group.exception_count}
                          {group.blocked_count > 0 ? `, ${group.blocked_count} blocked` : ""}
                        </span>
                      ) : null}
                    </h3>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!group.is_active || group.audience === "STUDENTS"}
                      title={
                        group.audience === "STUDENTS"
                          ? "Exceptions are for employees"
                          : !group.is_active
                            ? "Turn the group on first"
                            : undefined
                      }
                      onClick={() =>
                        navigate(`/application-access/apps/${applicationId}/groups/${group.id}/exceptions/new`)
                      }
                    >
                      <Plus size={14} />
                      Add exception
                    </Button>
                  </div>
                  <ExceptionsPanel
                    applicationId={applicationId}
                    groupId={group.id}
                    roles={roles}
                    canChange
                    total={group.exception_count}
                    emptyText={`No exceptions. Everyone this group covers gets ${group.default_role_key}.`}
                  />
                </div>
              </section>
            ))
          )}

          {detail.groups.length > GROUP_PAGE_SIZE ? (
            <div className="overflow-hidden rounded-2xl border border-(--mws-line)">
              <PaginationBar
                paging={{
                  current_page: currentGroupPage,
                  total_page: totalGroupPage,
                  total_item: detail.groups.length,
                  size: GROUP_PAGE_SIZE,
                }}
                itemLabel="groups"
                onPrevious={() => setGroupPage(Math.max(currentGroupPage - 1, 1))}
                onNext={() => setGroupPage(currentGroupPage + 1)}
                onPageChange={setGroupPage}
              />
            </div>
          ) : null}

          {detail.other_count > 0 ? (
            <section className="min-w-0 space-y-3 rounded-2xl border border-(--mws-line) bg-white p-5">
              <div>
                <h2 className="font-display text-base font-bold text-(--mws-charcoal)">Other access</h2>
                <p className="text-sm text-(--mws-muted)">
                  Older access for people no group covers. It can be removed or blocked, not changed.
                </p>
              </div>
              <ExceptionsPanel
                applicationId={applicationId}
                groupId="other"
                roles={roles}
                canChange={false}
                total={detail.other_count}
              />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
