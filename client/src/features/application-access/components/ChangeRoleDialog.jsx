import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, SearchableSelect } from "../../../components/ui/FormControls.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { roleOptions } from "../utils/roleOptions.js";
import { PermissionPopover } from "./PermissionPopover.jsx";

// Another role for one exception. The server refuses the role its group already gives.
export function ChangeRoleDialog({ applicationId, exception, roles, onClose, onDone }) {
  const [roleKey, setRoleKey] = useState(exception.role);
  const options = roles.filter((role) => role.application_id === applicationId && role.is_active);
  const selectedRole = options.find((role) => role.key === roleKey);

  const mutation = useMutation({
    mutationFn: () => applicationAccessApi.updateEntitlement(exception.id, { role: roleKey }),
    onSuccess: () => {
      onDone();
      showSuccessToast("Role changed.");
      onClose();
    },
    onError: (error) => showErrorToast(error, "Could not change the role."),
  });

  return (
    <CrudDialog
      title="Change Role"
      description={`${exception.full_name} on ${applicationId}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={mutation.isPending}
            disabled={roleKey === exception.role}
            onClick={() => mutation.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Role">
        <SearchableSelect
          value={roleKey}
          onChange={setRoleKey}
          options={roleOptions(options)}
          placeholder="Select a role"
          searchPlaceholder="Search role"
        />
        {selectedRole ? <PermissionPopover permissions={selectedRole.permissions} /> : null}
      </Field>
    </CrudDialog>
  );
}
