import { PcActivityMentorshipsPanel } from '../../employees/components/EmployeePcActivityMentorshipsPanel.jsx'
import { internsApi } from '../api/internsApi.js'

export function InternPcActivityMentorshipsPanel({ internId, isTeachingRole }) {
  return (
    <PcActivityMentorshipsPanel
      memberId={internId}
      memberType="interns"
      isTeachingRole={isTeachingRole}
      getMentorships={internsApi.getPcActivityMentorships}
    />
  )
}
