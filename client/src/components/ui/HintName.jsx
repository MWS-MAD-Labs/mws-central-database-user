import { groupHints, worstTone } from '../../lib/format.js'
import { ListPopover } from './ListPopover.jsx'

// The name colour says how serious the worst hint is. How many there are shows in the list that opens, so the colour
// never has to be learned: red is wrong, amber is worth a look, blue is for information, and plain is only a note.
const NAME_TONE = {
  danger: 'text-[#a43c41]',
  warn: 'text-[#8a6419]',
  info: 'text-[#1d4ed8]',
  muted: 'text-(--mws-charcoal)',
}

// A name in a list. With hints it becomes a button that opens them, grouped by what they are about; without, it is
// only the name.
export function HintName({ name, badges }) {
  if (!badges || badges.length === 0) {
    return <p className="truncate font-display font-bold text-(--mws-charcoal)">{name}</p>
  }

  const tone = worstTone(badges)
  const groups = groupHints(badges).map(({ category, hints }) => ({
    title: category,
    hideCount: true,
    items: hints.map((hint) => ({ label: hint.label, hint: hint.title, tone: hint.tone })),
  }))
  const hasWord = badges.length === 1 ? 'hint' : 'hints'

  return (
    // The row can be clicked too, so a click on the name stays here.
    <span className="min-w-0 max-w-full" onClick={(event) => event.stopPropagation()}>
      <ListPopover
        count={badges.length}
        groups={groups}
        dialogLabel={`Hints for ${name}`}
        mono={false}
        className="max-w-full"
        trigger={<span className="block truncate">{name}</span>}
        triggerLabel={`${name}, ${badges.length} ${hasWord}`}
        triggerTitle="Click to see the hints"
        triggerClassName={`block max-w-full cursor-pointer truncate text-left font-display font-bold underline decoration-dotted decoration-1 underline-offset-4 transition-colors hover:decoration-2 ${NAME_TONE[tone]}`}
      />
    </span>
  )
}
