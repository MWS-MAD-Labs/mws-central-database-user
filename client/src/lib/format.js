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
