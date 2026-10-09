import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HelpCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { TextAction } from "../../../components/ui/TextAction.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { TextInput } from "../../../components/ui/FormControls.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { RemovalGuideDialog } from "./RemovalGuideDialog.jsx";

const count = (value, word) => `${value} ${word}${value === 1 ? "" : "s"}`;

// Says first what stops the removal and what would go with it. The id is typed again to confirm.
export function RemoveApplicationDialog({ applicationId, onClose, onRemoved }) {
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(false);
  const [guide, setGuide] = useState(false);
  const query = useQuery({
    queryKey: ["application-access", "removal", applicationId],
    queryFn: () => applicationAccessApi.getRemoval(applicationId),
    gcTime: 0,
    enabled: !done,
  });
  const mutation = useMutation({
    mutationFn: () => applicationAccessApi.removeApplication(applicationId),
    onSuccess: () => {
      setDone(true);
      showSuccessToast("Application removed.");
      onRemoved();
      // After the page is left, drop what belonged to this application. Refetching it would
      // get a 404 and show a second toast.
      setTimeout(() => {
        for (const kind of ["setup", "removal", "app"]) {
          queryClient.removeQueries({
            queryKey: ["application-access", kind, applicationId],
          });
        }
        queryClient.invalidateQueries({
          queryKey: ["application-access", "applications"],
        });
        queryClient.invalidateQueries({
          queryKey: ["application-access", "organizations"],
        });
      }, 0);
    },
    onError: (error) =>
      showErrorToast(error, "Could not remove this application."),
  });

  const retireMutation = useMutation({
    mutationFn: () => applicationAccessApi.retireApplication(applicationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["application-access"] });
      showSuccessToast("Application retired.");
      onClose();
    },
    onError: (error) => showErrorToast(error, "Could not retire this application."),
  });

  const plan = query.data;
  const goes = plan
    ? [
        plan.will_delete.roles && count(plan.will_delete.roles, "role"),
        plan.will_delete.groups && count(plan.will_delete.groups, "group"),
        plan.will_delete.permissions &&
          count(plan.will_delete.permissions, "permission"),
        plan.will_delete.clients &&
          `${count(plan.will_delete.clients, "API connection")} (revoked)`,
        plan.will_delete.people &&
          `${plan.will_delete.people} ${plan.will_delete.people === 1 ? "person loses" : "people lose"} access`,
      ].filter(Boolean)
    : [];

  return (
    <CrudDialog
      title="Delete Application"
      description={applicationId}
      onClose={onClose}
      panelClassName="max-w-lg"
    >
      {plan ? (
        <TextAction className="-mt-1 mb-3" icon={HelpCircle} onClick={() => setGuide(true)}>
          How removing works
        </TextAction>
      ) : null}
      {query.isLoading ? (
        <p className="text-sm text-(--mws-muted)">Checking where it is used…</p>
      ) : query.isError ? (
        <p className="text-sm font-semibold text-[#a43c41]">
          This could not be checked. Try again.
        </p>
      ) : plan.can_remove ? (
        <div className="space-y-4">
          <p className="text-sm text-(--mws-charcoal)">
            {plan.retired ? "This application is retired." : "Nobody uses this application now."} These go with it:
          </p>
          {goes.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-(--mws-charcoal)">
              {goes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-(--mws-muted)">
              Only the application itself.
            </p>
          )}
          <div>
            <label
              htmlFor="confirm-application-id"
              className="mb-1.5 block text-sm font-semibold text-(--mws-charcoal)"
            >
              Type "<span className="text-(--mws-rose)">{applicationId}</span>" to confirm
            </label>
            <TextInput
              id="confirm-application-id"
              name={`confirm-delete-${applicationId}`}
              value={typed}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
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
          <p className="text-sm font-semibold text-(--mws-charcoal)">
            {plan.is_hub ? "This is the Hub itself, so it cannot be retired or deleted." : "This application is still in use, so it cannot be deleted yet."}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-(--mws-charcoal)">
            {plan.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
          {plan.retire_available ? (
            <div className="rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3">
              <p className="text-sm font-semibold text-(--mws-charcoal)">Retire it first</p>
              <p className="mt-1 text-xs leading-5 text-(--mws-muted)">
                Stops its token, hides it from the Hub and turns off access. Nothing is deleted. You can restore it or delete it
                afterwards.
              </p>
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>
              Close
            </Button>
            {plan.retire_available ? (
              <Button type="button" loading={retireMutation.isPending} onClick={() => retireMutation.mutate()}>
                Retire Application
              </Button>
            ) : null}
          </div>
        </div>
      )}
      {guide ? <RemovalGuideDialog onClose={() => setGuide(false)} /> : null}
    </CrudDialog>
  );
}
