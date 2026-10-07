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

  const requiresOf = new Map(options.map((option) => [option.key, option.requires || []]));
  // Everything a permission needs, directly or through the ones it needs.
  function needed(key, seen = new Set()) {
    for (const next of requiresOf.get(key) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      needed(next, seen);
    }
    return seen;
  }
  // Checked permissions that need this one, so it has to stay.
  const neededBy = (key) => value.filter((item) => item !== key && needed(item).has(key));

  function toggle(permission) {
    if (value.includes(permission)) {
      if (neededBy(permission).length === 0) onChange(value.filter((item) => item !== permission));
      return;
    }
    onChange([...new Set([...value, permission, ...needed(permission)])]);
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
          label="All Permissions"
          onChange={(event) =>
            onChange(
              event.target.checked
                ? [...new Set([...value, ...keys])]
                : value.filter((item) => !keys.includes(item)),
            )
          }
        />
        {options.map((option) => {
          const holders = value.includes(option.key) ? neededBy(option.key) : [];
          return (
            <CheckboxField
              key={option.key}
              checked={value.includes(option.key)}
              disabled={holders.length > 0}
              label={option.key}
              description={
                holders.length > 0
                  ? `Needed by ${holders.join(", ")}`
                  : option.deprecated
                    ? "Dropped by the application. Replace it with a current one."
                    : option.description || undefined
              }
              onChange={() => toggle(option.key)}
            />
          );
        })}
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
            aria-label="Add Permission"
            title="Add Permission"
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
