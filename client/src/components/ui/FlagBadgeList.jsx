import { cn } from '../../lib/cn.js'

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
          className="ml-1.5 align-middle text-[10px] font-semibold text-(--mws-muted)"
          title={hidden.map((flag) => flag.title).join(' ')}
        >
          +{hidden.length}
        </span>
      ) : null}
    </>
  )
}
