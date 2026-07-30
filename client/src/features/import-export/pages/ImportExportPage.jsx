import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  RefreshCw,
  ShieldAlert,
  Upload,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import {
  CheckboxField,
  Field,
  SelectInput,
  TextInput,
} from '../../../components/ui/FormControls.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { cn } from '../../../lib/cn.js'
import { formatStatus } from '../../../lib/format.js'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { employeeStatuses } from '../../employees/api/employeesApi.js'
import { loadEmployeeFormOptions } from '../../employees/api/employeeFormOptions.js'
import { studentStatuses } from '../../students/api/studentsApi.js'
import { loadStudentFormOptions } from '../../students/api/studentFormOptions.js'

const tabs = [
  { id: 'import', label: 'Import', icon: Upload },
  { id: 'export', label: 'Export', icon: Download },
  { id: 'sync', label: 'Sheet Sync', icon: RefreshCw },
]

const importMappings = [
  { source: 'Full Name', student: 'full_name', employee: 'full_name' },
  { source: 'Nick Name', student: 'nick_name', employee: 'nick_name' },
  { source: 'Student MWS Email', student: 'email', employee: 'email' },
  { source: 'Current grade (If Active)', student: 'current_grade', employee: '' },
  { source: 'Employee ID', student: '', employee: 'employee_id' },
  { source: 'Unit', student: '', employee: 'unit' },
]

const targetFields = {
  students: [
    'full_name',
    'nick_name',
    'email',
    'nisn',
    'entry_type',
    'status',
    'current_grade',
    'current_class',
    'join_academic_year',
    'birth_place',
    'birth_date',
  ],
  employees: [
    'full_name',
    'nick_name',
    'email',
    'employee_id',
    'status',
    'unit',
    'job_position',
    'job_level',
    'building',
    'join_date',
  ],
}

const validationRows = [
  { label: 'Valid rows', value: '-', tone: 'green' },
  { label: 'Rows with errors', value: '-', tone: 'red' },
  { label: 'Possible duplicates', value: '-', tone: 'amber' },
  { label: 'Conflicts', value: '-', tone: 'amber' },
]

export function ImportExportPage() {
  const [activeTab, setActiveTab] = useState('import')

  return (
    <div>
      <PageHeader
        title="Import / Export"
        description="Prepare data migration, export files, and Google Sheet transition checks."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'inline-flex h-10 items-center gap-2 rounded-full border px-4 font-display text-sm font-semibold transition',
                activeTab === tab.id
                  ? 'border-[var(--mws-burgundy)] bg-[var(--mws-burgundy)] text-white'
                  : 'border-[var(--mws-line)] bg-white text-[var(--mws-muted)] hover:bg-[var(--mws-soft)] hover:text-[var(--mws-charcoal)]',
              )}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'import' ? <ImportPanel /> : null}
      {activeTab === 'export' ? <ExportPanel /> : null}
      {activeTab === 'sync' ? <SyncPanel /> : null}
    </div>
  )
}

