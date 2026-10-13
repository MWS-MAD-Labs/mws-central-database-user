import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  ActionsMenu,
  ActionsMenuItem,
} from "../../../components/ui/ActionsMenu.jsx";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import {
  DenseTable,
  denseCellClass,
  denseRowClass,
} from "../../../components/ui/DenseTable.jsx";
import { DebouncedSearchInput } from "../../../components/ui/FormControls.jsx";
import { PageHint } from "../../../components/ui/PageHint.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { formatDateTime } from "../../../lib/format.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import {
  nameOf,
  useApplicationTaxonomy,
} from "../hooks/useApplicationTaxonomy.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { copyText } from "../utils/copyText.js";
import { timeAgo } from "../utils/setupSteps.js";
import { RemoveApplicationDialog } from "../components/RemoveApplicationDialog.jsx";

// Every application with how much access it has. Roles and groups are managed inside each one.
export function ApplicationAccessPage() {
  const taxonomy = useApplicationTaxonomy();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [removingId, setRemovingId] = useState(null);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["application-access"] });
  const retireMutation = useMutation({
    mutationFn: (applicationId) =>
      applicationAccessApi.retireApplication(applicationId),
    onSuccess: () => {
      refresh();
      showSuccessToast("Application retired.");
    },
    onError: (error) =>
      showErrorToast(error, "Could not retire this application."),
  });
  const restoreMutation = useMutation({
    mutationFn: (applicationId) =>
      applicationAccessApi.restoreApplication(applicationId),
    onSuccess: () => {
      refresh();
      showSuccessToast(
        "Application restored. Create a new connection to use it again.",
      );
    },
    onError: (error) =>
      showErrorToast(error, "Could not restore this application."),
  });

  async function retire(row) {
    const confirmed = await confirm({
      title: "Retire Application",
      description: `${row.name} will stop working: its token is revoked, it disappears from the Hub and nobody has access. Nothing is deleted, and you can restore it later.`,
      confirmLabel: "Retire",
      tone: "danger",
    });
    if (confirmed) retireMutation.mutate(row.application_id);
  }

  const query = useQuery({
    queryKey: ["application-access", "applications", { search, page, size }],
    queryFn: () =>
      applicationAccessApi.listApplications({
        search: search || undefined,
        page,
        size,
      }),
    placeholderData: (previous) => previous,
  });
  const rows = query.data?.data || [];
  const paging = query.data?.paging;

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-w-0">
        <PageHeader title="Application Access" />
        <PanelMessage>
          Only Super Admin can manage application access.
        </PanelMessage>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="Application Access"
        description="Who can open each application and with which role. Open an application to manage its roles, groups and exceptions."
        actions={
          <Button
            type="button"
            onClick={() => navigate("/application-access/apps/new")}
          >
            <Plus size={16} />
            Add Application
          </Button>
        }
      />

      <div className="w-full sm:w-80">
        <DebouncedSearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search applications"
        />
      </div>

      {query.isLoading ? (
        <PanelMessage>Loading applications…</PanelMessage>
      ) : rows.length === 0 ? (
        <PanelMessage>
          {search
            ? "No applications match this search."
            : "No applications yet."}
        </PanelMessage>
      ) : (
        <DenseTable
          dimmed={query.isPlaceholderData}
          minWidth={1000}
          head={
            <>
              <th className="px-4 py-2.5">Application</th>
              <th className="px-4 py-2.5">Connection</th>
              <th className="px-4 py-2.5 text-center">Permissions</th>
              <th className="px-4 py-2.5 text-center">Roles</th>
              <th className="px-4 py-2.5 text-center">Groups</th>
              <th className="px-4 py-2.5 text-center">Exceptions</th>
              <th className="px-4 py-2.5">Updated</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </>
          }
          footer={
            paging && paging.total_item > 0 ? (
              <PaginationBar
                paging={paging}
                itemLabel="applications"
                isLoading={query.isFetching}
                onPrevious={() =>
                  setPage((current) => Math.max(current - 1, 1))
                }
                onNext={() => setPage((current) => current + 1)}
                onPageSizeChange={(nextSize) => {
                  setSize(nextSize);
                  setPage(1);
                }}
              />
            ) : null
          }
        >
          {rows.map((row) => (
            <tr
              key={row.application_id}
              className={
                row.is_hub
                  ? "border-t border-l-4 border-(--mws-line) border-l-(--mws-burgundy) bg-[#7E15180A] hover:bg-[#7E151812]"
                  : denseRowClass
              }
            >
              <td className={`${denseCellClass} min-w-56`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link
                    to={`/application-access/apps/${row.application_id}`}
                    className="font-semibold text-(--mws-charcoal) hover:text-(--mws-burgundy) hover:underline"
                  >
                    {row.name}
                  </Link>
                  {row.is_hub ? (
                    <span
                      title="The Hub itself. It cannot be retired or deleted."
                      className="inline-flex items-center gap-1 rounded-full bg-(--mws-burgundy) px-2 py-0.5 text-[11px] font-bold text-white"
                    >
                      <Lock size={11} aria-hidden="true" />
                      Core
                    </span>
                  ) : null}
                  {row.retired ? (
                    <StatusBadge tone="red">Retired</StatusBadge>
                  ) : null}
                  {row.published ? (
                    <StatusBadge tone="green">In Hub</StatusBadge>
                  ) : null}
                  {row.launch_mode === "link" ? (
                    <StatusBadge tone="neutral">Plain Link</StatusBadge>
                  ) : null}
                  {row.scope ? (
                    <StatusBadge tone="neutral">
                      {nameOf(taxonomy.scopes, row.scope) || row.scope}
                    </StatusBadge>
                  ) : null}
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-(--mws-muted)">
                  {row.application_id}
                </p>
              </td>
              <td className={`${denseCellClass} text-xs`}>
                {row.launch_mode === "link" ? (
                  <span className="text-(--mws-muted)">Not needed</span>
                ) : !row.connection_created ? (
                  <StatusBadge tone="amber">Not Connected</StatusBadge>
                ) : row.connection_last_used_at ? (
                  <span className="text-(--mws-charcoal)">
                    <span
                      className="mr-1.5 inline-block size-2 rounded-full bg-[#476b43]"
                      aria-hidden="true"
                    />
                    {timeAgo(row.connection_last_used_at)}
                  </span>
                ) : (
                  <span className="text-(--mws-muted)">
                    <span
                      className="mr-1.5 inline-block size-2 rounded-full bg-[#c59b3b]"
                      aria-hidden="true"
                    />
                    Waiting for the first call
                  </span>
                )}
              </td>
              <td className={`${denseCellClass} text-center`}>
                {row.launch_mode === "link" ? (
                  "-"
                ) : row.permission_count === 0 ? (
                  <StatusBadge tone="amber">None</StatusBadge>
                ) : (
                  row.permission_count
                )}
              </td>
              <td className={`${denseCellClass} text-center`}>
                {row.role_count === 0 ? (
                  <StatusBadge tone="amber">None</StatusBadge>
                ) : (
                  row.role_count
                )}
              </td>
              <td className={`${denseCellClass} text-center`}>
                {row.active_group_count === 0 ? (
                  <StatusBadge tone="amber">None</StatusBadge>
                ) : (
                  row.active_group_count
                )}
              </td>
              <td className={`${denseCellClass} text-center`}>
                {row.exception_count}
                {row.blocked_count > 0 ? (
                  <StatusBadge tone="red" className="ml-2">
                    {row.blocked_count} Blocked
                  </StatusBadge>
                ) : null}
              </td>
              <td
                className={`${denseCellClass} whitespace-nowrap text-xs text-(--mws-muted)`}
              >
                {row.updated_at ? formatDateTime(row.updated_at) : "-"}
              </td>
              <td className={`${denseCellClass} text-right`}>
                <ActionsMenu label={`Actions for ${row.application_id}`}>
                  {(closeMenu) => (
                    <>
                      <ActionsMenuItem
                        onClick={() => {
                          closeMenu();
                          navigate(
                            `/application-access/apps/${row.application_id}`,
                          );
                        }}
                      >
                        Manage Access
                      </ActionsMenuItem>
                      <ActionsMenuItem
                        onClick={() => {
                          closeMenu();
                          navigate(
                            `/application-access/apps/${row.application_id}/${row.setup_completed ? "settings" : "setup"}`,
                          );
                        }}
                      >
                        {row.setup_completed ? "Settings" : "Continue Setup"}
                      </ActionsMenuItem>
                      {row.organization_id ? (
                        <ActionsMenuItem
                          onClick={() => {
                            closeMenu();
                            copyText(row.organization_id);
                          }}
                        >
                          Copy Organization ID
                        </ActionsMenuItem>
                      ) : null}
                      {row.is_hub &&
                      !row.retired &&
                      !row.retire_available &&
                      !row.can_remove ? null : (
                        <>
                          <div className="my-1 border-t border-(--mws-line)" />
                          {row.retired ? (
                            <ActionsMenuItem
                              tone="success"
                              onClick={() => {
                                closeMenu();
                                restoreMutation.mutate(row.application_id);
                              }}
                            >
                              Restore Application
                            </ActionsMenuItem>
                          ) : !row.is_hub || row.retire_available ? (
                            <ActionsMenuItem
                              tone="warning"
                              onClick={() => {
                                closeMenu();
                                retire(row);
                              }}
                            >
                              Retire Application
                            </ActionsMenuItem>
                          ) : null}
                          {row.can_remove ? (
                            <ActionsMenuItem
                              tone="danger"
                              onClick={() => {
                                closeMenu();
                                setRemovingId(row.application_id);
                              }}
                            >
                              Delete Application
                            </ActionsMenuItem>
                          ) : null}
                        </>
                      )}
                    </>
                  )}
                </ActionsMenu>
              </td>
            </tr>
          ))}
        </DenseTable>
      )}

      {removingId ? (
        <RemoveApplicationDialog
          applicationId={removingId}
          onClose={() => setRemovingId(null)}
          onRemoved={() => setRemovingId(null)}
        />
      ) : null}

      <PageHint id="application-access-source-of-truth">
        Open an application to manage it. Add its roles first, then a group: the
        group says who can use the app and with which role. Exceptions inside a
        group give some people another role. The most specific access wins, a
        blocked person stays blocked, and a group can only be removed after its
        exceptions.
      </PageHint>
    </div>
  );
}
