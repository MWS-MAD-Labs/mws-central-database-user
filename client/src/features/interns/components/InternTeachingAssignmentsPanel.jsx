import { TeachingAssignmentsPanel } from '../../employees/components/EmployeeTeachingAssignmentsPanel.jsx'
import { internsApi } from '../api/internsApi.js'

export function InternTeachingAssignmentsPanel({ internId, isTeachingRole }) {
  return (
    <TeachingAssignmentsPanel
      memberId={internId}
      isTeachingRole={isTeachingRole}
      queryKeyPrefix="interns"
      getAssignments={internsApi.getTeachingAssignments}
    />
  )
}
