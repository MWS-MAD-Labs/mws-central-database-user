import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { useAuth } from '../../auth/hooks/useAuth.js'
import {
  getUserDisplayName,
  getUserEmail,
  getUserInitials,
} from '../../../lib/session.js'

function ProfileRow({ label, value }) {
  return (
    <div className="grid gap-1 border-b border-[#eceae3] py-3 last:border-b-0 sm:grid-cols-[180px_1fr]">
      <dt className="text-sm font-medium text-[#676c70]">{label}</dt>
      <dd className="text-sm text-[#202326]">{value || '-'}</dd>
    </div>
  )
}

export function ProfilePage() {
  const { user } = useAuth()
  const isAdmin = user?.type === 'admin'

  return (
    <div>
      <PageHeader
        title="Profile"
        description="Current signed-in account."
        actions={
          <StatusBadge tone={isAdmin ? 'green' : 'neutral'}>
            {isAdmin ? user.role : 'EMPLOYEE'}
          </StatusBadge>
        }
      />

      <div className="rounded-md border border-[#deded7] bg-white shadow-sm">
        <div className="flex items-center gap-4 border-b border-[#e7e4dc] p-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-md bg-[#e8f1ed] text-lg font-semibold text-[#24463f]">
            {getUserInitials(user)}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-[#202326]">
              {getUserDisplayName(user)}
            </h2>
            <p className="truncate text-sm text-[#676c70]">
              {getUserEmail(user)}
            </p>
          </div>
        </div>

        <dl className="p-5">
          {isAdmin ? (
            <>
              <ProfileRow label="Admin ID" value={user.admin_no} />
              <ProfileRow label="Role" value={user.role} />
              <ProfileRow label="Unit ID" value={user.unit_id} />
              <ProfileRow
                label="Write access"
                value={user.can_write_data ? 'Enabled' : 'Disabled'}
              />
              <ProfileRow
                label="Sensitive data"
                value={user.can_view_sensitive_data ? 'Enabled' : 'Disabled'}
              />
            </>
          ) : (
            <>
              <ProfileRow label="Employee ID" value={user?.employment?.employee_id} />
              <ProfileRow label="Unit" value={user?.employment?.unit} />
              <ProfileRow label="Position" value={user?.employment?.job_position} />
              <ProfileRow label="Job Level" value={user?.employment?.job_level} />
              <ProfileRow label="Status" value={user?.status_info?.status} />
            </>
          )}
        </dl>
      </div>
    </div>
  )
}
