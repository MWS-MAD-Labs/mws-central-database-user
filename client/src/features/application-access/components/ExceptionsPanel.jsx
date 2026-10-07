import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActionsMenu, ActionsMenuItem } from "../../../components/ui/ActionsMenu.jsx";
import { DenseTable, denseCellClass, denseRowClass } from "../../../components/ui/DenseTable.jsx";
import { DebouncedSearchInput } from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { ChangeRoleDialog } from "./ChangeRoleDialog.jsx";
import { RoleName } from "./RoleName.jsx";

// Paged exceptions of one group, or of "other" (access no group covers).
export function ExceptionsPanel({ applicationId, groupId, roles, canChange, total, emptyText }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [roleTarget, setRoleTarget] = useState(null);

  const query = useQuery({
    queryKey: ["application-access", "exceptions", applicationId, groupId, { search, page, size }],
    queryFn: () =>
      applicationAccessApi.listExceptions(applicationId, {
        group_id: groupId,
        search: search || undefined,
        page,
        size,
      }),
    placeholderData: (previous) => previous,
  });
  const rows = query.data?.data || [];
  const paging = query.data?.paging;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["application-access"] });

  const blockMutation = useMutation({
    mutationFn: (id) => applicationAccessApi.revoke(id),
    onSuccess: () => {
      invalidate();
      showSuccessToast("Access blocked.");
    },
    onError: (error) => showErrorToast(error, "Could not block this access."),
  });
  const unblockMutation = useMutation({
    mutationFn: (row) => applicationAccessApi.unblock(row.id),
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

  if (total === 0) return <p className="text-sm text-(--mws-muted)">{emptyText}</p>;

  async function remove(row) {
    const confirmed = await confirm({
      title: "Remove exception",
      description: `${row.full_name} falls back to the role of their group on ${applicationId}.`,
      confirmLabel: "Remove",
    });
    if (confirmed) removeMutation.mutate(row.id);
  }

  async function block(row) {
    const confirmed = await confirm({
      title: "Block Access",
      description: `${row.full_name} will not be able to open ${applicationId}, even if a group covers them.`,
      confirmLabel: "Block",
    });
    if (confirmed) blockMutation.mutate(row.id);
  }

  return (
    <div className="space-y-2">
      <div className="w-full sm:w-72">
        <DebouncedSearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search people"
        />
      </div>
      <DenseTable
        dimmed={query.isPlaceholderData}
        minWidth={820}
        head={
          <>
            <th className="px-4 py-2.5">Person</th>
            <th className="px-4 py-2.5">Unit</th>
            <th className="px-4 py-2.5">Job Position</th>
            <th className="px-4 py-2.5">Role</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5 text-right">Actions</th>
          </>
        }
        footer={
          paging && paging.total_item > 0 ? (
            <PaginationBar
              paging={paging}
              itemLabel="people"
              isLoading={query.isFetching}
              onPrevious={() => setPage((current) => Math.max(current - 1, 1))}
              onNext={() => setPage((current) => current + 1)}
              onPageChange={setPage}
              onPageSizeChange={(next) => {
                setSize(next);
                setPage(1);
              }}
            />
          ) : null
        }
      >
        {rows.length === 0 && !query.isLoading ? (
          <tr>
            <td colSpan={6} className="px-4 py-6 text-center text-sm text-(--mws-muted)">
              No one matches this search.
            </td>
          </tr>
        ) : null}
        {rows.map((row) => (
          <tr key={row.id} className={denseRowClass}>
            <td className={`${denseCellClass} max-w-64`}>
              <span className="block truncate font-semibold text-(--mws-charcoal)">{row.full_name}</span>
              <span className="block truncate text-xs text-(--mws-muted)">{row.email}</span>
            </td>
            <td className={denseCellClass}>{row.unit || "-"}</td>
            <td className={denseCellClass}>{row.job_position || "-"}</td>
            <td className={denseCellClass}>
              <span title={row.permissions.join(", ")}>
                <RoleName>{row.role}</RoleName>
              </span>
            </td>
            <td className={denseCellClass}>
              <StatusBadge tone={row.is_active ? "green" : "neutral"}>
                {row.is_active ? "Active" : "Blocked"}
              </StatusBadge>
            </td>
            <td className={`${denseCellClass} text-right`}>
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
                        Change Role
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
                        remove(row);
                      }}
                    >
                      Remove
                    </ActionsMenuItem>
                    {row.is_active ? (
                      <ActionsMenuItem
                        tone="danger"
                        onClick={() => {
                          closeMenu();
                          block(row);
                        }}
                      >
                        Block Access
                      </ActionsMenuItem>
                    ) : null}
                  </>
                )}
              </ActionsMenu>
            </td>
          </tr>
        ))}
      </DenseTable>
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
