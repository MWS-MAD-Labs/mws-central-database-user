import { useState } from 'react'
import { Save } from 'lucide-react'
import { Button } from '../../../components/ui/Button.jsx'
import {
  Field,
  SelectInput,
  TextAreaInput,
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
  employeeStatuses,
  employmentTypes,
  genderOptions,
  maritalStatuses,
  religionOptions,
} from '../api/employeesApi.js'

const emptyOptions = {
  units: [],
  jobPositions: [],
  jobLevels: [],
}

export function EmployeeForm({
  mode,
  employee,
  options = emptyOptions,
  error,
  isSubmitting,
  onSubmit,
}) {
  const [values, setValues] = useState(() =>
    getInitialValues(mode, employee, options),
  )

  const isCreate = mode === 'create'

  function updateValue(field, value) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  function handleSubmit(event) {
    event.preventDefault()
    onSubmit(buildPayload(values))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error ? (
        <div className="rounded-md border border-[#e8c7c2] bg-[#fff4f2] px-4 py-3 text-sm text-[#8f2f2f]">
          {error.message || 'Failed to save employee.'}
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
          Employment
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Employee ID" hint="Format: 12.01.123">
            <TextInput
              required={isCreate}
              value={values.employee_id}
              onChange={(event) =>
                updateValue('employee_id', event.target.value)
              }
            />
          </Field>
          <Field label="Status">
            <SelectInput
              required={isCreate}
              value={values.status}
              onChange={(event) => updateValue('status', event.target.value)}
            >
              <option value="">Select status</option>
              {employeeStatuses.map((option) => (
                <option key={option} value={option}>
                  {formatStatus(option)}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Employment type">
            <SelectInput
              required={isCreate}
              value={values.employment_type}
              onChange={(event) =>
                updateValue('employment_type', event.target.value)
              }
            >
              <option value="">Select type</option>
              {employmentTypes.map((option) => (
                <option key={option} value={option}>
                  {formatStatus(option)}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Unit">
            <SelectInput
              required={isCreate}
              value={values.unit_id}
              onChange={(event) => updateValue('unit_id', event.target.value)}
            >
              <option value="">
                {employee?.employment?.unit
                  ? `Keep current: ${employee.employment.unit}`
                  : 'Select unit'}
              </option>
              {options.units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Job position">
            <SelectInput
              required={isCreate}
              value={values.job_position_id}
              onChange={(event) =>
                updateValue('job_position_id', event.target.value)
              }
            >
              <option value="">
                {employee?.employment?.job_position
                  ? `Keep current: ${employee.employment.job_position}`
                  : 'Select position'}
              </option>
              {options.jobPositions.map((position) => (
                <option key={position.id} value={position.id}>
                  {position.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Job level">
            <SelectInput
              required={isCreate}
              value={values.job_level_id}
              onChange={(event) =>
                updateValue('job_level_id', event.target.value)
              }
            >
              <option value="">
                {employee?.employment?.job_level
                  ? `Keep current: ${employee.employment.job_level}`
                  : 'Select level'}
              </option>
              {options.jobLevels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.name}
                  {level.is_teaching_role ? ' (Teaching)' : ''}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Building">
            <TextInput
              required={isCreate}
              value={values.building}
              onChange={(event) => updateValue('building', event.target.value)}
            />
          </Field>
          <Field label="Join date">
            <TextInput
              required={isCreate}
              type="date"
              value={values.join_date}
              onChange={(event) => updateValue('join_date', event.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="rounded-md border border-[#deded7] bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-[#202326]">
          Contact And Sensitive Data
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Marital status">
            <SelectInput
              required={isCreate}
              value={values.marital_status}
              onChange={(event) =>
                updateValue('marital_status', event.target.value)
              }
            >
              <option value="">Select marital status</option>
              {maritalStatuses.map((option) => (
                <option key={option} value={option}>
                  {formatStatus(option)}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Mobile phone">
            <TextInput
              value={values.mobile_phone}
              onChange={(event) =>
                updateValue('mobile_phone', event.target.value)
              }
            />
          </Field>
          <Field label="Residential address" className="md:col-span-2">
            <TextAreaInput
              value={values.residential_address}
              onChange={(event) =>
                updateValue('residential_address', event.target.value)
              }
            />
          </Field>
          <Field label="NIK">
            <TextInput
              value={values.nik}
              onChange={(event) => updateValue('nik', event.target.value)}
            />
          </Field>
          <Field label="NPWP">
            <TextInput
              value={values.npwp}
              onChange={(event) => updateValue('npwp', event.target.value)}
            />
          </Field>
          <Field label="Bank account number">
            <TextInput
              value={values.bank_account_number}
              onChange={(event) =>
                updateValue('bank_account_number', event.target.value)
              }
            />
          </Field>
          <Field label="BPJS number">
            <TextInput
              value={values.bpjs_number}
              onChange={(event) =>
                updateValue('bpjs_number', event.target.value)
              }
            />
          </Field>
        </div>
      </section>

      <section className="rounded-md border border-[#deded7] bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-[#202326]">
          Offboarding
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Resignation date">
            <TextInput
              required={values.status === 'RESIGNED'}
              type="date"
              value={values.resignation_date}
              onChange={(event) =>
                updateValue('resignation_date', event.target.value)
              }
            />
          </Field>
          <Field label="Last working date">
            <TextInput
              type="date"
              value={values.last_working_date}
              onChange={(event) =>
                updateValue('last_working_date', event.target.value)
              }
            />
          </Field>
          <Field label="Notes" className="md:col-span-2">
            <TextAreaInput
              value={values.notes}
              onChange={(event) => updateValue('notes', event.target.value)}
            />
          </Field>
        </div>
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          <Save size={16} />
          {isSubmitting ? 'Saving...' : isCreate ? 'Create employee' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}

function getInitialValues(mode, employee, options) {
  const identity = employee?.identity || {}
  const employment = employee?.employment || {}
  const statusInfo = employee?.status_info || {}
  const offboarding = employee?.offboarding || {}

  return {
    full_name: identity.full_name || '',
    nick_name: identity.nick_name || '',
    email: identity.email || '',
    gender: identity.gender || '',
    religion: identity.religion || '',
    birth_place: identity.birth_place || '',
    birth_date: dateInputFromIso(identity.birth_date),
    photo_url: identity.photo_url || '',
    employee_id: employment.employee_id || '',
    status: statusInfo.status || (mode === 'create' ? 'ACTIVE' : ''),
    employment_type:
      statusInfo.employment_type || (mode === 'create' ? 'PERMANENT' : ''),
    unit_id: findOptionByName(options.units, employment.unit)?.id || '',
    job_position_id:
      findOptionByName(options.jobPositions, employment.job_position)?.id || '',
    job_level_id:
      findOptionByName(options.jobLevels, employment.job_level)?.id || '',
    building: employment.building || '',
    join_date: dateInputFromIso(employment.join_date),
    marital_status:
      identity.marital_status || (mode === 'create' ? 'SINGLE' : ''),
    mobile_phone: identity.mobile_phone || '',
    residential_address: identity.residential_address || '',
    nik: identity.nik || '',
    npwp: identity.npwp || '',
    bank_account_number: identity.bank_account_number || '',
    bpjs_number: identity.bpjs_number || '',
    resignation_date: dateInputFromIso(offboarding.resignation_date),
    last_working_date: dateInputFromIso(offboarding.last_working_date),
    notes: offboarding.notes || '',
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
    employee_id: trimmedOrUndefined(values.employee_id),
    status: values.status,
    employment_type: values.employment_type,
    unit_id: values.unit_id,
    job_position_id: values.job_position_id,
    job_level_id: values.job_level_id,
    building: trimmedOrUndefined(values.building),
    join_date: isoFromDateInput(values.join_date),
    marital_status: values.marital_status,
    mobile_phone: trimmedOrUndefined(values.mobile_phone),
    residential_address: trimmedOrUndefined(values.residential_address),
    nik: trimmedOrUndefined(values.nik),
    npwp: trimmedOrUndefined(values.npwp),
    bank_account_number: trimmedOrUndefined(values.bank_account_number),
    bpjs_number: trimmedOrUndefined(values.bpjs_number),
    resignation_date: isoFromDateInput(values.resignation_date),
    last_working_date: isoFromDateInput(values.last_working_date),
    notes: trimmedOrUndefined(values.notes),
  })
}

function findOptionByName(options, name) {
  if (!name) return null
  return options.find((option) => option.name === name) || null
}
