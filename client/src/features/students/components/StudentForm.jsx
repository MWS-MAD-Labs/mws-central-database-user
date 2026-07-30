import { useState } from 'react'
import { Save } from 'lucide-react'
import { Button } from '../../../components/ui/Button.jsx'
import {
  CheckboxField,
  Field,
  SearchableSelect,
  SelectInput,
  TextInput,
} from '../../../components/ui/FormControls.jsx'
import {
  cleanPayload,
  dateInputFromIso,
  isoFromDateInput,
  trimmedOrUndefined,
} from '../../../lib/form.js'
import { formatStatus } from '../../../lib/format.js'
import {
  genderOptions,
  religionOptions,
  studentEntryTypes,
  studentStatuses,
} from '../api/studentsApi.js'

const emptyOptions = {
  grades: [],
  academicYears: [],
}

export function StudentForm({
  mode,
  student,
  options = emptyOptions,
  isSubmitting,
  onSubmit,
}) {
  const [values, setValues] = useState(() =>
    getInitialValues(mode, student, options),
  )

  const isCreate = mode === 'create'

  function updateValue(field, value) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  function updateCheckbox(field, checked) {
    setValues((current) => ({ ...current, [field]: checked }))
  }

  function handleSubmit(event) {
    event.preventDefault()
    onSubmit(buildPayload(values, isCreate))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <section className="rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
          Identity
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Full name">
            <TextInput
              required={isCreate}
              value={values.full_name}
              onChange={(event) => updateValue('full_name', event.target.value)}
            />
          </Field>
          <Field label="Nick name">
            <TextInput
              required={isCreate}
              value={values.nick_name}
              onChange={(event) => updateValue('nick_name', event.target.value)}
            />
          </Field>
          <Field label="Email">
            <TextInput
              required={isCreate}
              type="email"
              value={values.email}
              onChange={(event) => updateValue('email', event.target.value)}
            />
          </Field>
          <Field label="Photo URL">
            <TextInput
              type="url"
              value={values.photo_url}
              onChange={(event) => updateValue('photo_url', event.target.value)}
            />
          </Field>
          <Field label="Gender">
            <SelectInput
              required={isCreate}
              value={values.gender}
              onChange={(event) => updateValue('gender', event.target.value)}
            >
              <option value="">Select gender</option>
              {genderOptions.map((option) => (
                <option key={option} value={option}>
                  {formatStatus(option)}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Religion">
            <SelectInput
              required={isCreate}
              value={values.religion}
              onChange={(event) => updateValue('religion', event.target.value)}
            >
              <option value="">Select religion</option>
              {religionOptions.map((option) => (
                <option key={option} value={option}>
                  {formatStatus(option)}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Birth place">
            <TextInput
              required={isCreate}
              value={values.birth_place}
              onChange={(event) =>
                updateValue('birth_place', event.target.value)
              }
            />
          </Field>
          <Field label="Birth date">
            <TextInput
              required={isCreate}
              type="date"
              value={values.birth_date}
              onChange={(event) => updateValue('birth_date', event.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
          Academic Record
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {isCreate ? (
            <Field
              label="NIS"
              hint="Generated after save from academic year, join grade, and entry type."
            >
              <div className="flex h-11 items-center rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] px-3 text-sm font-semibold text-[var(--mws-muted)]">
                Auto-generated
              </div>
            </Field>
          ) : (
            <Field label="NIS" hint="Managed by backend and locked after creation.">
              <TextInput value={values.nis || '-'} disabled />
            </Field>
          )}
          <Field label="NISN" hint="Optional, 10 digits">
            <TextInput
              value={values.nisn}
              onChange={(event) => updateValue('nisn', event.target.value)}
            />
          </Field>
          {isCreate ? (
            <Field label="Entry type">
              <SelectInput
                required
                value={values.entry_type}
                onChange={(event) => updateValue('entry_type', event.target.value)}
              >
                {studentEntryTypes.map((option) => (
                  <option key={option} value={option}>
                    {formatStatus(option)}
                  </option>
                ))}
              </SelectInput>
            </Field>
          ) : null}
          <Field label="Status">
            <SelectInput
              value={values.status}
              disabled={isCreate}
              onChange={(event) => updateValue('status', event.target.value)}
            >
              {isCreate ? null : <option value="">Backend default</option>}
              {studentStatuses.map((option) => (
                <option key={option} value={option}>
                  {formatStatus(option)}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Current grade">
            <SearchableSelect
              required={isCreate}
              value={values.current_grade_id}
              onChange={(value) => updateValue('current_grade_id', value)}
              options={gradeOptions(options.grades)}
              placeholder="Select current grade"
              searchPlaceholder="Search grades"
            />
          </Field>
          <Field label="Join academic year">
            <SearchableSelect
              required={isCreate}
              value={values.join_academic_year_id}
              onChange={(value) => updateValue('join_academic_year_id', value)}
              options={academicYearOptions(options.academicYears)}
              placeholder="Select join year"
              searchPlaceholder="Search years"
            />
          </Field>
          <Field label="Join grade">
            <SearchableSelect
              required={isCreate}
              value={values.join_grade_id}
              onChange={(value) => updateValue('join_grade_id', value)}
              options={gradeOptions(options.grades)}
              placeholder="Select join grade"
              searchPlaceholder="Search grades"
            />
          </Field>
          <Field label="Previous school" className="md:col-span-2">
            <TextInput
              value={values.previous_school}
              onChange={(event) =>
                updateValue('previous_school', event.target.value)
              }
            />
          </Field>
          {!isCreate ? (
            <>
              <Field label="Graduation grade">
                <TextInput
                  value={values.graduation_grade}
                  onChange={(event) =>
                    updateValue('graduation_grade', event.target.value)
                  }
                />
              </Field>
              <Field label="Leave year">
                <TextInput
                  value={values.leave_year}
                  onChange={(event) =>
                    updateValue('leave_year', event.target.value)
                  }
                />
              </Field>
              <Field label="SN">
                <TextInput
                  value={values.sn}
                  onChange={(event) => updateValue('sn', event.target.value)}
                />
              </Field>
            </>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
          Services
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          <CheckboxField
            label="Pickup/drop"
            checked={values.pickup_drop_service}
            onChange={(event) =>
              updateCheckbox('pickup_drop_service', event.target.checked)
            }
          />
          <CheckboxField
            label="Catering"
            checked={values.catering_service}
            onChange={(event) =>
              updateCheckbox('catering_service', event.target.checked)
            }
          />
          <CheckboxField
            label="PSB guide"
            checked={values.psb_guide}
            onChange={(event) =>
              updateCheckbox('psb_guide', event.target.checked)
            }
          />
        </div>
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          <Save size={16} />
          {isSubmitting ? 'Saving...' : isCreate ? 'Create student' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}

function getInitialValues(mode, student, options) {
  const identity = student?.identity || {}
  const academic = student?.academic || {}

  return {
    full_name: identity.full_name || '',
    nick_name: identity.nick_name || '',
    email: identity.email || '',
    gender: identity.gender || '',
    religion: identity.religion || '',
    birth_place: identity.birth_place || '',
    birth_date: dateInputFromIso(identity.birth_date),
    photo_url: identity.photo_url || '',
    nis: academic.nis || '',
    nisn: academic.nisn || '',
    entry_type: academic.entry_type || 'PSB',
    status: student?.status || (mode === 'create' ? 'REGISTERED' : ''),
    current_grade_id:
      findOptionByName(options.grades, academic.current_grade)?.id || '',
    join_academic_year_id: academic.join_academic_year_id || '',
    join_grade_id:
      findOptionByName(options.grades, academic.join_grade)?.id || '',
    previous_school: academic.previous_school || '',
    graduation_grade: academic.graduation_grade || '',
    leave_year: academic.leave_year || '',
    sn: academic.sn || '',
    pickup_drop_service: Boolean(academic.pickup_drop_service),
    catering_service: Boolean(academic.catering_service),
    psb_guide: Boolean(academic.psb_guide),
  }
}

function buildPayload(values, isCreate) {
  return cleanPayload({
    full_name: trimmedOrUndefined(values.full_name),
    nick_name: trimmedOrUndefined(values.nick_name),
    email: trimmedOrUndefined(values.email),
    gender: values.gender,
    religion: values.religion,
    birth_place: trimmedOrUndefined(values.birth_place),
    birth_date: isoFromDateInput(values.birth_date),
    photo_url: trimmedOrUndefined(values.photo_url),
    nisn: trimmedOrUndefined(values.nisn),
    entry_type: isCreate ? values.entry_type : undefined,
    status: values.status,
    current_grade_id: values.current_grade_id,
    join_academic_year_id: values.join_academic_year_id,
    join_grade_id: values.join_grade_id,
    previous_school: trimmedOrUndefined(values.previous_school),
    graduation_grade: trimmedOrUndefined(values.graduation_grade),
    leave_year: trimmedOrUndefined(values.leave_year),
    sn: trimmedOrUndefined(values.sn),
    pickup_drop_service: values.pickup_drop_service,
    catering_service: values.catering_service,
    psb_guide: values.psb_guide,
  })
}

function findOptionByName(options, name) {
  if (!name) return null
  return options.find((option) => option.name === name) || null
}

function gradeOptions(grades) {
  return grades.map((grade) => ({
    value: grade.id,
    label: grade.name,
    searchText: `${grade.name} ${grade.level ?? ''}`,
  }))
}

function academicYearOptions(years) {
  return years.map((year) => ({
    value: year.id,
    label: year.name,
    badge: formatStatus(year.status),
    tone: year.status === 'ACTIVE' ? 'green' : year.status === 'UPCOMING' ? 'amber' : 'neutral',
    searchText: `${year.name} ${formatStatus(year.status)}`,
  }))
}
