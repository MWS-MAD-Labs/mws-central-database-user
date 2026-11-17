import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import { Field, TextAreaInput, TextInput } from '../../../components/ui/FormControls.jsx'
import { sanitizeEmailLocalPart } from '../../../lib/form.js'
import { showErrorToast, showInfoToast, showSuccessToast } from '../../../lib/toast.js'
import { emailChangeApi } from '../api/emailChangeApi.js'
import { googleAccountApi } from '../api/googleAccountApi.js'
import { EmailCheckNote } from './EmailCheckNote.jsx'
import { useEmailCheck } from '../hooks/useEmailCheck.js'

const DOMAIN = 'millennia21.id'
const MAX_LOCAL = 50 - 1 - DOMAIN.length

// The one place an email is changed. The person's Google account is renamed with it and they sign in with the new
// address from then on, so it asks for the new address twice, checks it, and wants a reason for the audit log.
export function ChangeEmailDialog({ resource, id, currentEmail, name, onClose }) {
  const queryClient = useQueryClient()
  const [local, setLocal] = useState('')
  const [again, setAgain] = useState('')
  const [reason, setReason] = useState('')

  const email = local ? `${local}@${DOMAIN}` : ''
  const check = useEmailCheck(email, { person: { resource, id } })
  // Whether the person has a Google account linked, for the shortcut that lets go of it.
  const status = useQuery({ queryKey: ['google-account', resource, id], queryFn: () => googleAccountApi.status(resource, id), staleTime: 0 })
  const same = email === currentEmail
  const mismatch = Boolean(again) && again !== local
  const reasonOk = reason.trim().length >= 5
  const ready = Boolean(local) && !same && !check.blocked && again === local && reasonOk
  // The address is on another Google account and this person has one linked: letting go of theirs frees the way.
  const canUnlink = check.state === 'taken' && check.reason === 'IN_GOOGLE' && Boolean(status.data?.linked) && Boolean(status.data?.can?.manage)

  const change = useMutation({
    mutationFn: () => emailChangeApi.change(resource, id, { email, reason: reason.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [resource] })
      queryClient.invalidateQueries({ queryKey: ['google-account', resource, id] })
      showSuccessToast('Email changed.')
      if (check.state === 'held') showInfoToast('Use Link existing to link the Google account that has this address. Check its name in Google first.')
      onClose()
    },
    onError: (error) => showErrorToast(error, 'The email was not changed.'),
  })

  const unlink = useMutation({
    mutationFn: () => googleAccountApi.unlink(resource, id, reason.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['google-account', resource, id] })
      showSuccessToast('Google account unlinked.')
      // The same address, asked again now that the person has no account linked.
      check.recheck()
    },
    onError: (error) => showErrorToast(error, 'The Google account was not unlinked.'),
  })

  return (
    <CrudDialog
      title="Change Email"
      description={`This changes the email ${name ? `of ${name} ` : ''}everywhere. Do it only for a misspelt or changed address.`}
      panelClassName="max-w-xl"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" loading={change.isPending} disabled={!ready} onClick={() => change.mutate()}>
            Change Email
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl bg-(--mws-soft) px-5 py-4 text-sm">
          <p className="text-(--mws-muted)">Current email</p>
          <p className="font-semibold text-(--mws-charcoal)">{currentEmail}</p>
        </div>
        <Field
          label="New Email"
          name="new_email_local"
          required
          error={same ? 'That is the current email.' : undefined}
          hint={<EmailCheckNote check={check} />}
        >
          <div className="flex min-w-0 items-stretch">
            <TextInput
              className="rounded-r-none"
              value={local}
              maxLength={MAX_LOCAL}
              autoComplete="off"
              onChange={(event) => setLocal(sanitizeEmailLocalPart(event.target.value))}
            />
            <span className="flex shrink-0 items-center whitespace-nowrap rounded-r-xl border border-l-0 border-(--mws-line) bg-(--mws-soft) px-3 text-sm text-(--mws-muted)">
              @{DOMAIN}
            </span>
          </div>
        </Field>
        <Field
          label="Confirm New Email"
          name="new_email_again"
          required
          error={mismatch ? 'The two emails do not match.' : undefined}
        >
          <div className="flex min-w-0 items-stretch">
            <TextInput
              className="rounded-r-none"
              value={again}
              maxLength={MAX_LOCAL}
              autoComplete="off"
              disabled={!local}
              onPaste={(event) => event.preventDefault()}
              onChange={(event) => setAgain(sanitizeEmailLocalPart(event.target.value))}
            />
            <span className="flex shrink-0 items-center whitespace-nowrap rounded-r-xl border border-l-0 border-(--mws-line) bg-(--mws-soft) px-3 text-sm text-(--mws-muted)">
              @{DOMAIN}
            </span>
          </div>
        </Field>
        {canUnlink ? (
          <div className="rounded-xl border border-(--mws-line) bg-(--mws-soft) px-4 py-3 text-sm">
            <p className="text-(--mws-muted)">
              Another Google account has this address. Unlink the Google account of {name || 'this person'} so the address can be used.
              Nothing changes in Google. Write the reason below first.
            </p>
            <Button type="button" variant="secondary" size="sm" className="mt-2" loading={unlink.isPending} disabled={!reasonOk} onClick={() => unlink.mutate()}>
              Unlink Google
            </Button>
          </div>
        ) : null}
        <Field label="Reason" name="email_change_reason" required>
          <TextAreaInput rows={3} value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <ul className="list-disc space-y-1 pl-5 text-sm text-(--mws-muted)">
          <li>The Google account is renamed to the new address. It is the same account with the same data.</li>
          <li>The person signs in with the new address from now on.</li>
          <li>Apps that find people by email may need the new address too.</li>
        </ul>
      </div>
    </CrudDialog>
  )
}
