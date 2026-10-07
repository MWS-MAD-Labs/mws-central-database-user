import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { DenseTable, denseCellClass, denseRowClass } from "../../../components/ui/DenseTable.jsx";
import { DebouncedSearchInput } from "../../../components/ui/FormControls.jsx";
import { PageHint } from "../../../components/ui/PageHint.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { formatDateTime } from "../../../lib/format.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { CopyableId } from "../components/CopyableId.jsx";

// Every application with how much access it has. Roles and groups are managed inside each one.
export function ApplicationAccessPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);

  const query = useQuery({
    queryKey: ["application-access", "applications", { search, page, size }],
    queryFn: () => applicationAccessApi.listApplications({ search: search || undefined, page, size }),
    placeholderData: (previous) => previous,
  });
  const rows = query.data?.data || [];
  const paging = query.data?.paging;

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-w-0">
        <PageHeader title="Application Access" />
        <PanelMessage>Only Super Admin can manage application access.</PanelMessage>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="Application Access"
        description="Who can open each application and with which role. Open an application to manage its roles, groups and exceptions."
        actions={
          <Button type="button" onClick={() => navigate("/application-access/apps/new")}>
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
        <PanelMessage>{search ? "No applications match this search." : "No applications yet."}</PanelMessage>
      ) : (
        <DenseTable
          dimmed={query.isPlaceholderData}
          minWidth={900}
          head={
            <>
              <th className="px-4 py-2.5">Application</th>
              <th className="px-4 py-2.5">Organization ID</th>
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
                onPrevious={() => setPage((current) => Math.max(current - 1, 1))}
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
            <tr key={row.application_id} className={denseRowClass}>
              <td className={`${denseCellClass} font-semibold text-(--mws-charcoal)`}>{row.application_id}</td>
              <td className={`${denseCellClass} max-w-64`}>
                {row.organization_id ? <CopyableId value={row.organization_id} /> : "-"}
              </td>
              <td className={`${denseCellClass} text-center`}>
                {row.role_count === 0 ? <StatusBadge tone="amber">None</StatusBadge> : row.role_count}
              </td>
              <td className={`${denseCellClass} text-center`}>
                {row.active_group_count === 0 ? <StatusBadge tone="amber">None</StatusBadge> : row.active_group_count}
              </td>
              <td className={`${denseCellClass} text-center`}>
                {row.exception_count}
                {row.blocked_count > 0 ? (
                  <span className="ml-2 text-xs text-(--mws-muted)">{row.blocked_count} blocked</span>
                ) : null}
              </td>
              <td className={`${denseCellClass} whitespace-nowrap text-xs text-(--mws-muted)`}>
                {row.updated_at ? formatDateTime(row.updated_at) : "-"}
              </td>
              <td className={`${denseCellClass} text-right`}>
                <button
                  type="button"
                  aria-label={`Manage ${row.application_id}`}
                  title="Manage"
                  onClick={() => navigate(`/application-access/apps/${row.application_id}`)}
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-(--mws-muted) transition-colors hover:bg-(--mws-soft) hover:text-(--mws-burgundy) focus-visible:outline-2 focus-visible:outline-(--mws-burgundy)"
                >
                  <ArrowRight size={16} />
                </button>
              </td>
            </tr>
          ))}
        </DenseTable>
      )}

      <PageHint id="application-access-source-of-truth">
        Open an application to manage it. Add its roles first, then a group: the group says who can use the app and
        with which role. Exceptions inside a group give some people another role. The most specific access wins, a
        blocked person stays blocked, and a group can only be removed after its exceptions.
      </PageHint>
    </div>
  );
}
