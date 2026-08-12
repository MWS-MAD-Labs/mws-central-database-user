

export function SectionTitle({ icon: Icon, title, caption }) {
  return (
    <div className="mb-4 flex min-w-0 items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#edf4eb] text-[#476b43]">
        <Icon size={19} />
      </div>
      <div className="min-w-0">
        <h2 className="font-display text-base font-bold text-[var(--mws-charcoal)]">
          {title}
        </h2>
        <p className="text-sm leading-6 text-[var(--mws-muted)]">{caption}</p>
      </div>
    </div>
  );
}