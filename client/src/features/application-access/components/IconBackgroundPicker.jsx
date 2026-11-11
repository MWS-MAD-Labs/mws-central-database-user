import { cn } from "../../../lib/cn.js";
import { ICON_BG_PRESETS, isHexColor } from "../utils/iconBackground.js";

const chip =
  "inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors";
const chipOn = "border-(--mws-burgundy) bg-(--mws-soft) text-(--mws-burgundy)";
const chipOff = "border-(--mws-line) bg-white text-(--mws-muted) hover:bg-(--mws-soft)";

export function IconBackgroundPicker({ value, onChange }) {
  const current = isHexColor(value) ? value.toUpperCase() : "";
  const isPreset = ICON_BG_PRESETS.some((preset) => preset.value === current);
  const customOn = Boolean(current) && !isPreset;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onChange("")}
        aria-pressed={!current}
        className={cn(chip, "cursor-pointer", !current ? chipOn : chipOff)}
      >
        <span className="size-4 rounded-full border border-(--mws-line) bg-white" aria-hidden="true" />
        Default
      </button>
      {ICON_BG_PRESETS.map((preset) => (
        <button
          key={preset.value}
          type="button"
          title={preset.label}
          aria-label={preset.label}
          aria-pressed={current === preset.value}
          onClick={() => onChange(preset.value)}
          style={{ backgroundColor: preset.value }}
          className={cn(
            "size-8 cursor-pointer rounded-lg border transition-shadow",
            current === preset.value ? "border-(--mws-burgundy) ring-2 ring-(--mws-burgundy)/30" : "border-(--mws-line)",
          )}
        />
      ))}
      <label className={cn(chip, "relative cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-(--mws-burgundy)", customOn ? chipOn : chipOff)}>
        <span
          className="size-4 rounded-full border border-(--mws-line)"
          style={{
            background: customOn
              ? current
              : "conic-gradient(#e5484d, #f5a623, #f2e03d, #46b97a, #3b82f6, #8b5cf6, #e5484d)",
          }}
          aria-hidden="true"
        />
        Custom
        <input
          type="color"
          aria-label="Custom background colour"
          value={current || "#FFFFFF"}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}
