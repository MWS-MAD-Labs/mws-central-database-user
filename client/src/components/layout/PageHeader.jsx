export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex min-w-0 flex-col gap-4 border-b border-[var(--mws-line)] pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="break-words font-display text-2xl font-bold text-[var(--mws-burgundy)] md:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mws-muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  )
}
