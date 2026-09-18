import {
  isBirthDateNotFuture,
  isBirthDateNotTooOld,
  isWithinReasonableFutureCeiling,
} from './form.js'

export const UNKNOWN_LEGACY_GRADE_NAME = 'Unknown (Legacy Import)'

export const IMPORT_DEFAULTED_FIELD_LABELS = {
  religion: 'Religion',
  birth_place: 'Birth Place',
  birth_date: 'Birth Date',
  status: 'Status',
  current_grade: 'Current Grade',
}

export function getStudentFlagBadges(student) {
  const badges = []

  const defaultedFields = student?.academic?.import_defaulted_fields
  if (defaultedFields?.length) {
    const fieldNames = defaultedFields
      .map((key) => IMPORT_DEFAULTED_FIELD_LABELS[key] || key)
      .join(', ')
    badges.push({
      key: 'defaulted',
      label: 'Auto-Filled',
      textClass: 'text-(--mws-gold)',
      title: `Imported with placeholder data for: ${fieldNames}. Update the real value once known.`,
    })
  }

  const overrideReason = student?.academic?.grade_consistency_override_reason
  if (overrideReason) {
    badges.push({
      key: 'override',
      label: 'Override',
      textClass: 'text-[#1d4ed8]',
      title: `Grade consistency check overridden by a Super Admin: "${overrideReason}"`,
    })
  }

  if (student?.academic?.has_unresolved_placeholder_class) {
    badges.push({
      key: 'placeholder-class',
      label: 'Fix Class',
      textClass: 'text-[#b45309]',
      title: 'One of this student\'s enrollments sits in a placeholder "Unknown (Legacy Import)" class. Open that class\'s detail page and use Fix Class once the real class is known.',
    })
  }

  const birthDateWarning = birthDateFlagMessage(student?.identity)
  if (birthDateWarning) {
    badges.push({
      key: 'dates',
      label: 'Dates',
      textClass: 'text-[#a43c41]',
      title: birthDateWarning,
    })
  }

  return badges
}

