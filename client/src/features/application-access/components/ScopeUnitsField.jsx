import { Field, ToggleChip } from "../../../components/ui/FormControls.jsx";
import { isRealUnit } from "../utils/legacyUnit.js";

// Units a person's role reaches in the app (AS-8). None picked means their own unit.
export function ScopeUnitsField({ units, value, onChange, disabled = false }) {
  const choices = (units || []).filter(isRealUnit);

  function toggle(id, checked) {
    onChange(checked ? [...value, id] : value.filter((item) => item !== id));
  }

  return (
    <Field
      label="Units Managed"
      hint={value.length === 0 ? "None picked: only their own unit." : `${value.length} unit(s) picked.`}
    >
      <div className="mws-scrollbar flex max-h-40 flex-wrap gap-2 overflow-y-auto" role="group" aria-label="Units Managed">
        {choices.map((unit) => (
          <ToggleChip
            key={unit.id}
            disabled={disabled}
            checked={value.includes(unit.id)}
            onChange={(checked) => toggle(unit.id, checked)}
          >
            {unit.name}
          </ToggleChip>
        ))}
      </div>
    </Field>
  );
}
