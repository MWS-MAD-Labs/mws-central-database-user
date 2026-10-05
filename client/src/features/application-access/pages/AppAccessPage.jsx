import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { ActionsMenu, ActionsMenuItem } from "../../../components/ui/ActionsMenu.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { DenseTable, denseCellClass, denseRowClass } from "../../../components/ui/DenseTable.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { ChangeRoleDialog } from "../components/ChangeRoleDialog.jsx";
import { useApplicationRoles } from "../hooks/useApplicationRoles.js";
import { copyText } from "../utils/copyText.js";
import { groupScopeSummary, groupTitle } from "../utils/groupSummary.js";

const BACK = "/application-access";

export function AppAccessPage() {
  const { user } = useAuth();
  const { applicationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [roleTarget, setRoleTarget] = useState(null);

  const detailQuery = useQuery({
    queryKey: ["application-access", "app", applicationId],
    queryFn: () => applicationAccessApi.getApplication(applicationId),
  });
  const roles = useApplicationRoles().data || [];
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
  const blockMutation = useMutation({
    mutationFn: (id) => applicationAccessApi.revoke(id),
    onSuccess: () => {
      invalidate();
      showSuccessToast("Access blocked.");
    },
    onError: (error) => showErrorToast(error, "Could not block this access."),
  });
  const unblockMutation = useMutation({
    mutationFn: (row) =>
      applicationAccessApi.grant({
        person_id: row.person_id,
        application_id: applicationId,
        role: row.role,
      }),
    onSuccess: () => {
      invalidate();
      showSuccessToast("Access unblocked.");
    },
    onError: (error) => showErrorToast(error, "Could not unblock this access."),
  });
  const removeMutation = useMutation({
    mutationFn: (id) => applicationAccessApi.removeEntitlement(id),
    onSuccess: () => {
      invalidate();
      showSuccessToast("Exception removed.");
    },
    onError: (error) => showErrorToast(error, "Could not remove this exception."),
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
  const titleOf = (id) => {
    const group = detail.groups.find((item) => item.id === id);
    return group ? `${groupTitle(group)} (${groupScopeSummary(group)})` : null;
  };

  async function removeException(row) {
    const confirmed = await confirm({
      title: "Remove exception",
      description: `${row.full_name} falls back to the role of their group on ${applicationId}.`,
      confirmLabel: "Remove",
    });
    if (confirmed) removeMutation.mutate(row.id);
  }

  function exceptionMenu(row, canChange) {
    return (
      <ActionsMenu label={`Actions for ${row.full_name} on ${applicationId}`}>
        {(closeMenu) => (
          <>
            {row.is_active && canChange ? (
              <ActionsMenuItem
                onClick={() => {
                  closeMenu();
                  setRoleTarget(row);
                }}
              >
                Change role
              </ActionsMenuItem>
            ) : null}
            {!row.is_active && canChange ? (
              <ActionsMenuItem
                onClick={() => {
                  closeMenu();
                  unblockMutation.mutate(row);
                }}
              >
                Unblock
              </ActionsMenuItem>
            ) : null}
            <ActionsMenuItem
              onClick={() => {
                closeMenu();
                removeException(row);
              }}
            >
              Remove
            </ActionsMenuItem>
            {row.is_active ? (
              <ActionsMenuItem
                tone="danger"
                onClick={async () => {
                  closeMenu();
                  const confirmed = await confirm({
                    title: "Block access",
                    description: `${row.full_name} will not be able to open ${applicationId}, even if a group covers them.`,
                    confirmLabel: "Block",
                  });
                  if (confirmed) blockMutation.mutate(row.id);
                }}
              >
                Block access
              </ActionsMenuItem>
            ) : null}
          </>
        )}
      </ActionsMenu>
    );
  }

  function exceptionTable(rows, canChange) {
    return (
      <DenseTable
        minWidth={700}
        head={
          <>
            <th className="px-4 py-2.5">Person</th>
            <th className="px-4 py-2.5">Unit</th>
            <th className="px-4 py-2.5">Role</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5 text-right">Actions</th>
          </>
        }
      >
        {rows.map((row) => (
          <tr key={row.id} className={denseRowClass}>
            <td className={`${denseCellClass} max-w-64`}>
              <span className="block truncate font-semibold text-(--mws-charcoal)">{row.full_name}</span>
              <span className="block truncate text-xs text-(--mws-muted)">{row.email}</span>
            </td>
            <td className={denseCellClass}>{row.unit || "-"}</td>
            <td className={denseCellClass}>
              <span title={row.permissions.join(", ")}>{row.role}</span>
            </td>
            <td className={denseCellClass}>
              <StatusBadge tone={row.is_active ? "green" : "neutral"}>
                {row.is_active ? "Active" : "Blocked"}
              </StatusBadge>
            </td>
            <td className={`${denseCellClass} text-right`}>
              {exceptionMenu(row, canChange)}
            </td>
          </tr>
        ))}
      </DenseTable>
    );
  }

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title={applicationId}
        description="Group access says who can use this application and with which role. Exceptions give someone inside a group a different role."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to={BACK}>
                <ArrowLeft size={16} />
                Back
              </Link>
            </Button>
            <Button type="button" onClick={() => navigate(`/application-access/apps/${applicationId}/groups/new`)}>
              <Plus size={16} />
              Add group
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-(--mws-line) bg-white px-5 py-3 text-sm">
        <span className="font-semibold text-(--mws-charcoal)">Organization ID</span>
        {detail.organization_id ? (
          <>
            <code className="text-sm">{detail.organization_id}</code>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label="Copy Organization ID"
              onClick={() => copyText(detail.organization_id)}
            >
              <Copy size={14} />
              Copy
            </Button>
          </>
        ) : (
          <span className="text-(--mws-muted)">Created automatically with the first group or role.</span>
        )}
      </div>

      {detail.groups.length === 0 ? (
        <PanelMessage>
          No group access yet. Add a group first. It decides who can use {applicationId}, and exceptions go inside it.
        </PanelMessage>
      ) : (
        detail.groups.map((group) => (
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
                <h3 className="font-display text-sm font-bold text-(--mws-charcoal)">Exceptions</h3>
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
              {group.exceptions.length === 0 ? (
                <p className="text-sm text-(--mws-muted)">
                  No exceptions. Everyone this group covers gets {group.default_role_key}.
                </p>
              ) : (
                exceptionTable(group.exceptions, true)
              )}
            </div>
          </section>
        ))
      )}

      {detail.other.length > 0 ? (
        <section className="min-w-0 space-y-3 rounded-2xl border border-(--mws-line) bg-white p-5">
          <div>
            <h2 className="font-display text-base font-bold text-(--mws-charcoal)">Other access</h2>
            <p className="text-sm text-(--mws-muted)">
              Older access for people no group covers. It can be removed or blocked, not changed.
            </p>
          </div>
          {exceptionTable(detail.other, false)}
        </section>
      ) : null}

      {roleTarget ? (
        <ChangeRoleDialog
          applicationId={applicationId}
          exception={roleTarget}
          roles={roles}
          onClose={() => setRoleTarget(null)}
          onDone={invalidate}
        />
      ) : null}
    </div>
  );
}
