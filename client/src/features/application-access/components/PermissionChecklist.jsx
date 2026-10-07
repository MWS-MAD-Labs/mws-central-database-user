import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CheckboxField, TextInput } from "../../../components/ui/FormControls.jsx";

// options: [{ key, description, deprecated }]. canRegister is false for an application that
// publishes its own permissions, then new ones come from its code, not from here.
export function PermissionChecklist({ options, value, onChange, canRegister, onRegister, registering }) {
  const [draft, setDraft] = useState("");
  const keys = options.filter((option) => !option.deprecated).map((option) => option.key);
  const all = keys.length > 0 && keys.every((key) => value.includes(key));

  function toggle(permission) {
    onChange(
      value.includes(permission)
        ? value.filter((item) => item !== permission)
        : [...value, permission],
    );
  }

  async function addDraft() {
    const permission = draft.trim();
    if (!permission) return;
    if (await onRegister(permission)) setDraft("");
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <CheckboxField
          checked={all}
          disabled={keys.length === 0}
          label="All permissions"
          onChange={(event) =>
            onChange(
              event.target.checked
                ? [...new Set([...value, ...keys])]
                : value.filter((item) => !keys.includes(item)),
            )
          }
        />
        {options.map((option) => (
          <CheckboxField
            key={option.key}
            checked={value.includes(option.key)}
            label={option.key}
            description={option.deprecated ? "Dropped by the application. Replace it with a current one." : option.description || undefined}
            onChange={() => toggle(option.key)}
          />
        ))}
      </div>
      {canRegister ? (
        <div className="flex gap-2">
          <TextInput
            value={draft}
            placeholder="Add a new permission, for example reports.read"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addDraft();
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            aria-label="Add permission"
            title="Add permission"
            className="h-11 w-11 shrink-0 px-0"
            loading={registering}
            onClick={addDraft}
          >
            <Plus size={18} />
          </Button>
        </div>
      ) : (
        <p className="text-xs text-(--mws-muted)">
          This application publishes its own permissions. A new one is added in its code and shows here after it is deployed.
        </p>
      )}
    </div>
  );
}
