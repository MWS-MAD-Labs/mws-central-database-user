import { cn } from "../../../lib/cn.js";
import { ICON_BG_PRESETS, isHexColor } from "../utils/iconBackground.js";

export function IconBackgroundPicker({ value, onChange }) {
  const current = isHexColor(value) ? value.toUpperCase() : "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onChange("")}
        aria-pressed={!current}
        className={cn(
          "h-8 rounded-lg border px-3 text-xs font-semibold transition-colors",
          !current ? "border-(--mws-burgundy) text-(--mws-burgundy)" : "border-(--mws-line) text-(--mws-muted) hover:bg-(--mws-soft)",
        )}
      >
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
            "size-8 rounded-lg border transition-shadow",
            current === preset.value ? "border-(--mws-burgundy) ring-2 ring-(--mws-burgundy)/30" : "border-(--mws-line)",
          )}
        />
      ))}
      <label className="flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-(--mws-line) px-2 text-xs text-(--mws-muted)">
        Custom
        <input
          type="color"
          aria-label="Custom background colour"
          value={current || "#FFFFFF"}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="size-5 cursor-pointer border-0 bg-transparent p-0"
        />
      </label>
    </div>
  );
}
