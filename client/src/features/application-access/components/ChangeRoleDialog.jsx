import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, SearchableSelect } from "../../../components/ui/FormControls.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { loadEmployeeFormOptions } from "../../employees/api/employeeFormOptions.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { roleOptions } from "../utils/roleOptions.js";
import { PermissionPopover } from "./PermissionPopover.jsx";
import { ScopeUnitsField } from "./ScopeUnitsField.jsx";

const sameIds = (left, right) => left.length === right.length && left.every((id) => right.includes(id));

// Another role, or other units, for one exception. The server refuses the role its group already gives.
export function ChangeRoleDialog({ applicationId, exception, roles, onClose, onDone }) {
  const [roleKey, setRoleKey] = useState(exception.role);
  const initialUnitIds = (exception.scope_units || []).map((unit) => unit.id);
  const [unitIds, setUnitIds] = useState(initialUnitIds);
  const hasUnits = exception.kind !== "STUDENT";
  const units = useQuery({ queryKey: ["employee-form-options"], queryFn: loadEmployeeFormOptions, enabled: hasUnits }).data?.units;
  const options = roles.filter(
    (role) =>
      role.application_id === applicationId &&
      role.is_active &&
      (exception.kind === "STUDENT" ? role.allows_students : exception.kind === "INTERN" ? role.allows_interns : role.allows_employees !== false),
  );
  const selectedRole = options.find((role) => role.key === roleKey);
  const unitsChanged = hasUnits && !sameIds(unitIds, initialUnitIds);

  const mutation = useMutation({
    mutationFn: () =>
      applicationAccessApi.updateEntitlement(exception.id, {
        ...(roleKey !== exception.role ? { role: roleKey } : {}),
        ...(unitsChanged ? { scope_unit_ids: unitIds } : {}),
      }),
    onSuccess: () => {
      onDone();
      showSuccessToast("Access changed.");
      onClose();
    },
    onError: (error) => showErrorToast(error, "Could not change this access."),
  });

  return (
    <CrudDialog
      title={hasUnits ? "Change Role or Units" : "Change Role"}
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
            disabled={roleKey === exception.role && !unitsChanged}
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
        {selectedRole ? <PermissionPopover permissions={selectedRole.permissions} applicationId={applicationId} /> : null}
      </Field>
      {hasUnits ? <ScopeUnitsField units={units} value={unitIds} onChange={setUnitIds} /> : null}
    </CrudDialog>
  );
}
