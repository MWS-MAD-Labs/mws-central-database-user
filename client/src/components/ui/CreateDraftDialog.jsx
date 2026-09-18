import { FileClock, RotateCcw } from 'lucide-react'
import { Button } from './Button.jsx'
import { CrudDialog } from './CrudDialog.jsx'

export function CreateDraftDialog({ entityLabel, draft, onContinue, onStartFresh }) {
  if (!draft) return null

  const savedAt = new Date(draft.saved_at).toLocaleString()

  return (
    <CrudDialog
      title={`Continue ${entityLabel} draft?`}
      description={`A draft with ${draft.filled_field_count} filled fields was saved on ${savedAt}.`}
      onClose={onStartFresh}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onStartFresh}>
            <RotateCcw size={15} /> Start fresh
          </Button>
          <Button type="button" onClick={onContinue}>
            <FileClock size={15} /> Continue draft
          </Button>
        </>
      }
    >
      <div className="rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3 text-sm text-(--mws-muted)">
        Your unfinished form is kept only for this browser session. Uploaded photos must be selected again after a refresh.
      </div>
    </CrudDialog>
  )
}
