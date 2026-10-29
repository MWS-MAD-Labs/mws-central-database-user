import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, TextInput } from "../../../components/ui/FormControls.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { normalizeRoleKey } from "../utils/roleKey.js";

// The key is stored on every person and group that holds the role, so they all move to the new key together.
export function ChangeRoleKeyDialog({ role, roles, onClose }) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [attempted, setAttempted] = useState(false);
  const people = role.active_entitlement_count || 0;
  const groups = role.active_group_count || 0;

  const taken = roles.some(
    (item) => item.application_id === role.application_id && item.id !== role.id && item.key === key,
  );
  const problem = !key
    ? "The new key is required."
    : key === role.key
      ? "This is already the key of the role."
      : taken
        ? `${key} is already a role of this application.`
        : null;

  const mutation = useMutation({
    mutationFn: () => applicationAccessApi.changeRoleKey(role.id, key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["application-access"] });
      showSuccessToast(`Key changed to ${key}.`);
      onClose();
    },
    onError: (error) => showErrorToast(error, "Could not change the key."),
  });

  function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (problem) return;
    mutation.mutate();
  }

  return (
    <CrudDialog
      title={`Change Key of ${role.key}`}
      description="Every person and group that holds this role moves to the new key."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="change-role-key-form" loading={mutation.isPending}>
            Change Key
          </Button>
        </>
      }
    >
      <form id="change-role-key-form" onSubmit={submit} noValidate className="space-y-4">
        <Field
          label="New Key"
          hint="Capital letters, digits and underscores, for example USER or SUPPORT_STAFF."
          error={attempted ? (problem ?? undefined) : undefined}
        >
          <TextInput value={key} maxLength={64} onChange={(event) => setKey(normalizeRoleKey(event.target.value))} />
        </Field>
        <p className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-3 py-2 text-xs text-[#805b18]">
          {people} active {people === 1 ? "person" : "people"} and {groups} active {groups === 1 ? "group" : "groups"} follow
          the new key. Apps that keep the
          role as text read the new key on their next lookup, within about a minute. Access is decided by permissions,
          so nobody gains or loses anything.
        </p>
      </form>
    </CrudDialog>
  );
}
