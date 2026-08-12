

export function FilterSelect({ label, value, onChange, children }) {
  return (
    <label className="min-w-0 space-y-1.5 xl:min-w-36">
      <span className="block font-display text-xs font-bold text-[var(--mws-muted)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-[var(--mws-line)] bg-white px-3 text-sm text-[var(--mws-charcoal)] outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A]"
      >
        {children}
      </select>
    </label>
  )
}