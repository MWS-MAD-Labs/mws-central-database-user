import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, RefreshCw, RotateCcw, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { showErrorToast, showSuccessToast } from '../../../lib/toast.js'
import { dataTransferApi, downloadBlob } from '../api/dataTransferApi.js'

const entityLabels = {
  students: 'students',
  employees: 'employees',
}

export function DataTransferActions({
  entity,
  exportParams,
  canImport,
  canExport = true,
}) {
  const [isImportOpen, setIsImportOpen] = useState(false)

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={!canImport}
        onClick={() => setIsImportOpen(true)}
      >
        <Upload size={16} />
        Import
      </Button>
      <ExportButton
        entity={entity}
        format="csv"
        exportParams={exportParams}
        disabled={!canExport}
      />
      <ExportButton
        entity={entity}
        format="xlsx"
        exportParams={exportParams}
        disabled={!canExport}
      />

      {isImportOpen ? (
        <ImportDialog entity={entity} onClose={() => setIsImportOpen(false)} />
      ) : null}
    </div>
  )
}

function ExportButton({ entity, format, exportParams, disabled }) {
  const exportMutation = useMutation({
    mutationFn: () =>
      dataTransferApi.exportFile(entity, {
        ...exportParams,
        format,
      }),
    onSuccess: ({ blob, fileName }) => {
      downloadBlob(blob, fileName || `${entityLabels[entity]}-export.${format}`)
      showSuccessToast(`${format.toUpperCase()} export downloaded.`)
    },
    onError: (error) => showErrorToast(error, 'Export failed.'),
  })

  return (
    <Button
      type="button"
      variant="secondary"
      disabled={disabled || exportMutation.isPending}
      onClick={() => exportMutation.mutate()}
    >
      <Download size={16} />
      {exportMutation.isPending ? 'Exporting' : format.toUpperCase()}
    </Button>
  )
}

