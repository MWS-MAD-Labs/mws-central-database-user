import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, TextInput } from "../../../components/ui/FormControls.jsx";
import { textLength } from "../../../lib/form.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { googleAccountApi } from "../api/googleAccountApi.js";

const MIN_REASON = 3;
const MAX_REASON = 500;

// Central stops managing the Google account of a person. Nothing changes in Google, so the email can then be changed to
// one another Google account holds, and that account linked. One place for the panel and the edit forms.
export function UnlinkGoogleDialog({ resource, id, email, onClose, onUnlinked }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const unlink = useMutation({
    mutationFn: () => googleAccountApi.unlink(resource, id, reason.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-account", resource, id] });
      showSuccessToast("Google account unlinked.");
      onUnlinked?.();
      onClose();
    },
    onError: (error) => showErrorToast(error, "Google account was not unlinked."),
  });

  return (
    <CrudDialog
      title="Unlink Google Account"
      description="Central stops managing this Google account. Nothing changes in Google. Afterwards the email can be changed to one that another Google account holds, and that account linked."
      panelClassName="max-w-lg"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" loading={unlink.isPending} disabled={reason.trim().length < MIN_REASON} onClick={() => unlink.mutate()}>
            Unlink
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {email ? <p className="text-sm text-(--mws-muted)">{email}</p> : null}
        <Field label="Reason" required counter={{ value: reason, max: MAX_REASON, count: textLength }}>
          <TextInput maxLength={MAX_REASON} value={reason} placeholder="Why is it unlinked" onChange={(event) => setReason(event.target.value)} />
        </Field>
      </div>
    </CrudDialog>
  );
}
