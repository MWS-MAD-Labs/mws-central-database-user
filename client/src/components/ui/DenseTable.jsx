// Shared shell for the compact list tables (PC room, class page): rounded
// frame, soft header, one-line rows, hover, and a dimmed body while the next
// page loads so the height never collapses.
export const denseCellClass = 'px-4 py-2.5'
export const denseRowClass =
  'border-t border-(--mws-line) bg-white hover:bg-(--mws-soft)'

export function DenseTable({
  head,
  children,
  footer,
  dimmed = false,
  minWidth = 900,
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-(--mws-line)">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" style={{ minWidth }}>
          <thead className="bg-(--mws-soft) text-xs font-bold text-(--mws-muted)">
            <tr>{head}</tr>
          </thead>
          <tbody className={dimmed ? 'opacity-60 transition-opacity' : undefined}>
            {children}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  )
}
