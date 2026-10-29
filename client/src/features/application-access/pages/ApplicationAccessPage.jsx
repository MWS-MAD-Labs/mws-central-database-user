import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Lock, Plus } from "lucide-react";
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
import { useCheckNow } from "../hooks/useCheckNow.js";
import { copyText } from "../utils/copyText.js";
import { overallState } from "../utils/connectionState.js";
import { RemoveApplicationDialog } from "../components/RemoveApplicationDialog.jsx";
import { canManageApplications } from "../utils/canManageApplications.js";
import { startGuideHref } from "../utils/startGuide.js";

// Every application with how much access it has. Roles and groups are managed inside each one.
const STATUS_DOT = {
  green: "bg-[#476b43]",
  amber: "bg-[#c59b3b]",
  red: "bg-[#c75f64]",
  grey: "bg-[#b8b0ad]",
};

// Whether the application works: it calls Central with its token and its sign-in address answers. The note says why
// when it does not.
function RowStatus({ row }) {
  const state = overallState({
    link: false,
    isHub: row.is_hub,
    health: row.health,
    connection: { created: row.connection_created, last_used_at: row.connection_last_used_at },
  });
  return (
    <span className="block max-w-64" title={state.note}>
      <span className="flex items-center gap-1.5 font-semibold text-(--mws-charcoal)">
        <span className={`inline-block size-2 shrink-0 rounded-full ${STATUS_DOT[state.tone]}`} aria-hidden="true" />
        {state.label}
      </span>
      <span className="block truncate text-[11px] font-normal text-(--mws-muted)">{state.note}</span>
    </span>
  );
}

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
  const checkNow = useCheckNow();
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
      description: `${row.name} leaves the Hub and its token is revoked. Nothing is deleted, you can restore it.`,
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
  // The same question the Add Application page asks, so the answer is shared.
  const hubQuery = useQuery({
    queryKey: ["application-access", "hub-exists"],
    queryFn: () => applicationAccessApi.listApplications({ search: "hub", size: 20 }),
    enabled: canManageApplications(user),
  });
  const hubExists = Boolean(hubQuery.data?.data?.some((row) => row.is_hub));
  // With no Hub the note below carries the guide link, so the header one would repeat it.
  const noHub = hubQuery.isSuccess && !hubExists;
  const paging = query.data?.paging;

  if (!canManageApplications(user)) {
    return (
      <div className="min-w-0">
        <PageHeader title="Application Access" />
        <PanelMessage>
          Only a protected Super Admin can manage application access.
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
          <div className="flex flex-wrap items-center gap-2">
            {noHub ? null : (
              <Button asChild variant="secondary" size="icon" aria-label="Guide" title="Guide">
                <Link to={startGuideHref()}><BookOpen size={16} /></Link>
              </Button>
            )}
            <Button
              type="button"
              onClick={() => navigate("/application-access/apps/new")}
              size="icon" aria-label="Add Application" title="Add Application"
            >
              <Plus size={16} />
            </Button>
          </div>
        }
      />

      {noHub ? (
        <div role="note" className="rounded-xl border border-[#d8b45b] bg-[#fff8e8] p-4 text-sm text-[#745716]">
          <p className="font-semibold">No Hub has been added yet.</p>
          <p className="mt-1">
            The Hub comes first, because every application is given its address. The guide takes you from the Hub's key to a connected
            application.{" "}
            <Link to={startGuideHref("hub")} className="font-semibold underline">
              Open The Guide
            </Link>
          </p>
        </div>
      ) : null}

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
              <th className="px-4 py-2.5">Status</th>
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
                      title="The Hub itself. It can only be removed after every other application."
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
                  {row.shares_origin_with?.length ? (
                    <span title={`Same address start as ${row.shares_origin_with.join(", ")}`}>
                      <StatusBadge tone="neutral">Shared Origin</StatusBadge>
                    </span>
                  ) : null}
                  {row.launch_mode === "link" ? (
                    <StatusBadge tone="neutral">Plain Link</StatusBadge>
                  ) : null}
                  {row.launch_mode !== "link" && row.session_mode === "shared" ? (
                    <StatusBadge tone="neutral">Shared Session</StatusBadge>
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
                ) : (
                  <RowStatus row={row} />
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
                        Open
                      </ActionsMenuItem>
                      {!row.is_hub && !row.retired && row.launch_mode !== "link" ? (
                        <ActionsMenuItem
                          onClick={() => {
                            closeMenu();
                            checkNow.mutate(row.application_id);
                          }}
                        >
                          Check Now
                        </ActionsMenuItem>
                      ) : null}
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
