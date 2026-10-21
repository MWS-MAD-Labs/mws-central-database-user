import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Users } from 'lucide-react'
import { Button } from '../../../components/ui/Button.jsx'
import { ListPopover } from '../../../components/ui/ListPopover.jsx'
import { useConfirm } from '../../../components/ui/useConfirm.js'
import { showErrorToast, showSuccessToast } from '../../../lib/toast.js'
import { googleAccountApi } from '../../google/api/googleAccountApi.js'
import { PanelFrame } from './PanelFrame.jsx'

const KEY = ['google-link-preview']

function Tile({ label, value }) {
  return (
    <div className="rounded-2xl border border-(--mws-line) bg-(--mws-soft) p-4">
      <p className="text-xs font-semibold text-(--mws-muted)">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-(--mws-charcoal)">{value}</p>
    </div>
  )
}

// How the people in Central stand against Google, and the one action that fixes the common gap: people made before the
// Google accounts whose email is already there.
export function GoogleAccountsCard() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const query = useQuery({ queryKey: KEY, queryFn: googleAccountApi.linkPreview, retry: false, staleTime: 60_000 })
  const data = query.data

  const link = useMutation({
    mutationFn: googleAccountApi.linkExisting,
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
      description: `${data.matches.length} ${data.matches.length === 1 ? 'person has' : 'people have'} an email that is already a Google account. Linking connects them and changes nothing in Google.`,
      confirmLabel: 'Link',
    })
    if (confirmed) link.mutate()
  }

  return (
    <PanelFrame
      title="Google Accounts"
      description="How the people in Central stand against Google."
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
        ) : !data ? (
          <p className="text-sm text-(--mws-muted)">Loading...</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label="Linked" value={data.linked_total} />
              <Tile label="In Google, Not Linked" value={data.matches.length} />
              <Tile label="Not In Google" value={data.not_in_google} />
              <Tile label="Failed" value={data.failed} />
              <Tile label="Suspended" value={data.suspended} />
              <Tile label="Deleted In Google" value={data.missing} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-(--mws-muted)">
                <span>People who can be linked</span>
                <ListPopover
                  label="List"
                  count={data.matches.length}
                  dialogLabel="People who can be linked"
                  mono={false}
                  groups={[
                    {
                      hideCount: true,
                      items: data.matches.map((match) => ({ label: match.full_name, hint: match.email })),
                    },
                  ]}
                />
              </div>
              <Button type="button" loading={link.isPending} disabled={data.matches.length === 0} onClick={handleLink}>
                Link
              </Button>
            </div>
            {data.skipped.admin + data.skipped.linked_elsewhere + data.skipped.not_allowed > 0 ? (
              <p className="text-xs text-(--mws-muted)">
                Left out: {data.skipped.admin} Workspace {data.skipped.admin === 1 ? 'admin' : 'admins'},{' '}
                {data.skipped.linked_elsewhere} already linked to someone else, {data.skipped.not_allowed} not allowed here.
              </p>
            ) : null}
          </>
        )}
      </div>
    </PanelFrame>
  )
}
