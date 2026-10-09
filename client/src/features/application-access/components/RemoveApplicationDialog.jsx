import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { TextInput } from "../../../components/ui/FormControls.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";

const count = (value, word) => `${value} ${word}${value === 1 ? "" : "s"}`;

// Says first what stops the removal and what would go with it. The id is typed again to confirm.
export function RemoveApplicationDialog({ applicationId, onClose, onRemoved }) {
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");
  const query = useQuery({
    queryKey: ["application-access", "removal", applicationId],
    queryFn: () => applicationAccessApi.getRemoval(applicationId),
    gcTime: 0,
  });
  const mutation = useMutation({
    mutationFn: () => applicationAccessApi.removeApplication(applicationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["application-access"] });
      showSuccessToast("Application removed.");
      onRemoved();
    },
    onError: (error) => showErrorToast(error, "Could not remove this application."),
  });

  const plan = query.data;
  const goes = plan
    ? [
        plan.will_delete.roles && count(plan.will_delete.roles, "role"),
        plan.will_delete.groups && count(plan.will_delete.groups, "group"),
        plan.will_delete.permissions && count(plan.will_delete.permissions, "permission"),
        plan.will_delete.clients && `${count(plan.will_delete.clients, "API connection")} (revoked)`,
      ].filter(Boolean)
    : [];

  return (
    <CrudDialog title="Delete Application" description={applicationId} onClose={onClose} panelClassName="max-w-lg">
      {query.isLoading ? (
        <p className="text-sm text-(--mws-muted)">Checking where it is used…</p>
      ) : query.isError ? (
        <p className="text-sm font-semibold text-[#a43c41]">This could not be checked. Try again.</p>
      ) : plan.can_remove ? (
        <div className="space-y-4">
          <p className="text-sm text-(--mws-charcoal)">Nobody uses this application now. These go with it:</p>
          {goes.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-(--mws-charcoal)">
              {goes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-(--mws-muted)">Only the application itself.</p>
          )}
          <div>
            <label htmlFor="confirm-application-id" className="mb-1.5 block text-sm font-semibold text-(--mws-charcoal)">
              Type {applicationId} to confirm
            </label>
            <TextInput id="confirm-application-id" value={typed} onChange={(event) => setTyped(event.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={mutation.isPending}
              disabled={typed.trim() !== applicationId}
              onClick={() => mutation.mutate()}
            >
              Delete Application
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-semibold text-(--mws-charcoal)">This application is still in use, so it cannot be deleted.</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-(--mws-charcoal)">
            {plan.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </CrudDialog>
  );
}
