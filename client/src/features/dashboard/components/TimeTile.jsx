export function TimeTile({ icon: Icon, label, value }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-4">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-[var(--mws-burgundy)]">
        <Icon size={17} />
      </div>
      <p className="text-xs font-semibold text-[var(--mws-muted)]">{label}</p>
      <p className="mt-1 truncate font-display text-lg font-bold text-[var(--mws-charcoal)]">
        {value}
      </p>
    </div>
  );
}