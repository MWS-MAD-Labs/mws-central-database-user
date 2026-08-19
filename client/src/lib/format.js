export function formatDate(value) {
  if (!value) return '-'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

// Same as formatDate but with hour:minute - for timestamps where "when
// exactly" matters (audit logs, mutation history), not just "which day"
// (birth dates, enrollment start/end dates stay date-only on purpose).
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

const CONTRACT_EXPIRY_WARNING_DAYS = 30

// Only non-PERMANENT employees have a contract_end_date. 'expired' takes
// priority over 'soon' - it's the same threshold, just already past it.
export function getContractExpiryFlag(employee) {
  if (employee.status_info.employment_type === 'PERMANENT') return null
  const contractEndDate = employee.status_info.contract_end_date
  if (!contractEndDate) return null

  const daysUntilExpiry = Math.ceil(
    (new Date(contractEndDate) - new Date()) / (1000 * 60 * 60 * 24),
  )
  if (daysUntilExpiry < 0) return 'expired'
  if (daysUntilExpiry <= CONTRACT_EXPIRY_WARNING_DAYS) return 'soon'
  return null
}

// Severity ladder for EmployeesTable.jsx's name column - SP always reads
// more severe than ST (mirrors "SP blocks ST issuance" in
// disciplinary-action-service.ts), then level 2 darker than level 1.
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

// Students who've left a class's active roster - active_enrollment_count
// alone makes a class with e.g. 3 transferred-out students look like it
// never had anyone in it, so surface those counts too.
export function formatEnrollmentHistoryCounts(counts) {
  if (!counts) return null
  const parts = []
  if (counts.transferred) parts.push(`${counts.transferred} transferred`)
  if (counts.withdrawn) parts.push(`${counts.withdrawn} withdrawn`)
  if (counts.completed) parts.push(`${counts.completed} completed`)
  return parts.length ? parts.join(' · ') : null
}

// SD/SMP/SMA/SMK/D1-D4/S1-S3 are established abbreviations, not phrases -
// title-casing them the way formatStatus() does to enum values elsewhere
// would produce "Sma Smk" instead of "SMA/SMK", so they get their own map.
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

export function formatStatus(value) {
  if (!value) return '-'
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
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
      return 'red'
    default:
      return 'neutral'
  }
}
