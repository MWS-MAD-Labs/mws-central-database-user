
export function ContactRow({ icon: Icon, value }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--mws-line)] px-3 py-2">
      <Icon size={16} className="text-[var(--mws-burgundy)]" />
      <span className="min-w-0 truncate text-[var(--mws-charcoal)]">{value}</span>
    </div>
  )
}