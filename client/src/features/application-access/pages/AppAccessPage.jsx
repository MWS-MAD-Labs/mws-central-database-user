import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { DebouncedSearchInput, FilterSelect } from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { AppPermissionsTab } from "../components/AppPermissionsTab.jsx";
import { AppRolesTab } from "../components/AppRolesTab.jsx";
import { CopyableId } from "../components/CopyableId.jsx";
import { ExceptionsPanel } from "../components/ExceptionsPanel.jsx";
import { GroupCard } from "../components/GroupCard.jsx";
import { useApplicationRoles } from "../hooks/useApplicationRoles.js";
import { groupScopeSummary, groupTitle } from "../utils/groupSummary.js";

const BACK = "/application-access";
const GROUP_PAGE_SIZE = 10;
const tabs = [
  { id: "access", label: "Access" },
  { id: "roles", label: "Roles" },
  { id: "permissions", label: "Permissions" },
];

export function AppAccessPage() {
  const { user } = useAuth();
  const { applicationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [groupPage, setGroupPage] = useState(1);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupStatus, setGroupStatus] = useState("");
  const [openId, setOpenId] = useState(undefined);
  const activeTab = tabs.some((tab) => tab.id === searchParams.get("tab")) ? searchParams.get("tab") : "access";

  const detailQuery = useQuery({
    queryKey: ["application-access", "app", applicationId],
    queryFn: () => applicationAccessApi.getApplication(applicationId),
  });
  const allRoles = useApplicationRoles().data || [];
  const roles = allRoles.filter((role) => role.application_id === applicationId);
  const hasActiveRole = roles.some((role) => role.is_active);
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
  const needle = groupSearch.trim().toLowerCase();
  const filteredGroups = detail.groups.filter((group) => {
    if (groupStatus === "ACTIVE" && !group.is_active) return false;
    if (groupStatus === "INACTIVE" && group.is_active) return false;
    if (!needle) return true;
    return [groupTitle(group), group.default_role_key, groupScopeSummary(group)]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  // A lone group opens by itself, otherwise one at a time.
  const openGroupId = openId === undefined ? (detail.groups.length === 1 ? detail.groups[0].id : null) : openId;
  const totalGroupPage = Math.max(Math.ceil(filteredGroups.length / GROUP_PAGE_SIZE), 1);
  const currentGroupPage = Math.min(groupPage, totalGroupPage);
  const visibleGroups = filteredGroups.slice((currentGroupPage - 1) * GROUP_PAGE_SIZE, currentGroupPage * GROUP_PAGE_SIZE);
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
              <Button
                type="button"
                disabled={!hasActiveRole}
                title={hasActiveRole ? undefined : "Add a role first"}
                onClick={() => navigate(`/application-access/apps/${applicationId}/groups/new`)}
              >
                <Plus size={16} />
                Add Group
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
      ) : activeTab === "permissions" ? (
        <AppPermissionsTab applicationId={applicationId} />
      ) : (
        <>
          {detail.groups.length === 0 ? (
            <PanelMessage>
              No group access yet. Add a group first. It decides who can use {applicationId}, and exceptions go
              inside it.
            </PanelMessage>
          ) : (
            <>
              {detail.groups.length > 5 ? (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-full sm:w-80">
                    <DebouncedSearchInput
                      value={groupSearch}
                      onChange={(value) => {
                        setGroupSearch(value);
                        setGroupPage(1);
                      }}
                      placeholder="Search groups"
                    />
                  </div>
                  <FilterSelect
                    label="Status"
                    value={groupStatus}
                    onChange={(value) => {
                      setGroupStatus(value);
                      setGroupPage(1);
                    }}
                    options={[
                      { value: "", label: "All Statuses" },
                      { value: "ACTIVE", label: "Active" },
                      { value: "INACTIVE", label: "Inactive" },
                    ]}
                  />
                </div>
              ) : null}
              {filteredGroups.length === 0 ? (
                <PanelMessage>No groups match this search.</PanelMessage>
              ) : (
                visibleGroups.map((group) => (
                  <GroupCard
                    key={group.id}
                    group={group}
                    open={openGroupId === group.id}
                    onToggle={() => setOpenId(openGroupId === group.id ? null : group.id)}
                    applicationId={applicationId}
                    roles={roles}
                    parentRole={detail.groups.find((item) => item.id === group.parent_group_id)?.default_role_key ?? null}
                    narrower={detail.groups.filter((item) => item.parent_group_id === group.id)}
                    onEdit={() => navigate(`/application-access/apps/${applicationId}/groups/${group.id}`)}
                    onSwitch={() => groupMutation.mutate({ id: group.id, patch: { is_active: !group.is_active } })}
                    onDelete={async () => {
                      const confirmed = await confirm({
                        title: "Delete group access",
                        description: `${groupTitle(group)} will no longer get ${group.default_role_key} on ${applicationId}.`,
                        confirmLabel: "Delete",
                      });
                      if (confirmed) deleteGroupMutation.mutate(group.id);
                    }}
                    onAddException={() =>
                      navigate(`/application-access/apps/${applicationId}/groups/${group.id}/exceptions/new`)
                    }
                  />
                ))
              )}
            </>
          )}

          {filteredGroups.length > GROUP_PAGE_SIZE ? (
            <div className="overflow-hidden rounded-2xl border border-(--mws-line)">
              <PaginationBar
                paging={{
                  current_page: currentGroupPage,
                  total_page: totalGroupPage,
                  total_item: filteredGroups.length,
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
                <h2 className="font-display text-base font-bold text-(--mws-charcoal)">Other Access</h2>
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
