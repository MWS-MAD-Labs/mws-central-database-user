import { useQuery } from '@tanstack/react-query'
import { employeesApi } from '../../employees/api/employeesApi.js'
import { jobLevelsApi } from '../api/masterDataApi.js'
import { fetchAllPages } from '../../../lib/pagination.js'

export function useMentorOptions(enabled) {
  return useQuery({
    queryKey: ['pc-activity-mentor-options'],
    queryFn: async () => {
      const [employees, jobLevels] = await Promise.all([
        fetchAllPages(employeesApi.list, {
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
        eligibleForUnit: (unitId) =>
          teachingEmployees.filter((employee) => employee.unit_id === unitId),
      }
    },
    enabled,
  })
}
