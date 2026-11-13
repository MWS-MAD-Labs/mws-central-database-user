import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Users } from 'lucide-react'
import { Button } from '../../../components/ui/Button.jsx'
import { ListPopover } from '../../../components/ui/ListPopover.jsx'
import { useConfirm } from '../../../components/ui/useConfirm.js'
import { showErrorToast, showSuccessToast } from '../../../lib/toast.js'
import { googleAccountApi } from '../../google/api/googleAccountApi.js'
import { PanelFrame } from './PanelFrame.jsx'

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

const TYPE_NAME = { EMPLOYEE: 'Employee', INTERN: 'Intern', STUDENT: 'Student' }

// The people behind a number: the name, then who they are and what Google said. A name alone does not say who to look at.
function peopleGroup(list = []) {
  return [
    {
      hideCount: true,
      items: list.map((person) => ({
        label: person.full_name,
        hint: [person.email, TYPE_NAME[person.person_type], person.reason].filter(Boolean).join(' · '),
      })),
    },
  ]
}

// A number, and when it is more than none and Central knows who they are, the number opens that list.
function Tile({ label, value, people }) {
  return (
    <div className="rounded-2xl border border-(--mws-line) bg-(--mws-soft) p-4">
      <p className="text-xs font-semibold text-(--mws-muted)">{label}</p>
      {people && value > 0 ? (
        <ListPopover
          label={String(value)}
          count={value}
          dialogLabel={label}
          icon={false}
          mono={false}
          groups={peopleGroup(people)}
          className="mt-1 [&>button]:text-2xl [&>button]:font-semibold [&>button]:text-(--mws-charcoal)"
        />
      ) : (
        <p className="mt-1 text-2xl font-semibold text-(--mws-charcoal)">{value}</p>
      )}
    </div>
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
              <Tile label="Suspended" value={view.suspended} people={view.suspended_list} />
              <Tile label="Deleted In Google" value={view.missing} people={view.missing_list} />
              <Tile label="Failed" value={view.failed} people={view.failed_list} />
              <Tile label="In Google, Not Linked" value={matches.length} />
              <Tile label="Not In Google" value={view.not_in_google} />
              <Tile label="Not Checked" value={view.not_checked ?? 0} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-(--mws-muted)">
                <span>{students ? 'Students who can be linked' : 'People who can be linked'}</span>
                <ListPopover
                  label="List"
                  count={matches.length}
                  dialogLabel={students ? 'Students who can be linked' : 'People who can be linked'}
                  mono={false}
                  groups={[
                    {
                      hideCount: true,
                      items: matches.map((match) => ({ label: match.full_name, hint: match.email })),
                    },
                  ]}
                />
              </div>
              <Button type="button" loading={link.isPending} disabled={matches.length === 0} onClick={handleLink}>
                Link
              </Button>
            </div>
            {students && (view.blocked ?? []).length > 0 ? (
              <div className="flex items-center gap-2 text-sm text-(--mws-muted)">
                <span>Cannot be linked</span>
                <ListPopover
                  label="List"
                  count={view.blocked.length}
                  dialogLabel="Students who cannot be linked"
                  mono={false}
                  groups={peopleGroup(view.blocked)}
                />
              </div>
            ) : null}
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
    </PanelFrame>
  )
}
