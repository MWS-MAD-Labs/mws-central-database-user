import { useState } from 'react'
import { Save } from 'lucide-react'
import { Button } from '../../../components/ui/Button.jsx'
import {
  CheckboxField,
  Field,
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
  error,
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
    onSubmit(buildPayload(values))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error ? (
        <div className="rounded-md border border-[#e8c7c2] bg-[#fff4f2] px-4 py-3 text-sm text-[#8f2f2f]">
          {error.message || 'Failed to save student.'}
        </div>
      ) : null}

      <section className="rounded-md border border-[#deded7] bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-[#202326]">
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

      <section className="rounded-md border border-[#deded7] bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-[#202326]">
          Academic Record
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="NIS" hint="7 digits">
            <TextInput
              required={isCreate}
              value={values.nis}
              onChange={(event) => updateValue('nis', event.target.value)}
            />
          </Field>
          <Field label="NISN" hint="Optional, 10 digits">
            <TextInput
              value={values.nisn}
              onChange={(event) => updateValue('nisn', event.target.value)}
            />
          </Field>
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
            <SelectInput
              required={isCreate}
              value={values.current_grade_id}
              onChange={(event) =>
                updateValue('current_grade_id', event.target.value)
              }
            >
              <option value="">Select current grade</option>
              {options.grades.map((grade) => (
                <option key={grade.id} value={grade.id}>
                  {grade.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Join academic year">
            <SelectInput
              required={isCreate}
              value={values.join_academic_year_id}
              onChange={(event) =>
                updateValue('join_academic_year_id', event.target.value)
              }
            >
              <option value="">Select join year</option>
              {options.academicYears.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name} ({formatStatus(year.status)})
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Join grade">
            <SelectInput
              required={isCreate}
              value={values.join_grade_id}
              onChange={(event) =>
                updateValue('join_grade_id', event.target.value)
              }
            >
              <option value="">Select join grade</option>
              {options.grades.map((grade) => (
                <option key={grade.id} value={grade.id}>
                  {grade.name}
                </option>
              ))}
            </SelectInput>
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

      <section className="rounded-md border border-[#deded7] bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-[#202326]">
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

function buildPayload(values) {
  return cleanPayload({
    full_name: trimmedOrUndefined(values.full_name),
    nick_name: trimmedOrUndefined(values.nick_name),
    email: trimmedOrUndefined(values.email),
    gender: values.gender,
    religion: values.religion,
    birth_place: trimmedOrUndefined(values.birth_place),
    birth_date: isoFromDateInput(values.birth_date),
    photo_url: trimmedOrUndefined(values.photo_url),
    nis: trimmedOrUndefined(values.nis),
    nisn: trimmedOrUndefined(values.nisn),
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