export function formatDate(value) {
  if (!value) return '-'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function formatDateTime(value) {
  if (!value) return '-'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function formatTenure(joinDateIso, endDateIso) {
  if (!joinDateIso) return '-'
  const joinDate = new Date(joinDateIso)
  if (Number.isNaN(joinDate.getTime())) return '-'

  const endDate = endDateIso ? new Date(endDateIso) : new Date()
  if (Number.isNaN(endDate.getTime())) return '-'

  const joinUtcDay = Date.UTC(joinDate.getUTCFullYear(), joinDate.getUTCMonth(), joinDate.getUTCDate())
  const endUtcDay = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())
  const diffDays = Math.round((endUtcDay - joinUtcDay) / MS_PER_DAY)

  if (diffDays < 0) return `Starts in ${Math.abs(diffDays).toLocaleString('en-US')} day${diffDays === -1 ? '' : 's'}`

  const years = Math.floor(diffDays / 365)
  const months = Math.floor((diffDays % 365) / 30)
  const parts = []
  if (years) parts.push(`${years}y`)
  if (months) parts.push(`${months}m`)

  const dayLabel = `${diffDays.toLocaleString('en-US')} day${diffDays === 1 ? '' : 's'}`
  return parts.length ? `${dayLabel} (${parts.join(' ')})` : dayLabel
}

const CONTRACT_EXPIRY_WARNING_DAYS = 30

export function getContractExpiryFlag(employee) {
  if (employee.status_info.employment_type === 'PERMANENT') return null
  const contractEndDate = employee.status_info.contract_end_date
  if (!contractEndDate) return 'missing'

  const daysUntilExpiry = Math.ceil(
    (new Date(contractEndDate) - new Date()) / (1000 * 60 * 60 * 24),
  )
  if (daysUntilExpiry < 0) return 'expired'
  if (daysUntilExpiry <= CONTRACT_EXPIRY_WARNING_DAYS) return 'soon'
  return null
}

export function getBirthDateWarning(isoDate) {
  if (!isoDate) return null
  const dateInput = isoDate.slice(0, 10)
  if (!isBirthDateNotFuture(dateInput)) {
    return 'This date is in the future.'
  }
  if (!isBirthDateNotTooOld(dateInput)) {
    return 'This date is unusually far in the past.'
  }
  return null
}

function birthDateFlagMessage(identity) {
  if (!identity) return null
  if (identity.birth_date) return getBirthDateWarning(identity.birth_date)
  return identity.has_birth_date_warning
    ? 'Birth date looks off. Open the profile to check.'
    : null
}

export function getFarFutureDateWarning(isoDate) {
  if (!isoDate) return null
  const dateInput = isoDate.slice(0, 10)
  if (!isWithinReasonableFutureCeiling(dateInput)) {
    return 'This date is unusually far in the future.'
  }
  return null
}

export function getDisciplinaryFlagStyle(flag) {
  if (!flag) return null

  const label = `${flag.type === 'SURAT_PERINGATAN' ? 'SP' : 'ST'}${flag.level}`

  if (flag.type === 'SURAT_PERINGATAN') {
    return {
      label,
      textClass: flag.level >= 2 ? 'text-[#991b1b]' : 'text-[#dc2626]',
      title:
        flag.level >= 2
          ? 'Has an active Reprimand Letter 2 (SP2)'
          : 'Has an active Reprimand Letter (SP1)',
    }
  }

  return {
    label,
    textClass: flag.level >= 2 ? 'text-[#c2410c]' : 'text-[#a16207]',
    title:
      flag.level >= 2
        ? 'Has an active Warning Letter 2 (ST2)'
        : 'Has an active Warning Letter (ST1)',
  }
}

export function getEmployeeFlagBadges(employee) {
  const badges = []

  const disciplinaryFlag = getDisciplinaryFlagStyle(employee.disciplinary_flag)
  if (disciplinaryFlag) {
    badges.push({ key: 'disciplinary', ...disciplinaryFlag })
  }

  const dateFields = []
  if (birthDateFlagMessage(employee.identity)) dateFields.push('Birth date')
  if (getFarFutureDateWarning(employee.employment.join_date)) dateFields.push('Join date')
  if (getFarFutureDateWarning(employee.status_info.contract_end_date)) {
    dateFields.push('Contract end date')
  }
  if (dateFields.length > 0) {
    badges.push({
      key: 'dates',
      label: 'Dates',
      textClass: 'text-[#a43c41]',
      title: `${dateFields.join(', ')} ${dateFields.length > 1 ? 'look' : 'looks'} off. Review this record.`,
    })
  }

  if (getContractExpiryFlag(employee) === 'missing') {
    badges.push({
      key: 'no-contract-end',
      label: 'No End Date',
      textClass: 'text-(--mws-muted)',
      title: 'No contract end date on file. Edit this employee to set one.',
    })
  }

  return badges
}

export function getInternFlagBadges(intern) {
  const badges = []

  const dateFields = []
  if (birthDateFlagMessage(intern.identity)) dateFields.push('Birth date')
  if (getFarFutureDateWarning(intern.employment.join_date)) dateFields.push('Join date')
  if (getFarFutureDateWarning(intern.employment.end_date)) dateFields.push('End date')
  if (dateFields.length > 0) {
    badges.push({
      key: 'dates',
      label: 'Dates',
      textClass: 'text-[#a43c41]',
      title: `${dateFields.join(', ')} ${dateFields.length > 1 ? 'look' : 'looks'} off. Review this record.`,
    })
  }

  return badges
}

export function formatEnrollmentHistoryCounts(counts) {
  if (!counts) return null
  const parts = []
  if (counts.transferred) parts.push(`${counts.transferred} transferred`)
  if (counts.withdrawn) parts.push(`${counts.withdrawn} withdrawn`)
  if (counts.completed) parts.push(`${counts.completed} completed`)
  return parts.length ? parts.join(' · ') : null
}

const EDUCATION_LEVEL_LABELS = {
  SD: 'SD',
  SMP: 'SMP',
  SMA_SMK: 'SMA/SMK',
  D1: 'D1',
  D2: 'D2',
  D3: 'D3',
  D4: 'D4',
  S1: 'S1',
  S2: 'S2',
  S3: 'S3',
}

export function formatEducationLevel(value) {
  if (!value) return '-'
  return EDUCATION_LEVEL_LABELS[value] || value
}

export function sumEnrollmentHistoryCounts(counts) {
  if (!counts) return 0
  return (counts.transferred || 0) + (counts.withdrawn || 0) + (counts.completed || 0)
}

const ACRONYM_WORD_LABELS = {
  nik: 'NIK',
  npwp: 'NPWP',
  nis: 'NIS',
  nisn: 'NISN',
  sn: 'SN',
  bpjs: 'BPJS',
  kpj: 'KPJ',
  psb: 'PSB',
  id: 'ID',
  ip: 'IP',
  pc: 'PC',
  ui: 'UI',
  api: 'API',
  ab: 'AB',
}

export function formatStatus(value) {
  if (!value) return '-'
  return value
    .toLowerCase()
    .split('_')
    .map((part) => ACRONYM_WORD_LABELS[part] || part[0].toUpperCase() + part.slice(1))
    .join(' ')
}

export function enumOptions(values, formatter = formatStatus) {
  return values.map((value) => ({ value, label: formatter(value) }))
}

// Mirrors the server's maskSensitiveValue (utils/sensitive-data.ts) - same
// last-4-digits-visible rule, so NIK/NPWP/bank account/BPJS/KPJ numbers
// never sit in plaintext in the pre-save change review dialog, matching how
// they're already masked everywhere else the app shows them.
export function maskSensitiveValue(value) {
  if (!value) return '-'
  if (value.length <= 4) return '•'.repeat(value.length)
  return '•'.repeat(value.length - 4) + value.slice(-4)
}

const ENUM_LIKE_VALUE_RE = /^[A-Z][A-Z0-9_]*$/

// Shared by the Audit Logs before/after table and the pre-save change
// review dialog on the Employee/Student/Intern forms - same rules for
// turning a raw stored value into something readable either way.
export function formatDiffValue(value, resolvedLabels) {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string' && resolvedLabels?.[value]) {
    return resolvedLabels[value]
  }
  if (typeof value === 'string' && ENUM_LIKE_VALUE_RE.test(value)) {
    return formatStatus(value)
  }
  return String(value)
}

export function statusTone(status) {
  switch (status) {
    case 'ACTIVE':
      return 'green'
    case 'REGISTERED':
    case 'UPCOMING':
    case 'ON_LEAVE':
    case 'INACTIVE':
      return 'amber'
    case 'COMPLETED':
    case 'GRADUATED':
      return 'green'
    case 'RESIGNED':
    case 'ARCHIVED':
    case 'WITHDRAWN':
    case 'TRANSFERRED':
    case 'TERMINATED':
      return 'red'
    default:
      return 'neutral'
  }
}

export function adminRoleTone(role) {
  if (role === 'SUPER_ADMIN') return 'red'
  if (role === 'DATABASE_ADMIN') return 'amber'
  return 'neutral'
}
