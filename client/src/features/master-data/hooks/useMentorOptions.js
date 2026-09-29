import { useQuery } from '@tanstack/react-query'
import { employeesApi } from '../../employees/api/employeesApi.js'
import { internsApi } from '../../interns/api/internsApi.js'
import { fetchAllPages } from '../../../lib/pagination.js'

// Eligibility is is_pc_mentor_eligible, checked independently of the
// teaching flag - a non-teaching staff member can still qualify.
export function useMentorOptions(enabled) {
  return useQuery({
    queryKey: ['pc-activity-mentor-options'],
    queryFn: async () => {
      const [employees, interns] = await Promise.all([
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
      ])
      const activeEmployees = employees.data || []
      const eligibleEmployees = activeEmployees
        .filter((employee) => employee.employment.is_pc_mentor_eligible)
        .map((employee) => ({ ...employee, workforce_type: 'EMPLOYEE' }))
      const eligibleInterns = (interns.data || [])
        .filter((intern) => intern.employment.is_pc_mentor_eligible)
        .map((intern) => ({ ...intern, workforce_type: 'INTERN' }))
      const eligibleMembers = [...eligibleEmployees, ...eligibleInterns]

      return {
        employees: activeEmployees,
        teachingEmployees: eligibleMembers,
        eligibleForUnit: (unitId) =>
          eligibleMembers.filter((member) => member.unit_id === unitId),
        // A room can span multiple units. A member's own pc_mentor_units
        // scope (if set) replaces the home-unit-only default - matches
        // assertMentorIsEligible's server-side rule exactly. A member only
        // qualifies if their allowed set covers EVERY unit the room spans,
        // not just one of them.
        eligibleForUnits: (targetUnitIds) =>
          eligibleMembers.filter((member) => {
            const scopedUnitIds = (member.employment.pc_mentor_units || []).map(
              (unit) => unit.id,
            )
            const allowedUnitIds =
              scopedUnitIds.length > 0 ? scopedUnitIds : [member.unit_id]
            return targetUnitIds.every((id) => allowedUnitIds.includes(id))
          }),
      }
    },
    enabled,
  })
}
