// For a group of students: whether single students can get a role of their own.
export function AllowExceptionsField({ checked, onChange }) {
  return (
    <label className="flex items-start gap-3 text-sm text-(--mws-charcoal)">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 accent-(--mws-burgundy)"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <span className="block font-semibold">Allow Exceptions</span>
        <span className="block text-xs text-(--mws-muted)">
          Check this box if the students requires a specific role.
        </span>
      </span>
    </label>
  );
}
