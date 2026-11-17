import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TextAction } from '../../../components/ui/TextAction.jsx'
import { googleAccountApi } from '../api/googleAccountApi.js'
import { ChangeEmailDialog } from './ChangeEmailDialog.jsx'
import { UnlinkGoogleDialog } from './UnlinkGoogleDialog.jsx'

// Under the locked Email field of an edit form: the way to change it, for a Super Admin, and who to ask for anyone else.
// Next to it, the way to let go of the Google account, so an address another account holds can be used.
export function ChangeEmailAction({ resource, id, currentEmail, name, canChange }) {
  const [dialog, setDialog] = useState(null)
  const status = useQuery({
    queryKey: ['google-account', resource, id],
    queryFn: () => googleAccountApi.status(resource, id),
    enabled: Boolean(canChange && id),
    staleTime: 0,
  })
  if (!canChange) {
    return <span className="text-xs text-(--mws-muted)">Only a Super Admin can change an email.</span>
  }
  const canUnlink = Boolean(status.data?.linked) && Boolean(status.data?.can?.manage) && status.data?.status !== 'PENDING_CLAIM'
  return (
    <>
      <span className="flex w-full items-center justify-end gap-4">
        {canUnlink ? (
          <TextAction type="button" onClick={() => setDialog('unlink')}>
            Unlink Google
          </TextAction>
        ) : null}
        <TextAction type="button" onClick={() => setDialog('email')}>
          Change email
        </TextAction>
      </span>
      {dialog === 'email' ? <ChangeEmailDialog resource={resource} id={id} currentEmail={currentEmail} name={name} onClose={() => setDialog(null)} /> : null}
      {dialog === 'unlink' ? <UnlinkGoogleDialog resource={resource} id={id} email={currentEmail} onClose={() => setDialog(null)} /> : null}
    </>
  )
}
