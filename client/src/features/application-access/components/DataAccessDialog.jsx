import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { ScopePicker } from "./ScopePicker.jsx";

// Changes what the connection of an application may read. The token stays the same.
export function DataAccessDialog({ applicationId, current, onClose }) {
  const queryClient = useQueryClient();
  const [scopeNames, setScopeNames] = useState(current);
  const mutation = useMutation({
    mutationFn: () => applicationAccessApi.updateConnectionScopes(applicationId, scopeNames),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["application-access", "setup", applicationId] });
      showSuccessToast("Data access saved.");
      onClose();
    },
    onError: (error) => showErrorToast(error, "Could not save the data access."),
  });

  return (
    <CrudDialog title="Data Access" description={`What ${applicationId} may read from Central.`} onClose={onClose}>
      <div className="space-y-4">
        <ScopePicker value={scopeNames} onChange={setScopeNames} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Save
          </Button>
        </div>
      </div>
    </CrudDialog>
  );
}
