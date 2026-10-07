import { MutationCache } from '@tanstack/react-query'
import { showErrorToast, showSuccessToast } from './toast.js'

// A mutation says what to tell the user with `meta: { successMessage }`: a string, or a function of
// (data, variables). Mutations without it stay silent, so ones that already toast do not toast twice.
export function showMutationSuccess(mutation, data, variables) {
  const message = mutation.meta?.successMessage
  const text = typeof message === 'function' ? message(data, variables) : message
  if (text) showSuccessToast(text)
}

// The one place that turns every mutation's outcome into a toast.
export function createMutationCache() {
  return new MutationCache({
    onSuccess: (data, variables, _context, mutation) => showMutationSuccess(mutation, data, variables),
    onError: (error) => showErrorToast(error),
  })
}
