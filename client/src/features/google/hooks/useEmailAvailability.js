import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { emailProblem } from '../../../lib/form.js'
import { googleAccountApi } from '../api/googleAccountApi.js'

const WAIT_MS = 500

// Asks the server whether the email can be given to a new person, a moment after it stops changing. `blocked` is true
// while the answer is not in, and when it says the email cannot be used. A Google that cannot be asked, or is only
// simulated, does not block.
export function useEmailAvailability(email, { enabled = true } = {}) {
  const [settled, setSettled] = useState(email)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(email), WAIT_MS)
    return () => clearTimeout(timer)
  }, [email])

  const usable = enabled && Boolean(email) && !emailProblem(email)
  const query = useQuery({
    queryKey: ['google-email-availability', settled],
    queryFn: () => googleAccountApi.emailAvailability(settled),
    enabled: usable && settled === email,
    staleTime: 15_000,
    retry: false,
  })

  if (!usable) return { state: 'idle', blocked: false, message: null }
  if (settled !== email || query.isFetching) return { state: 'checking', blocked: true, message: 'Checking...' }
  if (query.isError) return { state: 'failed', blocked: false, message: 'Could not check Google, try again' }
  const data = query.data
  if (!data) return { state: 'checking', blocked: true, message: 'Checking...' }
  if (!data.available) return { state: 'taken', blocked: true, message: data.message }
  if (data.reason === 'FREE') return { state: 'free', blocked: false, message: data.message }
  return { state: data.reason === 'CHECK_FAILED' ? 'failed' : 'unchecked', blocked: false, message: data.message }
}
