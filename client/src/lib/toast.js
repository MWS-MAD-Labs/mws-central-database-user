import toast from 'react-hot-toast'

export function showErrorToast(error, fallback = 'Request failed.') {
  const message = getErrorMessage(error) || fallback
  toast.error(message, { id: `error:${message}` })
}

export function showSuccessToast(message) {
  toast.success(message)
}

function getErrorMessage(error) {
  if (!error) return ''
  if (typeof error === 'string') return error
  return error.message || error.payload?.errors || error.payload?.message || ''
}
