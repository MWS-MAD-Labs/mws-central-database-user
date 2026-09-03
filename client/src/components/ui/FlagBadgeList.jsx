import { cn } from '../../lib/cn.js'

// Shared by EmployeesTable.jsx/StudentsTable.jsx's Name column - a row can
// carry several independent flags at once (disciplinary, date anomaly,
// auto-filled, grade override, ...), and `badges` is already an array for
// exactly that reason. Rendering all of them inline eventually crowds out
// the name itself (the column truncates the whole line as one flow, name
// included) - past `maxVisible`, the rest collapse into one "+N" badge
// whose tooltip still names every one of them, so nothing is ever lost,
// just deferred to a hover.
export function FlagBadgeList({ badges, maxVisible = 2 }) {
  if (!badges || badges.length === 0) return null

  const visible = badges.slice(0, maxVisible)
  const hidden = badges.slice(maxVisible)

  return (
    <>
      {visible.map((flag) => (
        <span
          key={flag.key}
          className={cn('ml-1.5 align-middle text-[10px] font-semibold', flag.textClass)}
          title={flag.title}
        >
          {flag.label}
        </span>
      ))}
      {hidden.length > 0 ? (
        <span
          className="ml-1.5 align-middle text-[10px] font-semibold text-[var(--mws-muted)]"
          title={hidden.map((flag) => flag.title).join(' ')}
        >
          +{hidden.length}
        </span>
      ) : null}
    </>
  )
}
