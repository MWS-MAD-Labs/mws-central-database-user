import { useQuery } from '@tanstack/react-query'
import { employeesApi } from '../../employees/api/employeesApi.js'
import { jobLevelsApi } from '../api/masterDataApi.js'

// Same eligibility rule the backend enforces (assertMentorIsEligible in
// pc-activity-service.ts): active employee, teaching-role job level, AND
// strictly the mentor's own unit (employee.unit_id) - job position/job
// level unit-scoping is deliberately NOT consulted. Those tables describe
// hire-time placement eligibility, not who can physically supervise
// students at a given campus.
export function useMentorOptions(enabled) {
  return useQuery({
    queryKey: ['pc-activity-mentor-options'],
    queryFn: async () => {
      const [employees, jobLevels] = await Promise.all([
        employeesApi.list({
          page: 1,
          size: 100,
          status: 'ACTIVE',
          sort_by: 'full_name',
          sort_order: 'asc',
        }),
        jobLevelsApi.list({
          page: 1,
          size: 100,
          sort_by: 'name',
          sort_order: 'asc',
        }),
      ])
      const jobLevelById = new Map((jobLevels.data || []).map((level) => [level.id, level]))
      const activeEmployees = employees.data || []
      const teachingEmployees = activeEmployees.filter((employee) => {
        const level = jobLevelById.get(employee.employment.job_level_id)
        return level?.is_teaching_role
      })

      return {
        employees: activeEmployees,
        teachingEmployees,
        // Teaching employees actually in the given unit.
        eligibleForUnit: (unitId) =>
          teachingEmployees.filter((employee) => employee.unit_id === unitId),
      }
    },
    enabled,
  })
}
