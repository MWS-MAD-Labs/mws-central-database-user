import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { DenseTable, denseCellClass, denseRowClass } from "../../../components/ui/DenseTable.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { formatDateTime, formatStatus } from "../../../lib/format.js";
import { showSuccessToast } from "../../../lib/toast.js";
import { changeRequestsApi } from "../api/changeRequestsApi.js";

const statusTones = {
  PENDING: "amber",
  APPROVED: "green",
  REJECTED: "red",
  CANCELLED: "neutral",
};

function entityHref(request) {
  if (request.entity_type === "DisciplinaryAction") {
    return `/employees/${request.entity_parent_id}`;
  }
  return request.entity_type === "Employee"
    ? `/employees/${request.entity_id}`
    : `/students/${request.entity_id}`;
}

function entityLabel(request) {
  return request.entity_type === "DisciplinaryAction" ? "Disciplinary letter" : request.entity_type;
}

// Attachment rows only carry the file name, in old_value.
function RequestValues({ request }) {
  if (request.field_name?.startsWith("attachment_")) {
    return <span className="font-semibold text-(--mws-charcoal)">{request.old_value}</span>;
  }
  return (
    <>
      <span className="text-(--mws-muted) line-through">{request.old_value || "(empty)"}</span>{" "}
      <span className="font-semibold text-(--mws-charcoal)">{request.new_value}</span>
    </>
  );
}

// The requester's own requests and what became of them.
export function MyChangeRequestsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);

  const query = useQuery({
    queryKey: ["change-requests", "mine", { page, size }],
    queryFn: () => changeRequestsApi.listMine({ page, size }),
    placeholderData: (previous) => previous,
  });
  const requests = query.data?.data || [];
  const paging = query.data?.paging;

  // Opening the list counts as reading the decisions, so the badge clears.
  const hasMarkedSeenRef = useRef(false);
  useEffect(() => {
    if (!query.data || hasMarkedSeenRef.current) return;
    hasMarkedSeenRef.current = true;
    if (query.data.unseen_decided_count > 0) {
      changeRequestsApi
        .markMineSeen()
        .then(() => queryClient.invalidateQueries({ queryKey: ["change-requests", "mine", { count: true }] }))
        .catch(() => {});
    }
  }, [query.data, queryClient]);

  const cancelMutation = useMutation({
    mutationFn: (id) => changeRequestsApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["change-requests"] });
      showSuccessToast("Request cancelled.");
    },
  });

  return (
    <div className="min-w-0">
      <PageHeader
        title="My Requests"
        description="Your requests to change locked identifier fields, and what the approver decided."
      />

      {query.isLoading ? (
        <PanelMessage>Loading your requests…</PanelMessage>
      ) : requests.length === 0 ? (
        <PanelMessage>You haven't requested any changes yet.</PanelMessage>
      ) : (
        <DenseTable
          dimmed={query.isPlaceholderData}
          minWidth={900}
          head={
            <>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Subject</th>
              <th className="px-4 py-2.5">Change</th>
              <th className="px-4 py-2.5">Reason</th>
              <th className="px-4 py-2.5">Decision</th>
              <th className="px-4 py-2.5">Requested</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </>
          }
          footer={
            paging && paging.total_item > 0 ? (
              <PaginationBar
                paging={paging}
                itemLabel="requests"
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
          {requests.map((request) => (
            <tr key={request.id} className={denseRowClass}>
              <td className={denseCellClass}>
                <StatusBadge tone={statusTones[request.status]}>
                  {formatStatus(request.status)}
                </StatusBadge>
              </td>
              <td className={`${denseCellClass} max-w-48`}>
                <Link
                  to={entityHref(request)}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-semibold text-(--mws-charcoal) hover:text-(--mws-burgundy) hover:underline"
                  title={request.entity_name || request.entity_id}
                >
                  {request.entity_name || request.entity_id}
                </Link>
                <span className="text-xs text-(--mws-muted)">
                  {entityLabel(request)} · {request.field_label}
                </span>
              </td>
              <td className={`${denseCellClass} max-w-56`}>
                {request.values_masked ? (
                  <span className="text-xs text-(--mws-muted)">Hidden</span>
                ) : (
                  <span
                    className="block truncate"
                    title={`${request.old_value || "(empty)"} to ${request.new_value}`}
                  >
                    <RequestValues request={request} />
                  </span>
                )}
              </td>
              <td className={`${denseCellClass} max-w-56`}>
                <span className="block truncate text-(--mws-muted)" title={request.reason}>
                  {request.reason}
                </span>
              </td>
              <td className={`${denseCellClass} max-w-56 text-xs text-(--mws-muted)`}>
                {request.decided_by ? (
                  <>
                    <span className="block text-sm text-(--mws-charcoal)">{request.decided_by.full_name}</span>
                    <span className="block truncate" title={request.decision_note || undefined}>
                      {request.decision_note || formatDateTime(request.decided_at)}
                    </span>
                  </>
                ) : request.status === "PENDING" ? (
                  "Waiting for an approver"
                ) : (
                  formatDateTime(request.decided_at)
                )}
              </td>
              <td className={`${denseCellClass} whitespace-nowrap text-xs text-(--mws-muted)`}>
                {formatDateTime(request.requested_at)}
              </td>
              <td className={`${denseCellClass} text-right`}>
                {request.can_cancel ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={cancelMutation.isPending}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: "Cancel request",
                          description: `Cancel your ${request.field_label} change request?`,
                          confirmLabel: "Cancel request",
                          tone: "danger",
                        })
                      ) {
                        cancelMutation.mutate(request.id);
                      }
                    }}
                  >
                    <Undo2 size={15} />
                    Cancel
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </DenseTable>
      )}
    </div>
  );
}
