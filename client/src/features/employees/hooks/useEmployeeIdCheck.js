import { useQuery } from '@tanstack/react-query'
import { employeesApi } from '../api/employeesApi.js'

const COMPLETE = /^\d{2}\.\d{2}\.\d{3}$/

// Asks the server whether an Employee ID is free as soon as the whole ID is typed, so a taken one shows before the form
// is filled in. `blocked` is true only for an ID that is used. A request that failed says nothing and blocks nothing:
// the server checks again when the employee is saved.
export function useEmployeeIdCheck(employeeId, { enabled = true } = {}) {
  const complete = enabled && COMPLETE.test(employeeId || '')
  const query = useQuery({
    queryKey: ['employee-id-availability', employeeId],
    queryFn: () => employeesApi.idAvailability(employeeId),
    enabled: complete,
    retry: false,
    staleTime: 30_000,
  })
  const none = { state: 'idle', blocked: false, message: null }
  const available = query.data?.available
  if (!complete || query.isPending || query.isError || typeof available !== 'boolean') return none
  return available
    ? { state: 'free', blocked: false, message: query.data.message }
    : { state: 'taken', blocked: true, message: query.data.message }
}
