import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ChevronRight, RefreshCw, Users } from 'lucide-react'
import { Button } from '../../../components/ui/Button.jsx'
import { useConfirm } from '../../../components/ui/useConfirm.js'
import { showErrorToast, showSuccessToast } from '../../../lib/toast.js'
import { googleAccountApi } from '../../google/api/googleAccountApi.js'
import { PanelFrame } from './PanelFrame.jsx'
import { PeopleListDialog } from './PeopleListDialog.jsx'

const keyOf = (kind) => ['google-link-preview', kind]

// What the tiles read while the answer is not in yet, so nothing below ever reads a property of nothing.
const EMPTY = {
  matches: [],
  skipped: { admin: 0, linked_elsewhere: 0, not_allowed: 0 },
  linked_total: 0,
  not_in_google: 0,
  not_checked: 0,
  failed: 0,
  suspended: 0,
  missing: 0,
  blocked: [],
  suspended_list: [],
  missing_list: [],
  failed_list: [],
}

// One look for every number. When Central knows who is behind it (and it is more than none), the whole tile opens them.
function Tile({ label, value, people, onOpen }) {
  const look = 'rounded-2xl border border-(--mws-line) bg-(--mws-soft) p-4 text-left'
  const body = (
    <>
      <span className="block text-xs font-semibold text-(--mws-muted)">{label}</span>
      <span className="mt-1 block text-2xl font-semibold text-(--mws-charcoal)">{value}</span>
    </>
  )
  if (!people || value <= 0) return <div className={look}>{body}</div>
  return (
    <button
      type="button"
      aria-label={`${label}, ${value}, show people`}
      onClick={onOpen}
      className={`${look} relative cursor-pointer transition-colors hover:border-(--mws-burgundy) hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--mws-burgundy)`}
    >
      {body}
      <ChevronRight size={16} aria-hidden="true" className="absolute right-3 top-3 text-(--mws-muted)" />
    </button>
  )
}

// How the people in Central stand against Google, and the one action that fixes the common gap: people made before the
// Google accounts whose email is already there.
export function GoogleAccountsCard({ kind = 'staff' }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const students = kind === 'students'
  const KEY = keyOf(kind)
  const query = useQuery({ queryKey: KEY, queryFn: () => googleAccountApi.linkPreview(kind), retry: false, staleTime: 60_000 })
  const data = query.data
  // Only a whole answer is shown; anything else (still loading, an odd reply) reads as loading.
  const ready = Array.isArray(data?.matches)
  const view = ready ? data : EMPTY
  const matches = view.matches ?? []
  const skipped = view.skipped ?? EMPTY.skipped
  // The list that is open: its title, the people, and the whole count behind the number.
  const [open, setOpen] = useState(null)
  const show = (title, people, total) => () => setOpen({ title, people: people ?? [], total })

  const link = useMutation({
    mutationFn: () => googleAccountApi.linkExisting(kind),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: KEY })
      queryClient.invalidateQueries({ queryKey: ['google-account'] })
      showSuccessToast(`${result.linked} ${result.linked === 1 ? 'Account' : 'Accounts'} Linked.`)
    },
    onError: (error) => showErrorToast(error, 'Accounts were not linked.'),
  })

  async function handleLink() {
    const confirmed = await confirm({
      title: 'Link Existing Accounts',
      description: `${matches.length} ${students ? (matches.length === 1 ? 'student has' : 'students have') : matches.length === 1 ? 'person has' : 'people have'} an email that is already a Google account. Linking connects them and changes nothing in Google.`,
      confirmLabel: 'Link',
    })
    if (confirmed) link.mutate()
  }

  return (
    <PanelFrame
      title={students ? 'Student Google Accounts' : 'Google Accounts'}
      icon={Users}
      isFetching={query.isFetching}
      action={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Check Google again"
          title="Check Google again"
          disabled={query.isFetching}
          onClick={() => query.refetch()}
        >
          <RefreshCw size={15} />
        </Button>
      }
    >
      <div className="space-y-5 p-5">
        {query.isError ? (
          <p className="text-sm text-[#a43c41]">{query.error?.message || 'Google could not be read.'}</p>
        ) : !ready ? (
          <p className="text-sm text-(--mws-muted)">Loading...</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label="Linked" value={view.linked_total} />
              <Tile label="Suspended" value={view.suspended} people={view.suspended_list} onOpen={show('Suspended', view.suspended_list, view.suspended)} />
              <Tile label="Deleted In Google" value={view.missing} people={view.missing_list} onOpen={show('Deleted In Google', view.missing_list, view.missing)} />
              <Tile label="Failed" value={view.failed} people={view.failed_list} onOpen={show('Failed', view.failed_list, view.failed)} />
              <Tile label="In Google, Not Linked" value={matches.length} people={matches} onOpen={show('In Google, Not Linked', matches, matches.length)} />
              <Tile label="Not In Google" value={view.not_in_google} />
              <Tile label="Not Checked" value={view.not_checked ?? 0} />
              {students ? (
                <Tile label="Cannot Be Linked" value={(view.blocked ?? []).length} people={view.blocked} onOpen={show('Cannot Be Linked', view.blocked, (view.blocked ?? []).length)} />
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-(--mws-muted)">
                {matches.length} {students ? (matches.length === 1 ? 'student' : 'students') : matches.length === 1 ? 'person' : 'people'} can be linked
              </p>
              <Button type="button" loading={link.isPending} disabled={matches.length === 0} onClick={handleLink}>
                Link
              </Button>
            </div>
            {(view.not_checked ?? 0) > 0 ? (
              <p className="text-xs text-(--mws-muted)">
                Not Checked are the people whose address Central may not look up from here. Outside production only addresses
                starting with the test prefix are sent to Google.
              </p>
            ) : null}
            {skipped.admin + skipped.linked_elsewhere > 0 ? (
              <p className="text-xs text-(--mws-muted)">
                Left out: {skipped.admin} Workspace {skipped.admin === 1 ? 'admin' : 'admins'},{' '}
                {skipped.linked_elsewhere} already linked to someone else.
              </p>
            ) : null}
          </>
        )}
      </div>
      {open ? <PeopleListDialog title={open.title} people={open.people} total={open.total} onClose={() => setOpen(null)} /> : null}
    </PanelFrame>
  )
}
