import { useMemo, useState } from 'react'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import { TextInput } from '../../../components/ui/FormControls.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'

const PAGE_SIZE = 10
const TYPE_NAME = { EMPLOYEE: 'Employee', INTERN: 'Intern', STUDENT: 'Student' }

// The people behind a number, ten to a page, searchable by name or email. The list is whatever the server sent; `total`
// is the whole count, so a list the server cut short says so.
export function PeopleListDialog({ title, people, total, onClose, selectable = false, onLinkSelected, isLinking = false }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  // Who is ticked, kept across pages and searches. Only people the server says may be linked anyway can be.
  const [picked, setPicked] = useState(() => new Set())

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return people
    return people.filter((person) => `${person.full_name} ${person.email}`.toLowerCase().includes(needle))
  }, [people, search])

  const pickable = shown.filter((person) => person.forceable)
  const allPicked = pickable.length > 0 && pickable.every((person) => picked.has(person.person_id))
  const toggle = (id) =>
    setPicked((before) => {
      const next = new Set(before)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = () =>
    setPicked((before) => {
      const next = new Set(before)
      for (const person of pickable) {
        if (allPicked) next.delete(person.person_id)
        else next.add(person.person_id)
      }
      return next
    })

  const totalPage = Math.max(Math.ceil(shown.length / PAGE_SIZE), 1)
  const current = Math.min(page, totalPage)
  const rows = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  return (
    <CrudDialog title={title} onClose={onClose} panelClassName="max-w-xl">
      <div className="space-y-3 p-5">
        <TextInput
          type="search"
          aria-label="Search people"
          placeholder="Search name or email"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
        {selectable && pickable.length > 0 ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-(--mws-muted)">
            <input type="checkbox" checked={allPicked} onChange={toggleAll} aria-label="Select everyone who can be linked anyway" />
            Select everyone who can be linked anyway ({pickable.length})
          </label>
        ) : null}
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-(--mws-muted)">Nobody matches.</p>
        ) : (
          <ul className="divide-y divide-(--mws-line) rounded-xl border border-(--mws-line)">
            {rows.map((person, index) => (
              <li key={`${person.person_id}-${index}`} className="flex items-start gap-3 px-3 py-2">
                {selectable ? (
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={!person.forceable}
                    checked={picked.has(person.person_id)}
                    onChange={() => toggle(person.person_id)}
                    aria-label={`Link ${person.full_name} anyway`}
                    title={person.forceable ? undefined : 'This one cannot be linked anyway'}
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold text-(--mws-charcoal)">{person.full_name}</p>
                  <p className="break-words text-xs text-(--mws-muted)">
                    {[person.email, TYPE_NAME[person.person_type]].filter(Boolean).join(' · ')}
                  </p>
                  {person.google_name ? (
                    <p className="break-words text-xs text-(--mws-muted)">Google: {person.google_name} · Central: {person.full_name}</p>
                  ) : null}
                  {person.reason ? <p className="mt-0.5 break-words text-xs text-[#8a6419]">{person.reason}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {selectable ? (
          <div className="flex justify-end">
            <Button type="button" disabled={picked.size === 0} loading={isLinking} onClick={() => onLinkSelected([...picked])}>
              Link Selected ({picked.size})
            </Button>
          </div>
        ) : null}
        {total > people.length ? (
          <p className="text-xs text-(--mws-muted)">Showing the first {people.length} of {total}.</p>
        ) : null}
      </div>
      <PaginationBar
        paging={{ current_page: current, total_page: totalPage, total_item: shown.length, size: PAGE_SIZE }}
        itemLabel={shown.length === 1 ? 'person' : 'people'}
        onPrevious={() => setPage(Math.max(current - 1, 1))}
        onNext={() => setPage(Math.min(current + 1, totalPage))}
        showPageJump={false}
      />
    </CrudDialog>
  )
}
