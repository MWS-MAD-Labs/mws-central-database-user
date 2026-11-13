import { useMemo, useState } from 'react'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import { TextInput } from '../../../components/ui/FormControls.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'

const PAGE_SIZE = 10
const TYPE_NAME = { EMPLOYEE: 'Employee', INTERN: 'Intern', STUDENT: 'Student' }

// The people behind a number, ten to a page, searchable by name or email. The list is whatever the server sent; `total`
// is the whole count, so a list the server cut short says so.
export function PeopleListDialog({ title, people, total, onClose }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return people
    return people.filter((person) => `${person.full_name} ${person.email}`.toLowerCase().includes(needle))
  }, [people, search])

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
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-(--mws-muted)">Nobody matches.</p>
        ) : (
          <ul className="divide-y divide-(--mws-line) rounded-xl border border-(--mws-line)">
            {rows.map((person, index) => (
              <li key={`${person.person_id}-${index}`} className="px-3 py-2">
                <p className="break-words text-sm font-semibold text-(--mws-charcoal)">{person.full_name}</p>
                <p className="break-words text-xs text-(--mws-muted)">
                  {[person.email, TYPE_NAME[person.person_type]].filter(Boolean).join(' · ')}
                </p>
                {person.reason ? <p className="mt-0.5 break-words text-xs text-[#8a6419]">{person.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
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
