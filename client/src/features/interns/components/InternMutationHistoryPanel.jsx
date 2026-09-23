import { MutationHistoryPanel } from '../../employees/components/EmployeeMutationHistoryPanel.jsx'
import { internsApi } from '../api/internsApi.js'

export function InternMutationHistoryPanel({ internId, canWrite }) {
  return (
    <MutationHistoryPanel
      memberId={internId}
      memberType="interns"
      canWrite={canWrite}
      getHistory={internsApi.getMutationHistory}
      rollbackAction={internsApi.rollbackMutation}
      description="Unit, job position, building, and status changes over time."
    />
  )
}
