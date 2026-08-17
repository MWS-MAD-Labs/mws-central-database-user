import { useState } from 'react'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import { Field, SearchableSelect } from '../../../components/ui/FormControls.jsx'
import { CONTRACT_DURATION_OPTIONS } from '../../../lib/form.js'

// Duration-based, not an absolute date - each selected employee has its own
// current contract_end_date (or none yet), so a single target date wouldn't
// make sense across a mixed selection. Each one is extended by this same
// duration counted from its own current end date (or today if it doesn't
// have one). PERMANENT employees are skipped automatically server-side -
// they show up in the failed count, not blocking the rest of the batch.
export function BulkExtendContractDialog({
  selectedCount,
  onClose,
  onConfirm,
  isSaving,
}) {
  const [duration, setDuration] = useState('')

  function handleSubmit(event) {
    event.preventDefault()
    if (!duration) return
    onConfirm(Number(duration))
  }

  return (
    <CrudDialog
      title="Extend contracts"
      description={`Extend ${selectedCount} selected employee(s)' contracts by a fixed duration, counted from each one's own current end date (or today if they don't have one yet).`}
      onClose={onClose}
      panelClassName="max-w-md"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" form="bulk-extend-contract-form" disabled={isSaving || !duration}>
            {isSaving ? 'Extending...' : 'Extend'}
          </Button>
        </>
      }
    >
      <form id="bulk-extend-contract-form" onSubmit={handleSubmit} className="space-y-4">
        <p className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]">
          PERMANENT employees don't have a contract to extend - they're skipped automatically, the rest still go through.
        </p>
        <Field label="Extend by">
          <SearchableSelect
            value={duration}
            onChange={setDuration}
            options={CONTRACT_DURATION_OPTIONS}
            placeholder="Select duration"
            searchPlaceholder="Search durations"
          />
        </Field>
      </form>
    </CrudDialog>
  )
}
