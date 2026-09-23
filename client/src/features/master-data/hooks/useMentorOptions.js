import { useQuery } from '@tanstack/react-query'
import { employeesApi } from '../../employees/api/employeesApi.js'
import { internsApi } from '../../interns/api/internsApi.js'
import { jobLevelsApi } from '../api/masterDataApi.js'
import { fetchAllPages } from '../../../lib/pagination.js'

export function useMentorOptions(enabled) {
  return useQuery({
    queryKey: ['pc-activity-mentor-options'],
    queryFn: async () => {
      const [employees, interns, jobLevels] = await Promise.all([
        fetchAllPages(employeesApi.list, {
          status: 'ACTIVE',
          sort_by: 'full_name',
          sort_order: 'asc',
        }),
        fetchAllPages(internsApi.list, {
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
      const teachingInterns = (interns.data || [])
        .filter((intern) => intern.employment.is_teaching_position)
        .map((intern) => ({ ...intern, workforce_type: 'INTERN' }))
      const teachingMembers = [
        ...teachingEmployees.map((employee) => ({ ...employee, workforce_type: 'EMPLOYEE' })),
        ...teachingInterns,
      ]

      return {
        employees: activeEmployees,
        teachingEmployees: teachingMembers,
        eligibleForUnit: (unitId) =>
          teachingMembers.filter((member) => member.unit_id === unitId),
      }
    },
    enabled,
  })
}
