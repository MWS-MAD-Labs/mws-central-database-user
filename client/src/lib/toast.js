import toast from 'react-hot-toast'

export function showErrorToast(error, fallback = 'Request failed.') {
  const message = getErrorMessage(error) || fallback
  toast.error(message, { id: `error:${message}` })
}

export function showSuccessToast(message) {
  toast.success(message)
}

export function showInfoToast(message) {
  toast(message, { duration: 6000 })
}

export function showBulkFailureToast(summary, result) {
  const reasons = (result.items || [])
    .filter((item) => item.status === 'FAILED')
    .map((item) => item.error)
    .filter(Boolean)
  showErrorToast(
    reasons.length > 0
      ? `${result.failed_count} ${summary}: ${reasons.join('; ')}`
      : `${result.failed_count} ${summary}.`,
  )
}

function getErrorMessage(error) {
  if (!error) return ''
  if (typeof error === 'string') return error
  return error.message || error.payload?.errors || error.payload?.message || ''
}
