import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CheckboxField, TextInput } from "../../../components/ui/FormControls.jsx";

export function PermissionChecklist({ catalog, value, onChange }) {
  const [draft, setDraft] = useState("");
  const all = catalog.length > 0 && catalog.every((permission) => value.includes(permission));

  function toggle(permission) {
    onChange(
      value.includes(permission)
        ? value.filter((item) => item !== permission)
        : [...value, permission],
    );
  }

  function addDraft() {
    const permission = draft.trim();
    if (!permission) return;
    if (!value.includes(permission)) onChange([...value, permission]);
    setDraft("");
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <CheckboxField
          checked={all}
          disabled={catalog.length === 0}
          label="All permissions"
          onChange={(event) => onChange(event.target.checked ? [...catalog] : [])}
        />
        {catalog.map((permission) => (
          <CheckboxField
            key={permission}
            checked={value.includes(permission)}
            label={permission}
            onChange={() => toggle(permission)}
          />
        ))}
      </div>
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
          onClick={addDraft}
        >
          <Plus size={18} />
        </Button>
      </div>
    </div>
  );
}
