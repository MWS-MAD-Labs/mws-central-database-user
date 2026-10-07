import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  ActionsMenu,
  ActionsMenuItem,
} from "../../../components/ui/ActionsMenu.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import {
  DenseTable,
  denseCellClass,
  denseRowClass,
} from "../../../components/ui/DenseTable.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { NameList } from "../../../components/ui/NameList.jsx";
import { PermissionPopover } from "./PermissionPopover.jsx";
import { Tip } from "./Tip.jsx";

// Roles of one application, highest first. The order drives every role picker.
export function AppRolesTab({ applicationId, roles }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["application-access"] });
  const toggleMutation = useMutation({
    mutationFn: (role) =>
      applicationAccessApi.updateRole(role.id, { is_active: !role.is_active }),
    onSuccess: () => {
      invalidate();
      showSuccessToast("Role updated.");
    },
    onError: (error) => showErrorToast(error, "Could not update this role."),
  });
  const deleteMutation = useMutation({
    mutationFn: (role) => applicationAccessApi.deleteRole(role.id),
    onSuccess: () => {
      invalidate();
      showSuccessToast("Role deleted.");
    },
    onError: (error) => showErrorToast(error, "Could not delete this role."),
  });
  const orderMutation = useMutation({
    mutationFn: (ids) => applicationAccessApi.reorderRoles(applicationId, ids),
    onSuccess: invalidate,
    onError: (error) => showErrorToast(error, "Could not change the order."),
  });

  const totalPage = Math.max(Math.ceil(roles.length / size), 1);
  const currentPage = Math.min(page, totalPage);
  const visible = roles.slice((currentPage - 1) * size, currentPage * size);

  function move(role, delta) {
    const ids = roles.map((item) => item.id);
    const from = ids.indexOf(role.id);
    const to = from + delta;
    if (to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    orderMutation.mutate(ids);
  }

  return (
    <section className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-(--mws-charcoal)">
          Roles
          <span className="text-sm font-normal text-(--mws-muted)">
            {roles.length}
          </span>
          <Tip
            text="Highest role first. Role pickers in groups and exceptions follow this order."
            label="About Order"
          />
        </h2>
        <button
          type="button"
          aria-label="Add Role"
          title="Add Role"
          onClick={() =>
            navigate(`/application-access/apps/${applicationId}/roles/new`)
          }
          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-(--mws-muted) transition-colors hover:bg-(--mws-soft) hover:text-(--mws-burgundy) focus-visible:outline-2 focus-visible:outline-(--mws-burgundy)"
        >
          <Plus size={18} />
        </button>
      </div>
      {roles.length === 0 ? (
        <PanelMessage>
          No roles yet. Add the first role of {applicationId}.
        </PanelMessage>
      ) : (
        <DenseTable
          minWidth={900}
          head={
            <>
              <th className="px-4 py-2.5">Order</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Label</th>
              <th className="px-4 py-2.5">For</th>
              <th className="px-4 py-2.5 text-center">Permissions</th>
              <th className="px-4 py-2.5 text-center">In Use</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </>
          }
          footer={
            <PaginationBar
              paging={{
                current_page: currentPage,
                total_page: totalPage,
                total_item: roles.length,
                size,
              }}
              itemLabel="roles"
              isLoading={orderMutation.isPending}
              onPrevious={() => setPage(Math.max(currentPage - 1, 1))}
              onNext={() => setPage(currentPage + 1)}
              onPageChange={setPage}
              onPageSizeChange={(next) => {
                setSize(next);
                setPage(1);
              }}
            />
          }
        >
          {visible.map((role) => {
            const index = roles.indexOf(role);
            return (
              <tr key={role.id} className={denseRowClass}>
                <td className={denseCellClass}>
                  <div className="flex items-center gap-1">
                    <span className="w-6 text-(--mws-muted)">{index + 1}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      aria-label={`Move ${role.key} up`}
                      disabled={index === 0 || orderMutation.isPending}
                      onClick={() => move(role, -1)}
                    >
                      <ArrowUp size={14} />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      aria-label={`Move ${role.key} down`}
                      disabled={
                        index === roles.length - 1 || orderMutation.isPending
                      }
                      onClick={() => move(role, 1)}
                    >
                      <ArrowDown size={14} />
                    </Button>
                  </div>
                </td>
                <td
                  className={`${denseCellClass} font-semibold text-(--mws-charcoal)`}
                >
                  {role.key}
                </td>
                <td className={denseCellClass}>{role.label}</td>
                <td className={denseCellClass}>
                  {[
                    role.allows_employees ? "Employees" : null,
                    role.allows_students ? "Students" : null,
                  ]
                    .filter(Boolean)
                    .join(" and ")}
                </td>
                <td className={`${denseCellClass} text-center`}>
                  <PermissionPopover permissions={role.permissions} compact />
                  {role.missing_permissions?.length > 0 ? (
                    <span className="mt-1 flex items-center justify-center gap-1 text-xs font-semibold text-[#a43c41]">
                      Missing
                      <NameList
                        names={role.missing_permissions}
                        noun="permissions"
                        title={`${role.key} is missing`}
                        danger
                      />
                    </span>
                  ) : null}
                </td>
                <td className={`${denseCellClass} text-center`}>
                  {role.active_entitlement_count}
                  {role.active_group_count > 0 ? (
                    <span className="ml-1.5 text-xs text-(--mws-muted)">
                      + {role.active_group_count}{" "}
                      {role.active_group_count === 1 ? "Group" : "Groups"}
                    </span>
                  ) : null}
                </td>
                <td className={denseCellClass}>
                  <StatusBadge tone={role.is_active ? "green" : "neutral"}>
                    {role.is_active ? "Active" : "Inactive"}
                  </StatusBadge>
                </td>
                <td className={`${denseCellClass} text-right`}>
                  <ActionsMenu
                    label={`Actions for ${applicationId} ${role.key}`}
                  >
                    {(closeMenu) => (
                      <>
                        <ActionsMenuItem
                          onClick={() => {
                            closeMenu();
                            navigate(
                              `/application-access/apps/${applicationId}/roles/${role.id}`,
                            );
                          }}
                        >
                          Edit
                        </ActionsMenuItem>
                        <ActionsMenuItem
                          tone={role.is_active ? "danger" : "success"}
                          onClick={async () => {
                            closeMenu();
                            if (role.is_active) {
                              const confirmed = await confirm({
                                title: "Deactivate role",
                                description:
                                  role.active_group_count > 0
                                    ? `${role.key} is still given by ${role.active_group_count} active group(s) of ${applicationId}. Change or turn off those groups first, or this will be refused.`
                                    : `${role.key} can no longer be granted for ${applicationId}.`,
                                confirmLabel: "Deactivate",
                              });
                              if (!confirmed) return;
                            }
                            toggleMutation.mutate(role);
                          }}
                        >
                          {role.is_active ? "Deactivate" : "Activate"}
                        </ActionsMenuItem>
                        <ActionsMenuItem
                          tone="danger"
                          disabled={
                            role.active_entitlement_count > 0 ||
                            role.active_group_count > 0
                          }
                          title={
                            role.active_entitlement_count > 0 ||
                            role.active_group_count > 0
                              ? "Still used. Deactivate it instead."
                              : undefined
                          }
                          onClick={async () => {
                            closeMenu();
                            const confirmed = await confirm({
                              title: "Delete Role",
                              description: `${role.key} will be removed from ${applicationId}. A role that was ever used by a person or a group cannot be deleted, deactivate it instead.`,
                              confirmLabel: "Delete",
                            });
                            if (confirmed) deleteMutation.mutate(role);
                          }}
                        >
                          Delete
                        </ActionsMenuItem>
                      </>
                    )}
                  </ActionsMenu>
                </td>
              </tr>
            );
          })}
        </DenseTable>
      )}
    </section>
  );
}
