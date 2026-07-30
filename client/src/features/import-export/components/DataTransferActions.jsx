import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, RefreshCw, RotateCcw, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { showErrorToast, showSuccessToast } from '../../../lib/toast.js'
import { loadEmployeeFormOptions } from '../../employees/api/employeeFormOptions.js'
import {
  employeeStatuses,
  employmentTypes,
  genderOptions,
  maritalStatuses,
  religionOptions,
} from '../../employees/api/employeesApi.js'
import { loadStudentFormOptions } from '../../students/api/studentFormOptions.js'
import { studentEntryTypes, studentStatuses } from '../../students/api/studentsApi.js'
import { dataTransferApi, downloadBlob } from '../api/dataTransferApi.js'

const entityLabels = {
  students: 'students',
  employees: 'employees',
}

const defaultPreviewFields = {
  employees: [
    'employee_id',
    'full_name',
    'nick_name',
    'email',
    'gender',
    'religion',
    'birth_place',
    'birth_date',
    'unit',
    'job_position',
    'job_level',
    'building',
    'join_date',
    'employment_type',
    'marital_status',
    'status',
  ],
  students: [
    'full_name',
    'nick_name',
    'email',
    'gender',
    'religion',
    'birth_place',
    'birth_date',
    'nisn',
    'entry_type',
    'current_grade',
    'join_academic_year',
    'status',
    'father_name',
    'father_phone',
    'mother_name',
    'mother_phone',
    'blood_type',
  ],
}

const importFields = {
  employees: [
    { key: 'employee_id', label: 'Employee ID' },
    { key: 'full_name', label: 'Full Name' },
    { key: 'nick_name', label: 'Nick' },
    { key: 'email', label: 'Email' },
    { key: 'gender', label: 'Gender', options: genderOptions },
    { key: 'religion', label: 'Religion', options: religionOptions },
    { key: 'birth_place', label: 'Birth Place' },
    { key: 'birth_date', label: 'Birth Date', type: 'date' },
    { key: 'unit', label: 'Unit', optionSource: 'units' },
    { key: 'job_position', label: 'Job Position', optionSource: 'jobPositions' },
    { key: 'job_level', label: 'Job Level', optionSource: 'jobLevels' },
    { key: 'building', label: 'Building', optionSource: 'buildings' },
    { key: 'join_date', label: 'Join Date', type: 'date' },
    { key: 'employment_type', label: 'Employment Type', options: employmentTypes },
    { key: 'marital_status', label: 'Marital Status', options: maritalStatuses },
    { key: 'status', label: 'Status', options: employeeStatuses },
    { key: 'resignation_date', label: 'Resignation Date', type: 'date' },
    { key: 'last_working_date', label: 'Last Working Date', type: 'date' },
    { key: 'notes', label: 'Notes' },
    { key: 'photo_url', label: 'Photo ID' },
    { key: 'mobile_phone', label: 'Mobile Phone' },
    { key: 'residential_address', label: 'Residential Address' },
    { key: 'nik', label: 'NIK' },
    { key: 'npwp', label: 'NPWP' },
    { key: 'bank_account_number', label: 'Bank Account Number' },
    { key: 'bpjs_number', label: 'BPJS Number' },
  ],
  students: [
    { key: 'full_name', label: 'Full Name' },
    { key: 'nick_name', label: 'Nick Name' },
    { key: 'email', label: 'Email' },
    { key: 'gender', label: 'Gender', options: genderOptions },
    { key: 'religion', label: 'Religion', options: religionOptions },
    { key: 'birth_place', label: 'Birth Place' },
    { key: 'birth_date', label: 'Birth Date', type: 'date' },
    { key: 'nis', label: 'NIS' },
    { key: 'nisn', label: 'NISN' },
    { key: 'entry_type', label: 'Entry Type', options: studentEntryTypes },
    { key: 'current_grade', label: 'Current Grade', optionSource: 'grades' },
    { key: 'join_academic_year', label: 'Join Academic Year', optionSource: 'academicYears' },
    { key: 'previous_school', label: 'Previous School' },
    { key: 'status', label: 'Status', options: studentStatuses },
    { key: 'photo_url', label: 'Photo ID' },
    { key: 'leave_year', label: 'Leave Year' },
    { key: 'sn', label: 'SN' },
    { key: 'join_grade', label: 'Join Grade', optionSource: 'grades' },
    { key: 'graduation_grade', label: 'Graduation Grade', optionSource: 'grades' },
    { key: 'pickup_drop_service', label: 'Pickup Drop Service', options: ['TRUE', 'FALSE'] },
    { key: 'catering_service', label: 'Catering Service', options: ['TRUE', 'FALSE'] },
    { key: 'psb_guide', label: 'PSB Guide', options: ['TRUE', 'FALSE'] },
    { key: 'father_name', label: 'Father' },
    { key: 'father_phone', label: "Father's Phone" },
    { key: 'father_email', label: "Father's Email" },
    { key: 'mother_name', label: 'Mother' },
    { key: 'mother_phone', label: "Mother's Phone" },
    { key: 'mother_email', label: "Mother's Email" },
    { key: 'parent_address', label: 'Address' },
    { key: 'health_info', label: 'Health Information' },
    { key: 'special_needs', label: 'Special Needs' },
    { key: 'blood_type', label: 'Blood Type', options: ['A', 'B', 'AB', 'O'] },
    { key: 'media_consent_sign', label: 'Media Consent Sign' },
    { key: 'media_consent_yes', label: 'Media Consent YES', options: ['YES', 'NO'] },
    { key: 'parent_consent_sign', label: 'Parent Consent Sign' },
    { key: 'pc_monday', label: 'PC Monday' },
    { key: 'pc_tuesday', label: 'PC Tuesday' },
    { key: 'pc_wednesday', label: 'PC Wednesday' },
    { key: 'pc_thursday', label: 'PC Thursday' },
  ],
}

