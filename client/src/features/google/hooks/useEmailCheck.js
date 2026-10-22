import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { emailProblem } from '../../../lib/form.js'
import { googleAccountApi } from '../api/googleAccountApi.js'

// Asks the server whether an email can be used, once, when the person presses Check. The answer belongs to the
// address that was checked, so typing anything else makes it stale and the button comes back. `blocked` is true while
// a changed email has not passed. The email the form started with (edit) passes without asking. A Google that cannot
// be asked, or is only simulated, passes with its note; a request that failed does not. An address Google already has
// stays blocked, unless `allowClaim` (a Super Admin on the employee form): then it can pass once `claimExisting` is
// ticked, and the person is linked when they sign in.
export function useEmailCheck(email, { initialEmail = '', allowClaim = false, claimExisting = false } = {}) {
  const [result, setResult] = useState(null)
  const mutation = useMutation({
    mutationFn: (value) => googleAccountApi.emailAvailability(value),
    onSuccess: (data, value) => setResult({ email: value, data }),
    onError: (_error, value) => setResult({ email: value, failed: true }),
  })

  const usable = Boolean(email) && !emailProblem(email)
  const answer = result && result.email === email ? result : null
  const none = { checking: false, canCheck: false, blocked: false, message: null, check: () => {} }

  if (!usable || (initialEmail && email === initialEmail)) return { ...none, state: 'idle' }

  const check = () => mutation.mutate(email)
  if (mutation.isPending) return { ...none, state: 'checking', checking: true, blocked: true, message: 'Checking...' }
  if (!answer) {
    return { ...none, state: 'needed', canCheck: true, blocked: true, message: 'Check the email before saving.', check }
  }
  if (answer.failed) {
    return { ...none, state: 'failed', canCheck: true, blocked: true, message: 'Could not check the email, try again.', check }
  }
  if (!answer.data.available && allowClaim && answer.data.reason === 'IN_GOOGLE') {
    return { ...none, state: 'claimable', blocked: !claimExisting, message: answer.data.message }
  }
  if (!answer.data.available) return { ...none, state: 'taken', blocked: true, message: answer.data.message }
  if (answer.data.reason === 'FREE') return { ...none, state: 'free', message: answer.data.message }
  // A protected admin address: saved as an employee, never given a Google account.
  if (answer.data.reason === 'PROTECTED') return { ...none, state: 'protected', message: answer.data.message }
  return { ...none, state: answer.data.reason === 'CHECK_FAILED' ? 'failed-google' : 'unchecked', message: answer.data.message }
}