function ImportPanel() {
  const [values, setValues] = useState({
    dataset: 'students',
    source: 'csv',
    strategy: 'preview',
    sheet_url: '',
    file_name: '',
  })

  const mappings = importMappings.map((row) => ({
    ...row,
    target: row[values.dataset],
  }))

  return (
    <PanelFrame
      title="Import Preview"
      icon={Upload}
      badge="Backend pending"
      footer={
        <>
          <Button type="button" variant="secondary" disabled>
            Save Mapping
          </Button>
          <Button type="button" disabled>
            <Upload size={16} />
            Upload & Preview
          </Button>
        </>
      }
    >
      <PendingNotice />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <Field label="Dataset">
            <SelectInput
              value={values.dataset}
              onChange={(event) =>
                setValues((current) => ({ ...current, dataset: event.target.value }))
              }
            >
              <option value="students">Students</option>
              <option value="employees">Employees</option>
            </SelectInput>
          </Field>

          <Field label="Source Format">
            <SelectInput
              value={values.source}
              onChange={(event) =>
                setValues((current) => ({ ...current, source: event.target.value }))
              }
            >
              <option value="csv">CSV</option>
              <option value="xlsx">Excel</option>
              <option value="google_sheet_export">Google Sheet export</option>
            </SelectInput>
          </Field>

          <Field label="Import Strategy">
            <SelectInput
              value={values.strategy}
              onChange={(event) =>
                setValues((current) => ({ ...current, strategy: event.target.value }))
              }
            >
              <option value="preview">Preview only</option>
              <option value="create_update">Create new and update matches</option>
              <option value="create_only">Create new only</option>
              <option value="update_only">Update existing only</option>
            </SelectInput>
          </Field>

          <Field label="File">
            <input
              type="file"
              accept=".csv,.xls,.xlsx"
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  file_name: event.target.files?.[0]?.name || '',
                }))
              }
              className="block h-11 w-full rounded-xl border border-[var(--mws-line)] bg-white px-3 py-2 text-sm text-[var(--mws-charcoal)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--mws-soft)] file:px-3 file:py-1.5 file:font-display file:text-xs file:font-semibold file:text-[var(--mws-burgundy)] focus:outline-none"
            />
          </Field>

          <Field label="Google Sheet URL">
            <TextInput
              value={values.sheet_url}
              placeholder="https://docs.google.com/spreadsheets/..."
              disabled={values.source !== 'google_sheet_export'}
              onChange={(event) =>
                setValues((current) => ({ ...current, sheet_url: event.target.value }))
              }
            />
          </Field>
        </div>

        <div className="space-y-4">
          <SummaryGrid rows={validationRows} />

          <div className="overflow-hidden rounded-2xl border border-[var(--mws-line)]">
            <div className="border-b border-[var(--mws-line)] bg-[var(--mws-soft)] px-4 py-3">
              <h3 className="font-display text-sm font-bold text-[var(--mws-charcoal)]">
                Column Mapping
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="font-display text-xs font-bold text-[var(--mws-muted)]">
                  <tr>
                    <th className="px-4 py-3">Source Column</th>
                    <th className="px-4 py-3">Target Field</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((mapping) => (
                    <tr key={mapping.source} className="border-t border-[var(--mws-line)]">
                      <td className="px-4 py-3 font-medium text-[var(--mws-charcoal)]">
                        {mapping.source}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={mapping.target}
                          disabled
                          className="h-9 w-full rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] px-3 text-sm text-[var(--mws-charcoal)]"
                        >
                          <option value="">Ignore</option>
                          {targetFields[values.dataset].map((field) => (
                            <option key={field} value={field}>
                              {field}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={mapping.target ? 'green' : 'neutral'}>
                          {mapping.target ? 'Mapped' : 'Ignored'}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <PreviewTable fileName={values.file_name} dataset={values.dataset} />
    </PanelFrame>
  )
}

function ExportPanel() {
  const { user } = useAuth()
  const [values, setValues] = useState({
    dataset: 'students',
    format: 'csv',
    status: '',
    grade_id: '',
    class_id: '',
    academic_year_id: '',
    unit_id: '',
    job_position_id: '',
    building: '',
    include_sensitive: false,
  })

  const studentOptionsQuery = useQuery({
    queryKey: ['student-form-options'],
    queryFn: loadStudentFormOptions,
  })
  const employeeOptionsQuery = useQuery({
    queryKey: ['employee-form-options'],
    queryFn: loadEmployeeFormOptions,
  })

  const isStudents = values.dataset === 'students'
  const canExportSensitive = user?.role === 'SUPER_ADMIN'
  const statuses = isStudents ? studentStatuses : employeeStatuses
  const options = useMemo(
    () => ({
      grades: studentOptionsQuery.data?.grades || [],
      classes: studentOptionsQuery.data?.classes || [],
      academicYears: studentOptionsQuery.data?.academicYears || [],
      units: employeeOptionsQuery.data?.units || [],
      jobPositions: employeeOptionsQuery.data?.jobPositions || [],
    }),
    [employeeOptionsQuery.data, studentOptionsQuery.data],
  )

  function updateValue(key, value) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  return (
    <PanelFrame
      title="Export Builder"
      icon={Download}
      badge="Backend pending"
      footer={
        <Button type="button" disabled>
          <Download size={16} />
          Generate Export
        </Button>
      }
    >
      <PendingNotice />

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Dataset">
              <SelectInput
                value={values.dataset}
                onChange={(event) => updateValue('dataset', event.target.value)}
              >
                <option value="students">Students</option>
                <option value="employees">Employees</option>
              </SelectInput>
            </Field>

            <Field label="Format">
              <SelectInput
                value={values.format}
                onChange={(event) => updateValue('format', event.target.value)}
              >
                <option value="csv">CSV</option>
                <option value="xlsx">Excel</option>
              </SelectInput>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              <SelectInput
                value={values.status}
                onChange={(event) => updateValue('status', event.target.value)}
              >
                <option value="">All statuses</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {formatStatus(status)}
                  </option>
                ))}
              </SelectInput>
            </Field>

            {isStudents ? (
              <Field label="Grade">
                <SelectInput
                  value={values.grade_id}
                  onChange={(event) => updateValue('grade_id', event.target.value)}
                >
                  <option value="">All grades</option>
                  {options.grades.map((grade) => (
                    <option key={grade.id} value={grade.id}>
                      {grade.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            ) : (
              <Field label="Unit">
                <SelectInput
                  value={values.unit_id}
                  onChange={(event) => updateValue('unit_id', event.target.value)}
                >
                  <option value="">All units</option>
                  {options.units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            )}

            {isStudents ? (
              <Field label="Class">
                <SelectInput
                  value={values.class_id}
                  onChange={(event) => updateValue('class_id', event.target.value)}
                >
                  <option value="">All classes</option>
                  {options.classes.map((schoolClass) => (
                    <option key={schoolClass.id} value={schoolClass.id}>
                      {schoolClass.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            ) : (
              <Field label="Job Position">
                <SelectInput
                  value={values.job_position_id}
                  onChange={(event) =>
                    updateValue('job_position_id', event.target.value)
                  }
                >
                  <option value="">All positions</option>
                  {options.jobPositions.map((position) => (
                    <option key={position.id} value={position.id}>
                      {position.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            )}

            {isStudents ? (
              <Field label="Academic Year">
                <SelectInput
                  value={values.academic_year_id}
                  onChange={(event) =>
                    updateValue('academic_year_id', event.target.value)
                  }
                >
                  <option value="">All academic years</option>
                  {options.academicYears.map((year) => (
                    <option key={year.id} value={year.id}>
                      {year.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            ) : (
              <Field label="Building">
                <TextInput
                  value={values.building}
                  placeholder="Any building"
                  onChange={(event) => updateValue('building', event.target.value)}
                />
              </Field>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-4">
            <div className="mb-3 flex items-center gap-2">
              <ShieldAlert size={18} className="text-[var(--mws-burgundy)]" />
              <h3 className="font-display text-sm font-bold text-[var(--mws-charcoal)]">
                Sensitive Data
              </h3>
            </div>
            <CheckboxField
              checked={values.include_sensitive}
              disabled={!canExportSensitive}
              label="Include sensitive fields"
              description="Requires restricted role access and audit logging when backend export is enabled."
              onChange={(event) =>
                updateValue('include_sensitive', event.target.checked)
              }
            />
            {!canExportSensitive ? (
              <p className="mt-3 text-xs text-[var(--mws-muted)]">
                Current role cannot request sensitive export.
              </p>
            ) : null}
          </div>

          <SummaryGrid
            rows={[
              { label: 'Dataset', value: isStudents ? 'Students' : 'Employees', tone: 'neutral' },
              { label: 'Format', value: values.format.toUpperCase(), tone: 'neutral' },
              { label: 'Sensitive', value: values.include_sensitive ? 'Included' : 'Excluded', tone: values.include_sensitive ? 'amber' : 'green' },
              { label: 'Audit Log', value: values.include_sensitive ? 'Required' : 'Standard', tone: 'neutral' },
            ]}
          />
        </div>
      </div>
    </PanelFrame>
  )
}

function SyncPanel() {
  const [values, setValues] = useState({
    dataset: 'students',
    direction: 'sheet_to_database',
    mode: 'compare_only',
    sheet_url: '',
  })

  return (
    <PanelFrame
      title="Google Sheet Transition Sync"
      icon={RefreshCw}
      badge="Backend pending"
      footer={
        <>
          <Button type="button" variant="secondary" disabled>
            Compare
          </Button>
          <Button type="button" disabled>
            <RefreshCw size={16} />
            Start Sync
          </Button>
        </>
      }
    >
      <PendingNotice />

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <Field label="Dataset">
            <SelectInput
              value={values.dataset}
              onChange={(event) =>
                setValues((current) => ({ ...current, dataset: event.target.value }))
              }
            >
              <option value="students">Students</option>
              <option value="employees">Employees</option>
            </SelectInput>
          </Field>

          <Field label="Google Sheet URL">
            <TextInput
              value={values.sheet_url}
              placeholder="https://docs.google.com/spreadsheets/..."
              onChange={(event) =>
                setValues((current) => ({ ...current, sheet_url: event.target.value }))
              }
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Direction">
              <SelectInput
                value={values.direction}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    direction: event.target.value,
                  }))
                }
              >
                <option value="sheet_to_database">Sheet to database</option>
                <option value="database_to_sheet">Database to sheet</option>
                <option value="two_way">Two-way sync</option>
              </SelectInput>
            </Field>

            <Field label="Mode">
              <SelectInput
                value={values.mode}
                onChange={(event) =>
                  setValues((current) => ({ ...current, mode: event.target.value }))
                }
              >
                <option value="compare_only">Compare only</option>
                <option value="preview_changes">Preview changes</option>
                <option value="sync_after_approval">Sync after approval</option>
              </SelectInput>
            </Field>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--mws-line)]">
          <div className="border-b border-[var(--mws-line)] bg-[var(--mws-soft)] px-4 py-3">
            <h3 className="font-display text-sm font-bold text-[var(--mws-charcoal)]">
              Sync Log
            </h3>
          </div>
          <div className="p-4">
            <PanelMessage>
              No sync jobs yet. Logs and conflicts will appear here when the
              backend sync endpoint is available.
            </PanelMessage>
          </div>
        </div>
      </div>
    </PanelFrame>
  )
}

function PanelFrame({ title, icon: Icon, badge, footer, children }) {
  return (
    <section className="rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="flex flex-col gap-3 border-b border-[var(--mws-line)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
            <Icon size={18} />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-[var(--mws-charcoal)]">
              {title}
            </h2>
            <StatusBadge tone="amber">{badge}</StatusBadge>
          </div>
        </div>
        <StatusBadge tone="neutral">Phase 2</StatusBadge>
      </div>
      <div className="space-y-5 p-4">{children}</div>
      {footer ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--mws-line)] p-4">
          {footer}
        </div>
      ) : null}
    </section>
  )
}

function PendingNotice() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-[#f3d99f] bg-[#fffaf0] p-4 text-sm text-[#8a6419]">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <p>
        Backend endpoint belum tersedia. Form dan review state sudah disiapkan,
        final action akan diaktifkan setelah contract API selesai.
      </p>
    </div>
  )
}

function SummaryGrid({ rows }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div
          key={row.label}
          className="rounded-2xl border border-[var(--mws-line)] bg-white p-4"
        >
          <p className="text-xs font-semibold text-[var(--mws-muted)]">{row.label}</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="font-display text-lg font-bold text-[var(--mws-charcoal)]">
              {row.value}
            </p>
            <StatusBadge tone={row.tone}>{row.tone === 'green' ? 'OK' : row.tone}</StatusBadge>
          </div>
        </div>
      ))}
    </div>
  )
}

function PreviewTable({ fileName, dataset }) {
  const rows = [
    {
      state: 'New',
      name: dataset === 'students' ? 'Student preview row' : 'Employee preview row',
      issue: fileName ? 'Waiting for backend validation' : 'No file selected',
    },
    {
      state: 'Update',
      name: dataset === 'students' ? 'Existing student match' : 'Existing employee match',
      issue: 'Preview pending',
    },
    {
      state: 'Blocked',
      name: 'Invalid sample',
      issue: 'Validation pending',
    },
  ]

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--mws-line)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--mws-line)] bg-[var(--mws-soft)] px-4 py-3">
        <h3 className="font-display text-sm font-bold text-[var(--mws-charcoal)]">
          Import Preview
        </h3>
        <StatusBadge tone="neutral">
          {fileName || 'No file selected'}
        </StatusBadge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="font-display text-xs font-bold text-[var(--mws-muted)]">
            <tr>
              <th className="px-4 py-3">Result</th>
              <th className="px-4 py-3">Record</th>
              <th className="px-4 py-3">Validation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.state} className="border-t border-[var(--mws-line)]">
                <td className="px-4 py-3">
                  <StatusBadge tone={previewTone(row.state)}>{row.state}</StatusBadge>
                </td>
                <td className="px-4 py-3 font-medium text-[var(--mws-charcoal)]">
                  {row.name}
                </td>
                <td className="px-4 py-3 text-[var(--mws-muted)]">
                  {row.state === 'New' ? (
                    <span className="inline-flex items-center gap-2">
                      <CheckCircle2 size={15} />
                      {row.issue}
                    </span>
                  ) : (
                    row.issue
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function previewTone(state) {
  switch (state) {
    case 'New':
      return 'green'
    case 'Update':
      return 'amber'
    case 'Blocked':
      return 'red'
    default:
      return 'neutral'
  }
}
