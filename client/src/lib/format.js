import {
  isBirthDateNotFuture,
  isBirthDateNotTooOld,
  isWithinReasonableFutureCeiling,
} from './form.js'

// Mirrors UNKNOWN_LEGACY_GRADE_NAME in server/src/model/grade-model.ts -
// the sentinel grade the importer upserts when a legacy row's grade wasn't
// on the sheet.
export const UNKNOWN_LEGACY_GRADE_NAME = 'Unknown (Legacy Import)'

export const IMPORT_DEFAULTED_FIELD_LABELS = {
  religion: 'Religion',
  birth_place: 'Birth Place',
  birth_date: 'Birth Date',
  status: 'Status',
  current_grade: 'Current Grade',
}

// Two independent, unrelated flags a student can carry - "some fields were
// silently defaulted at import" and "a grade consistency check was let
// through with a Super Admin's reason" - so both can be true on the same
// student at once (e.g. Current Grade is both auto-filled AND the reason a
// too-far-ahead check was overridden). Deliberately different colors (gold
// vs navy) rather than sharing one tone, so a student with both doesn't
// read as if they only had one. Mirrors the employee ST/SP disciplinary
// flag's look, but as a list of independent badges instead of one tiered
// flag - these two aren't a severity scale of the same thing.
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
      textClass: 'text-[var(--mws-gold)]',
      title: `Imported with placeholder data for: ${fieldNames}. Update the real value once known.`,
    })
  }

  const overrideReason = student?.academic?.grade_consistency_override_reason
  if (overrideReason) {
    badges.push({
      key: 'override',
      label: 'Override',
      // A bare (--mws-navy) is nearly the same darkness as normal body
      // text (--mws-charcoal) on plain white - it only reads as "flagged"
      // against a tinted badge background (see the StatusBadge "neutral"
      // tone), not as loose text next to a name. Needs real hue+lightness
      // contrast here instead.
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

  // Independent of the two flags above - e.g. a student can be both
  // Override (a real, deliberate grade skip) and Dates (that same record's
  // birth_date happens to also predate the age-sanity check) at once.
  const birthDateWarning = getBirthDateWarning(student?.identity?.birth_date)
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

  // timeZone: 'UTC' - date-only values (birth dates, enrollment start/end,
  // academic year dates) are stored as UTC midnight representing a
  // calendar date, not a real instant. Without pinning this, the viewer's
  // local timezone shifts the displayed day - e.g. a browser east of UTC
  // shows the *next* day, disagreeing with dateInputFromIso() (form.js),
  // which is already UTC-based and would show the correct one.
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
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
// 'missing' covers records saved before contract_end_date became required
// for non-PERMANENT types - editing this employee will now force it in.
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

// Flags a birth date that predates the age-sanity checks added to the
// create/edit forms - an existing record can still carry one of these
// (e.g. imported before the check existed), and it won't get caught again
// until someone actually edits birth_date. Reuses the exact same rules the
// forms validate against (lib/form.js), so this warning and a fresh
// validation error always agree.
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

// Same idea for join_date/contract_end_date - these don't get "too old" (a
// long-past join date is just tenure), only "impossibly far ahead".
export function getFarFutureDateWarning(isoDate) {
  if (!isoDate) return null
  const dateInput = isoDate.slice(0, 10)
  if (!isWithinReasonableFutureCeiling(dateInput)) {
    return 'This date is unusually far in the future.'
  }
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

// EmployeesTable.jsx's name column, same array-of-badges shape as
// getStudentFlagBadges above - a disciplinary flag and a date anomaly are
// independent and can both be true on the same employee at once, so this
// returns everything that applies rather than picking just one.
export function getEmployeeFlagBadges(employee) {
  const badges = []

  const disciplinaryFlag = getDisciplinaryFlagStyle(employee.disciplinary_flag)
  if (disciplinaryFlag) {
    badges.push({ key: 'disciplinary', ...disciplinaryFlag })
  }

  const dateFields = []
  if (getBirthDateWarning(employee.identity.birth_date)) dateFields.push('Birth date')
  if (getFarFutureDateWarning(employee.employment.join_date)) dateFields.push('Join date')
  if (getFarFutureDateWarning(employee.status_info.contract_end_date)) {
    dateFields.push('Contract end date')
  }
  if (dateFields.length > 0) {
    badges.push({
      key: 'dates',
      label: 'Dates',
      textClass: 'text-[#a43c41]',
      title: `${dateFields.join(', ')} ${dateFields.length > 1 ? 'look' : 'looks'} off - review this record.`,
    })
  }

  return badges
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

// Word-parts that are initialisms, not ordinary words - title-casing them
// like the rest of a snake_case value/field name (formatStatus's default)
// would produce "Nik"/"Npwp"/"Psb" instead of the real abbreviation.
const ACRONYM_WORD_LABELS = {
  nik: 'NIK',
  npwp: 'NPWP',
  nis: 'NIS',
  nisn: 'NISN',
  sn: 'SN',
  bpjs: 'BPJS',
  psb: 'PSB',
  id: 'ID',
  ip: 'IP',
  pc: 'PC',
}

export function formatStatus(value) {
  if (!value) return '-'
  return value
    .toLowerCase()
    .split('_')
    .map((part) => ACRONYM_WORD_LABELS[part] || part[0].toUpperCase() + part.slice(1))
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
    case 'TERMINATED':
      return 'red'
    default:
      return 'neutral'
  }
}

// SUPER_ADMIN in red - not a warning, just the highest-privilege role
// standing out at a glance in a list of admins. DATABASE_ADMIN in amber
// (elevated but scoped), VIEWER left neutral (read-only, no special call-out).
export function adminRoleTone(role) {
  if (role === 'SUPER_ADMIN') return 'red'
  if (role === 'DATABASE_ADMIN') return 'amber'
  return 'neutral'
}
