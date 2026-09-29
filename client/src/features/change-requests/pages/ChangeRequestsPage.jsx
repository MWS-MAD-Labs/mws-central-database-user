import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Undo2, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, TextAreaInput } from "../../../components/ui/FormControls.jsx";
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
  return request.entity_type === "Employee"
    ? `/employees/${request.entity_id}`
    : `/students/${request.entity_id}`;
}

export function ChangeRequestsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState("PENDING");
  const [decisionDialog, setDecisionDialog] = useState(null);

  const query = useQuery({
    queryKey: ["change-requests", { tab: activeTab }],
    queryFn: () =>
      changeRequestsApi.list(activeTab === "PENDING" ? { status: "PENDING" } : {}),
  });
  const canApprove = Boolean(query.data?.can_approve);
  const requests = (query.data?.data || []).filter((request) =>
    activeTab === "PENDING" ? true : request.status !== "PENDING",
  );

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
            : "Your requests to change locked identifier fields. A protected Super Admin reviews each one."
        }
      />

      <div className="mb-4 flex gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
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
        <div className="space-y-3">
          {requests.map((request) => (
            <article
              key={request.id}
              className="rounded-2xl border border-(--mws-line) bg-white p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={statusTones[request.status]}>
                      {formatStatus(request.status)}
                    </StatusBadge>
                    <span className="text-xs text-(--mws-muted)">
                      {request.entity_type}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-(--mws-charcoal)">
                    <Link
                      to={entityHref(request)}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-(--mws-burgundy) hover:underline"
                    >
                      {request.entity_name || request.entity_id}
                    </Link>
                    {" · "}
                    {request.field_label}
                  </p>
                  {request.values_masked ? (
                    <p className="text-sm text-(--mws-muted)">
                      Values hidden. You don't have employee PII access.
                    </p>
                  ) : (
                    <p className="break-all text-sm text-(--mws-charcoal)">
                      <span className="text-(--mws-muted) line-through">
                        {request.old_value || "(empty)"}
                      </span>{" "}
                      to <span className="font-semibold">{request.new_value}</span>
                    </p>
                  )}
                  <p className="text-sm text-(--mws-muted)">Reason: {request.reason}</p>
                  <p className="text-xs text-(--mws-muted)">
                    Requested by {request.requested_by.full_name} on{" "}
                    {formatDateTime(request.requested_at)}
                  </p>
                  {request.decided_by ? (
                    <p className="text-xs text-(--mws-muted)">
                      {formatStatus(request.status)} by {request.decided_by.full_name} on{" "}
                      {formatDateTime(request.decided_at)}
                      {request.decision_note ? `. Note: ${request.decision_note}` : ""}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
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
              </div>
            </article>
          ))}
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
        <Field label={isReject ? "Reason for rejecting" : "Note (optional)"} error={noteError}>
          <TextAreaInput
            invalid={Boolean(noteError)}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </form>
    </CrudDialog>
  );
}
