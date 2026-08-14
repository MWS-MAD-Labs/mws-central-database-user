import toast from 'react-hot-toast'

export function showErrorToast(error, fallback = 'Request failed.') {
  const message = getErrorMessage(error) || fallback
  toast.error(message, { id: `error:${message}` })
}

export function showSuccessToast(message) {
  toast.success(message)
}

// A bare "N failed" toast leaves the admin guessing why - bulk-action
// responses already carry a per-item reason, so surface those instead of
// just the count. `summary` is the full phrase after the count, already
// including "failed" (e.g. "student(s) failed to enroll").
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
