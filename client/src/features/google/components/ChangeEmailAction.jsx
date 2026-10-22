import { useState } from 'react'
import { TextAction } from '../../../components/ui/TextAction.jsx'
import { ChangeEmailDialog } from './ChangeEmailDialog.jsx'

// Under the locked Email field of an edit form: the way to change it, for a Super Admin, and who to ask for anyone else.
export function ChangeEmailAction({ resource, id, currentEmail, name, canChange }) {
  const [open, setOpen] = useState(false)
  if (!canChange) {
    return <span className="text-xs text-(--mws-muted)">Only a Super Admin can change an email.</span>
  }
  return (
    <>
      <span className="flex w-full items-center justify-between gap-3">
        <span className="text-xs text-(--mws-muted)">The email is locked. Changing it renames the Google account too.</span>
        <TextAction type="button" onClick={() => setOpen(true)}>
          Change email
        </TextAction>
      </span>
      {open ? <ChangeEmailDialog resource={resource} id={id} currentEmail={currentEmail} name={name} onClose={() => setOpen(false)} /> : null}
    </>
  )
}
