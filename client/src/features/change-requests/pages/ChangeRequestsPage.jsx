import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Undo2, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { LimitedField } from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { cn } from "../../../lib/cn.js";
import { formatDateTime, formatStatus } from "../../../lib/format.js";
import { showSuccessToast } from "../../../lib/toast.js";
import { changeRequestsApi } from "../api/changeRequestsApi.js";

const tabs = [
  { id: "PENDING", label: "Pending" },
  { id: "DECIDED", label: "History" },
];

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

export function ChangeRequestsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState("PENDING");
  const [decisionDialog, setDecisionDialog] = useState(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);

  const query = useQuery({
    queryKey: ["change-requests", { tab: activeTab, page, size }],
    queryFn: () =>
      changeRequestsApi.list({
        ...(activeTab === "PENDING" ? { status: "PENDING" } : { history: true }),
        page,
        size,
      }),
    placeholderData: (previous) => previous,
  });
  const canApprove = Boolean(query.data?.can_approve);
  const requests = query.data?.data || [];
  const paging = query.data?.paging;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["change-requests"] });
    queryClient.invalidateQueries({ queryKey: ["employees"] });
    queryClient.invalidateQueries({ queryKey: ["students"] });
  }

  const decideMutation = useMutation({
    mutationFn: ({ mode, id, note }) =>
      mode === "approve"
        ? changeRequestsApi.approve(id, note)
        : changeRequestsApi.reject(id, note),
    onSuccess: (_, { mode }) => {
      invalidate();
      setDecisionDialog(null);
      showSuccessToast(
        mode === "approve" ? "Request approved and applied." : "Request rejected.",
      );
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id) => changeRequestsApi.cancel(id),
    onSuccess: () => {
      invalidate();
      showSuccessToast("Request cancelled.");
    },
  });

  return (
    <div className="min-w-0">
      <PageHeader
        title="Change Requests"
        description={
          canApprove
            ? "Requests to change locked identifier fields. Approving applies the new value right away."
            : "Your requests to change locked identifier fields. An approver reviews each one."
        }
      />

      <div className="mb-4 flex gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id);
              setPage(1);
            }}
            className={cn(
              "rounded-full px-4 py-2 font-display text-sm font-semibold transition-colors",
              activeTab === tab.id
                ? "bg-(--mws-burgundy) text-white"
                : "bg-white text-(--mws-muted) hover:bg-(--mws-soft)",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <PanelMessage>Loading change requests…</PanelMessage>
      ) : requests.length === 0 ? (
        <PanelMessage>
          {activeTab === "PENDING" ? "No pending requests." : "No decided requests yet."}
        </PanelMessage>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-(--mws-line) bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
                <tr>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Subject</th>
                  <th className="px-3 py-2.5">Change</th>
                  <th className="px-3 py-2.5">Reason</th>
                  <th className="px-3 py-2.5">Requested</th>
                  {activeTab === "DECIDED" ? <th className="px-3 py-2.5">Decision</th> : null}
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className={query.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
                {requests.map((request) => (
                  <tr key={request.id} className="border-t border-(--mws-line) align-middle hover:bg-(--mws-soft)">
                    <td className="px-3 py-2">
                      <StatusBadge tone={statusTones[request.status]}>
                        {formatStatus(request.status)}
                      </StatusBadge>
                    </td>
                    <td className="max-w-48 px-3 py-2">
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
                    <td className="max-w-56 px-3 py-2">
                      {request.values_masked ? (
                        <span className="text-xs text-(--mws-muted)">Hidden, no PII access</span>
                      ) : (
                        <span
                          className="block truncate"
                          title={`${request.old_value || "(empty)"} to ${request.new_value}`}
                        >
                          <RequestValues request={request} />
                        </span>
                      )}
                    </td>
                    <td className="max-w-56 px-3 py-2">
                      <span className="block truncate text-(--mws-muted)" title={request.reason}>
                        {request.reason}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-(--mws-muted)">
                      <span className="block text-sm text-(--mws-charcoal)">{request.requested_by.full_name}</span>
                      {formatDateTime(request.requested_at)}
                    </td>
                    {activeTab === "DECIDED" ? (
                      <td className="max-w-56 px-3 py-2 text-xs text-(--mws-muted)">
                        {request.decided_by ? (
                          <>
                            <span className="block text-sm text-(--mws-charcoal)">{request.decided_by.full_name}</span>
                            <span className="block truncate" title={request.decision_note || undefined}>
                              {request.decision_note || formatDateTime(request.decided_at)}
                            </span>
                          </>
                        ) : (
                          formatDateTime(request.decided_at)
                        )}
                      </td>
                    ) : null}
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1.5">
                        {request.can_decide ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => setDecisionDialog({ mode: "approve", request })}
                            >
                              <Check size={15} />
                              Approve
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => setDecisionDialog({ mode: "reject", request })}
                            >
                              <X size={15} />
                              Reject
                            </Button>
                          </>
                        ) : null}
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {paging && paging.total_item > 0 ? (
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
          ) : null}
        </div>
      )}

      {decisionDialog ? (
        <DecisionDialog
          mode={decisionDialog.mode}
          request={decisionDialog.request}
          isSubmitting={decideMutation.isPending}
          onClose={() => setDecisionDialog(null)}
          onSubmit={(note) =>
            decideMutation.mutate({
              mode: decisionDialog.mode,
              id: decisionDialog.request.id,
              note,
            })
          }
        />
      ) : null}
    </div>
  );
}

function DecisionDialog({ mode, request, isSubmitting, onClose, onSubmit }) {
  const [note, setNote] = useState("");
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const isReject = mode === "reject";
  const noteError =
    hasAttemptedSubmit && isReject && !note.trim() ? "A note is required when rejecting." : undefined;

  function submit(event) {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    if (isReject && !note.trim()) return;
    onSubmit(note.trim() || undefined);
  }

  return (
    <CrudDialog
      title={isReject ? "Reject Request" : "Approve Request"}
      description={
        isReject
          ? `${request.field_label} for ${request.entity_name} stays unchanged.`
          : request.entity_type === "DisciplinaryAction"
            ? `${request.field_label} for ${request.entity_name} will be applied right away.`
            : `${request.field_label} for ${request.entity_name} will be changed right away. The field stays locked afterwards.`
      }
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="decide-change-request-form"
            type="submit"
            disabled={isSubmitting}
            loading={isSubmitting}
          >
            {isReject ? <X size={16} /> : <Check size={16} />}
            {isReject ? "Reject" : "Approve"}
          </Button>
        </>
      }
    >
      <form id="decide-change-request-form" onSubmit={submit} noValidate className="grid gap-4">
        <LimitedField
          label={isReject ? "Reason for rejecting" : "Note (optional)"}
          field="note"
          as="textarea"
          max={100}
          rows={3}
          values={{ note }}
          errors={{ note: noteError }}
          updateValue={(_, value) => setNote(value)}
        />
      </form>
    </CrudDialog>
  );
}