export function DataTransferActions({
  entity,
  exportParams,
  canImport,
  canExport = true,
}) {
  const [isImportOpen, setIsImportOpen] = useState(false)

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
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
  const [selectedSheetName, setSelectedSheetName] = useState('')

  const previewMutation = useMutation({
    mutationFn: ({ nextFile, sheetName, mapping } = {}) =>
      dataTransferApi.preview(entity, nextFile || file, { sheetName, mapping }),
    onSuccess: (data) => {
      setPreview(data)
      setDraftRows(buildDraftRows(data))
      setIsDirty(false)
      setSelectedSheetName(data.sheet_name || '')
      showSuccessToast('Import preview is ready.')
    },
    onError: (error) => showErrorToast(error, 'Import preview failed.'),
  })

  const commitMutation = useMutation({
    mutationFn: () => dataTransferApi.commit(entity, preview.job_id),
    onSuccess: (data) => {
      setPreview((current) => ({
        ...data,
        source_headers: current?.source_headers || data.source_headers,
      }))
      setDraftRows(buildDraftRows({
        ...data,
        source_headers: preview?.source_headers || data.source_headers,
      }))
      setIsDirty(false)
      queryClient.invalidateQueries({ queryKey: [entity] })
      showSuccessToast('Import committed.')
    },
    onError: (error) => showErrorToast(error, 'Import commit failed.'),
  })

  const rollbackMutation = useMutation({
    mutationFn: () => dataTransferApi.rollback(entity, preview.job_id),
    onSuccess: (data) => {
      setPreview((current) => ({
        ...data,
        source_headers: current?.source_headers || data.source_headers,
      }))
      setDraftRows(buildDraftRows({
        ...data,
        source_headers: preview?.source_headers || data.source_headers,
      }))
      setIsDirty(false)
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
    return getEditableFields(entity, preview, draftRows)
  }, [draftRows, entity, preview])
  const optionDataQuery = useQuery({
    queryKey: [entity === 'employees' ? 'employee-form-options' : 'student-form-options'],
    queryFn: entity === 'employees' ? loadEmployeeFormOptions : loadStudentFormOptions,
    enabled: Boolean(preview),
  })
  const sheetOptions = useMemo(() => {
    return getSheetOptions(preview)
  }, [preview])
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
    setSelectedSheetName('')
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
    previewMutation.mutate({
      nextFile: editedFile,
      mapping: Object.fromEntries(
        editableColumns
          .filter((field) => field.targetKey && !field.targetKey.startsWith('__'))
          .map((field) => [field.label, field.targetKey]),
      ),
    })
  }

  function previewSelectedSheet(sheetName = selectedSheetName) {
    previewMutation.mutate({ sheetName })
  }

  return (
    <CrudDialog
      title={`Import ${entityLabels[entity]}`}
      description="Upload CSV or Excel, edit invalid cells in preview, revalidate, then commit."
      onClose={onClose}
      panelClassName="max-w-[min(96rem,calc(100vw-2rem))]"
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
      <div className="min-w-0 space-y-5">
        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="min-w-0 space-y-1.5">
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
            onClick={() => previewSelectedSheet()}
          >
            <Upload size={16} />
            {previewMutation.isPending ? 'Previewing' : 'Preview'}
          </Button>
        </div>

        {preview ? (
          <div className="min-w-0 space-y-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <StatusBadge tone={preview.status === 'PENDING' ? 'amber' : 'green'}>
                {preview.status}
              </StatusBadge>
              {preview.sheet_name ? (
                <StatusBadge tone="neutral">Sheet: {preview.sheet_name}</StatusBadge>
              ) : null}
              {isDirty ? (
                <StatusBadge tone="amber">Needs revalidation</StatusBadge>
              ) : null}
              <span className="break-all text-sm text-[var(--mws-muted)]">
                Job {preview.job_id || preview.id}
              </span>
            </div>

            {sheetOptions.length > 1 ? (
              <div className="grid min-w-0 gap-3 rounded-2xl border border-[var(--mws-line)] bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="min-w-0 space-y-1.5">
                  <span className="block font-display text-xs font-bold text-[var(--mws-muted)]">
                    Workbook Sheet
                  </span>
                  <select
                    value={selectedSheetName}
                    onChange={(event) => setSelectedSheetName(event.target.value)}
                    className="h-11 w-full rounded-xl border border-[var(--mws-line)] bg-white px-3 text-sm text-[var(--mws-charcoal)] outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A]"
                  >
                    {sheetOptions.map((sheet) => (
                      <option key={sheet} value={sheet}>
                        {sheet}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={
                    !file ||
                    !selectedSheetName ||
                    selectedSheetName === preview.sheet_name ||
                    previewMutation.isPending
                  }
                  onClick={() => previewSelectedSheet(selectedSheetName)}
                >
                  <RefreshCw size={16} />
                  Preview Sheet
                </Button>
              </div>
            ) : null}

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

            <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)]">
              <div className="border-b border-[var(--mws-line)] bg-[var(--mws-soft)] px-4 py-3">
                <h3 className="font-display text-sm font-bold text-[var(--mws-charcoal)]">
                  Editable Preview
                </h3>
              </div>
              <div className="max-h-[min(520px,calc(100svh-24rem))] min-w-0 overflow-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-white font-display text-xs font-bold text-[var(--mws-muted)]">
                    <tr>
                      <th className="sticky left-0 top-0 z-20 w-20 bg-white px-4 py-3">
                        Row
                      </th>
                      <th className="sticky top-0 z-10 w-28 bg-white px-4 py-3">
                        Action
                      </th>
                      {editableColumns.map((field) => (
                        <th
                          key={field.key}
                          className="sticky top-0 z-10 min-w-44 bg-white px-3 py-3"
                        >
                          {field.label}
                        </th>
                      ))}
                      <th className="sticky right-0 top-0 z-20 min-w-72 bg-white px-4 py-3">
                        Validation
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, rowIndex) => {
                      const errorFields = getErrorFields(row)
                      const hasRowError = row.errors?.length > 0

                      return (
                      <tr
                        key={row.row_number}
                        className={[
                          'border-t border-[var(--mws-line)]',
                          hasRowError ? 'bg-[#fff8f8]' : 'bg-white',
                        ].join(' ')}
                      >
                        <td className="sticky left-0 z-10 bg-inherit px-4 py-3 font-semibold">
                          {row.row_number}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge tone={row.action === 'CREATE' ? 'green' : 'amber'}>
                            {row.action || 'Skipped'}
                          </StatusBadge>
                        </td>
                        {editableColumns.map((field) => (
                          <td key={field.key} className="px-2 py-2">
                            <EditableImportCell
                              field={field}
                              value={draftRows[rowIndex]?.[field.key] || ''}
                              options={optionDataQuery.data}
                              hasError={errorFields.has(field.targetKey || field.key)}
                              onChange={(value) => updateCell(rowIndex, field.key, value)}
                            />
                          </td>
                        ))}
                        <td className="sticky right-0 z-10 bg-inherit px-4 py-3">
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
                      )
                    })}
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

function EditableImportCell({ field, value, options, hasError, onChange }) {
  const choices = getFieldOptions(field, options)
  const inputClassName = [
    'h-9 w-full rounded-lg border bg-white px-2 text-sm text-[var(--mws-charcoal)] outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A]',
    hasError
      ? 'border-[#c75f64] bg-[#fff5f5] text-[#7b2024]'
      : 'border-[var(--mws-line)]',
  ].join(' ')

  if (choices.length > 0) {
    // CHANGED: value coming from the uploaded file (e.g. a boolean cell
    // stringified as "false") doesn't always match a choice's exact case
    // (options list has "FALSE"), so the select fell back to the empty
    // "Select" placeholder instead of showing the real value. Match
    // case-insensitively so it shows the right option.
    // value={value}
    const matchedChoice = choices.find(
      (choice) => choice.toLowerCase() === String(value).toLowerCase(),
    )
    return (
      <select
        value={matchedChoice ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className={inputClassName}
      >
        <option value="">Select</option>
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    )
  }

  return (
    <input
      type={field.type || 'text'}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={inputClassName}
    />
  )
}

function getFieldOptions(field, options) {
  if (field.options) return field.options
  if (!field.optionSource) return []

  return (options?.[field.optionSource] || []).map((option) => option.name)
}

function getErrorFields(row) {
  const fields = new Set()
  const errors = row.errors || []

  errors.forEach((error) => {
    const text = error.toLowerCase()

    if (text.includes('employee id')) fields.add('employee_id')
    if (text.includes('nis')) fields.add('nis')
    if (text.includes('entry type')) fields.add('entry_type')
    if (text.includes('email')) fields.add('email')
    if (text.includes('unit')) fields.add('unit')
    if (text.includes('job position')) fields.add('job_position')
    if (text.includes('job level')) fields.add('job_level')
    if (text.includes('building')) fields.add('building')
    if (text.includes('academic year')) fields.add('join_academic_year')
    if (text.includes('grade')) {
      fields.add('current_grade')
      fields.add('join_grade')
    }
    if (text.includes('birth place')) fields.add('birth_place')
    if (text.includes('birth date') || text.includes('date')) {
      fields.add('birth_date')
      fields.add('join_date')
    }
    if (text.includes('gender')) fields.add('gender')
    if (text.includes('religion')) fields.add('religion')
    if (text.includes('status')) fields.add('status')
    if (text.includes('required')) {
      fields.add('full_name')
      fields.add('nick_name')
      fields.add('email')
    }
  })

  return fields
}

function buildDraftRows(preview) {
  if (preview.source_headers?.length) {
    return (preview.rows || []).map((row) => {
      const source = row.source_raw || {}
      return Object.fromEntries(
        preview.source_headers.map((header) => [header, source[header] || '']),
      )
    })
  }

  const sourceByField = getSourceByField(preview)

  return (preview.rows || []).map((row) => {
    const draft = {}
    importFields[preview.type?.toLowerCase() === 'employee' ? 'employees' : 'students']
      .forEach((field) => {
        const source = sourceByField[field.key]
        draft[field.key] = source
          ? row.raw?.[source] || ''
          : findRawFieldValue(row.raw, field)
      })

    return draft
  })
}

function findRawFieldValue(raw, field) {
  const entries = Object.entries(raw || {})
  const targets = new Set([
    normalizeHeader(field.key),
    normalizeHeader(field.label),
  ])
  const match = entries.find(([header]) => targets.has(normalizeHeader(header)))
  return match?.[1] || ''
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function getEditableFields(entity, preview, draftRows) {
  const fieldMap = new Map(importFields[entity].map((field) => [field.key, field]))

  if (preview?.source_headers?.length) {
    return preview.source_headers.map((header) => {
      const targetKey = preview.field_mapping?.[header]
      const field = fieldMap.get(targetKey)
      return {
        ...(field || {}),
        key: header,
        label: header,
        targetKey,
      }
    })
  }

  const fieldKeys = []
  const seen = new Set()

  defaultPreviewFields[entity].forEach((fieldKey) => {
    seen.add(fieldKey)
    fieldKeys.push(fieldKey)
  })

  Object.values(preview?.field_mapping || {}).forEach((fieldKey) => {
    if (seen.has(fieldKey)) return
    seen.add(fieldKey)
    fieldKeys.push(fieldKey)
  })

  draftRows.forEach((row) => {
    Object.keys(row || {}).forEach((fieldKey) => {
      if (seen.has(fieldKey)) return
      seen.add(fieldKey)
      fieldKeys.push(fieldKey)
    })
  })

  return fieldKeys.map((fieldKey) => (
    fieldMap.get(fieldKey) || { key: fieldKey, label: fieldKey }
  ))
}

function getSourceByField(preview) {
  const sourceByField = {}

  Object.entries(preview?.field_mapping || {}).forEach(([source, field]) => {
    if (sourceByField[field]) return
    sourceByField[field] = source
  })

  return sourceByField
}

function getSheetOptions(preview) {
  const names = []
  const seen = new Set()

  ;[preview?.sheet_name, ...(preview?.other_sheets || [])].forEach((name) => {
    if (!name || seen.has(name)) return
    seen.add(name)
    names.push(name)
  })

  return names
}

function createCsvFile(fields, rows, sourceName) {
  const csv = [
    fields.map((field) => escapeCsvCell(field.label)).join(','),
    ...rows.map((row) =>
      fields.map((field) => escapeCsvCell(row?.[field.key] || '')).join(','),
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
