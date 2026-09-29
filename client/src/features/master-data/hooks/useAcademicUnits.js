import { useQuery } from '@tanstack/react-query'
import { gradesApi } from '../../academic/api/academicApi.js'
import { distinctGradeUnits } from '../utils/pcActivityUnits.js'

// Units that actually have grades (Kindergarten/Elementary/Junior High).
// PC mentor scopes and PC rooms never apply to staff-only units.
export function useAcademicUnits(enabled = true) {
  const query = useQuery({
    queryKey: ['academic-units', 'all'],
    queryFn: () => gradesApi.list({ page: 1, size: 100 }),
    enabled,
  })
  return {
    academicUnits: distinctGradeUnits(query.data?.data || []),
    isLoading: query.isLoading,
  }
}
