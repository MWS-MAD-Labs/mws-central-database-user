import { groupHints, worstTone } from '../../lib/format.js'
import { ListPopover } from './ListPopover.jsx'

// The hints of a row in one small control. Click it and the hints that apply are listed, grouped by what they are about.
export function HintsPopover({ badges }) {
  if (!badges || badges.length === 0) return null
  const groups = groupHints(badges).map(({ category, hints }) => ({
    title: category,
    hideCount: true,
    items: hints.map((hint) => ({ label: hint.label, hint: hint.title, tone: hint.tone })),
  }))
  return (
    // The row can be clicked too, so a click on the hints stays here.
    <span className="shrink-0" onClick={(event) => event.stopPropagation()}>
      <ListPopover
        label={`${badges.length} ${badges.length === 1 ? 'Hint' : 'Hints'}`}
        count={badges.length}
        groups={groups}
        dialogLabel="Hints"
        mono={false}
        icon={false}
        tone={worstTone(badges)}
      />
    </span>
  )
}
