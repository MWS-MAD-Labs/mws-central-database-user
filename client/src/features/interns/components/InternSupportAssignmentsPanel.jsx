import { SupportAssignmentsPanel } from '../../employees/components/EmployeeSupportAssignmentsPanel.jsx'
import { internsApi } from '../api/internsApi.js'

export function InternSupportAssignmentsPanel({ internId, isTeachingRole, canWrite }) {
  return (
    <SupportAssignmentsPanel
      memberId={internId}
      memberType="interns"
      isTeachingRole={isTeachingRole}
      canWrite={canWrite}
      getAssignments={internsApi.getSupportAssignments}
    />
  )
}