function ImportDialog({ entity, onClose }) {
  const queryClient = useQueryClient()
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [draftRows, setDraftRows] = useState([])
  const [isDirty, setIsDirty] = useState(false)

  const previewMutation = useMutation({
    mutationFn: (nextFile) => dataTransferApi.preview(entity, nextFile || file),
    onSuccess: (data) => {
      setPreview(data)
      setDraftRows((data.rows || []).map((row) => ({ ...row.raw })))
      setIsDirty(false)
      showSuccessToast('Import preview is ready.')
    },
    onError: (error) => showErrorToast(error, 'Import preview failed.'),
  })

  const commitMutation = useMutation({
    mutationFn: () => dataTransferApi.commit(entity, preview.job_id),
    onSuccess: (data) => {
      setPreview(data)
      queryClient.invalidateQueries({ queryKey: [entity] })
      showSuccessToast('Import committed.')
    },
    onError: (error) => showErrorToast(error, 'Import commit failed.'),
  })

  const rollbackMutation = useMutation({
    mutationFn: () => dataTransferApi.rollback(entity, preview.job_id),
    onSuccess: (data) => {
      setPreview(data)
      queryClient.invalidateQueries({ queryKey: [entity] })
      showSuccessToast('Import rolled back.')
    },
    onError: (error) => showErrorToast(error, 'Import rollback failed.'),
  })

  const summaryRows = useMemo(() => {
    const summary = preview?.summary
    if (!summary) return []

    return [
      ['Total rows', summary.total_rows],
      ['Valid rows', summary.valid_rows],
      ['Error rows', summary.error_rows],
      ['Create', summary.create_count],
      ['Update', summary.update_count],
      ['Reverted', summary.reverted_count],
      ['Rollback failed', summary.failed_count],
    ].filter(([, value]) => value !== undefined && value !== null)
  }, [preview])

  const visibleRows = preview?.rows || []
  const editableColumns = useMemo(() => {
    return getEditableColumns(preview, draftRows)
  }, [draftRows, preview])
  const canCommit =
    preview?.job_id &&
    preview.status === 'PENDING' &&
    preview.summary?.valid_rows > 0 &&
    preview.summary?.error_rows === 0 &&
    !isDirty
  const canRollback = preview?.job_id && preview.status === 'COMPLETED'

  function handleFileChange(event) {
    const nextFile = event.target.files?.[0] || null
    setFile(nextFile)
    setPreview(null)
    setDraftRows([])
    setIsDirty(false)
  }

  function updateCell(rowIndex, column, value) {
    setDraftRows((current) =>
      current.map((row, index) =>
        index === rowIndex ? { ...row, [column]: value } : row,
      ),
    )
    setIsDirty(true)
  }

  function revalidateDraft() {
    const editedFile = createCsvFile(
      editableColumns,
      draftRows,
      file?.name || `${entityLabels[entity]}-import.csv`,
    )
    previewMutation.mutate(editedFile)
  }

  return (
    <CrudDialog
      title={`Import ${entityLabels[entity]}`}
      description="Upload CSV or Excel, edit invalid cells in preview, revalidate, then commit."
      onClose={onClose}
      panelClassName="max-w-6xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          {preview ? (
            <Button
              type="button"
              variant="secondary"
              disabled={!isDirty || previewMutation.isPending}
              onClick={revalidateDraft}
            >
              <RefreshCw size={16} />
              {previewMutation.isPending ? 'Validating' : 'Revalidate'}
            </Button>
          ) : null}
          {canRollback ? (
            <Button
              type="button"
              variant="danger"
              disabled={rollbackMutation.isPending}
              onClick={() => rollbackMutation.mutate()}
            >
              <RotateCcw size={16} />
              Rollback
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={!canCommit || commitMutation.isPending}
            onClick={() => commitMutation.mutate()}
          >
            <CheckCircle2 size={16} />
            Commit
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="space-y-1.5">
            <span className="block font-display text-xs font-bold text-[var(--mws-muted)]">
              File
            </span>
            <input
              type="file"
              accept=".csv,.xls,.xlsx"
              onChange={handleFileChange}
              className="block h-11 w-full rounded-xl border border-[var(--mws-line)] bg-white px-3 py-2 text-sm text-[var(--mws-charcoal)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--mws-soft)] file:px-3 file:py-1.5 file:font-display file:text-xs file:font-semibold file:text-[var(--mws-burgundy)] focus:outline-none"
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={!file || previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
          >
            <Upload size={16} />
            {previewMutation.isPending ? 'Previewing' : 'Preview'}
          </Button>
        </div>

        {preview ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={preview.status === 'PENDING' ? 'amber' : 'green'}>
                {preview.status}
              </StatusBadge>
              {isDirty ? (
                <StatusBadge tone="amber">Needs revalidation</StatusBadge>
              ) : null}
              <span className="text-sm text-[var(--mws-muted)]">
                Job {preview.job_id || preview.id}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {summaryRows.map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-2xl border border-[var(--mws-line)] bg-[var(--mws-soft)] px-4 py-3"
                >
                  <p className="text-xs font-semibold text-[var(--mws-muted)]">
                    {label}
                  </p>
                  <p className="mt-1 font-display text-xl font-bold text-[var(--mws-charcoal)]">
                    {value}
                  </p>
                </div>
              ))}
            </div>

            {preview.unmapped_headers?.length ? (
              <div className="rounded-2xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]">
                Unmapped headers: {preview.unmapped_headers.join(', ')}
              </div>
            ) : null}

            <div className="overflow-hidden rounded-2xl border border-[var(--mws-line)]">
              <div className="border-b border-[var(--mws-line)] bg-[var(--mws-soft)] px-4 py-3">
                <h3 className="font-display text-sm font-bold text-[var(--mws-charcoal)]">
                  Editable Preview
                </h3>
              </div>
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-white font-display text-xs font-bold text-[var(--mws-muted)]">
                    <tr>
                      <th className="sticky left-0 top-0 z-20 w-20 bg-white px-4 py-3">
                        Row
                      </th>
                      <th className="sticky top-0 z-10 w-28 bg-white px-4 py-3">
                        Action
                      </th>
                      {editableColumns.map((column) => (
                        <th
                          key={column}
                          className="sticky top-0 z-10 min-w-44 bg-white px-3 py-3"
                        >
                          {column}
                        </th>
                      ))}
                      <th className="sticky right-0 top-0 z-20 min-w-72 bg-white px-4 py-3">
                        Validation
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.row_number} className="border-t border-[var(--mws-line)]">
                        <td className="sticky left-0 z-10 bg-white px-4 py-3 font-semibold">
                          {row.row_number}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge tone={row.action === 'CREATE' ? 'green' : 'amber'}>
                            {row.action || 'Skipped'}
                          </StatusBadge>
                        </td>
                        {editableColumns.map((column) => (
                          <td key={column} className="px-2 py-2">
                            <input
                              value={draftRows[row.row_number - 2]?.[column] || ''}
                              onChange={(event) =>
                                updateCell(row.row_number - 2, column, event.target.value)
                              }
                              className="h-9 w-full rounded-lg border border-[var(--mws-line)] bg-white px-2 text-sm text-[var(--mws-charcoal)] outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A]"
                            />
                          </td>
                        ))}
                        <td className="sticky right-0 z-10 bg-white px-4 py-3">
                          {row.errors?.length ? (
                            <div className="space-y-1 text-xs font-semibold text-[#9f3d41]">
                              {row.errors.map((error) => (
                                <p key={error}>{error}</p>
                              ))}
                            </div>
                          ) : row.warnings?.length ? (
                            <div className="space-y-1 text-xs font-semibold text-[#805b18]">
                              {row.warnings.map((warning) => (
                                <p key={warning}>{warning}</p>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs font-semibold text-[var(--mws-muted)]">
                              Valid
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.rows?.length ? (
                <div className="border-t border-[var(--mws-line)] px-4 py-3 text-xs font-semibold text-[var(--mws-muted)]">
                  Showing {preview.rows.length} rows. Edit cells, then revalidate before commit.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </CrudDialog>
  )
}

function getEditableColumns(preview, draftRows) {
  const headers = []
  const seen = new Set()

  Object.keys(preview?.field_mapping || {}).forEach((header) => {
    seen.add(header)
    headers.push(header)
  })

  ;(preview?.unmapped_headers || []).forEach((header) => {
    if (seen.has(header)) return
    seen.add(header)
    headers.push(header)
  })

  draftRows.forEach((row) => {
    Object.keys(row || {}).forEach((header) => {
      if (seen.has(header)) return
      seen.add(header)
      headers.push(header)
    })
  })

  return headers
}

function createCsvFile(headers, rows, sourceName) {
  const csv = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) =>
      headers.map((header) => escapeCsvCell(row?.[header] || '')).join(','),
    ),
  ].join('\n')

  return new File([csv], toCsvFileName(sourceName), { type: 'text/csv' })
}

function escapeCsvCell(value) {
  const text = String(value ?? '')
  if (!/[",\n\r]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}

function toCsvFileName(sourceName) {
  return sourceName.replace(/\.(xlsx?|csv)$/i, '') + '-edited.csv'
}
