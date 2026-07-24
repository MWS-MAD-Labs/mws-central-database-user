import { Activity, Database, KeyRound, ShieldCheck } from 'lucide-react'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { getUserDisplayName } from '../../../lib/session.js'

const metrics = [
  { label: 'Employees', value: '-', icon: Activity, tone: 'green' },
  { label: 'Students', value: '-', icon: Database, tone: 'amber' },
  { label: 'API Clients', value: '-', icon: KeyRound, tone: 'neutral' },
]

export function DashboardPage() {
  const { user } = useAuth()

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${getUserDisplayName(user)}.`}
        actions={<StatusBadge tone="green">{user?.role}</StatusBadge>}
      />

      <div className="grid gap-4 md:grid-cols-3">
        {metrics.map((metric) => {
          const Icon = metric.icon
          return (
            <div
              key={metric.label}
              className="rounded-md border border-[#deded7] bg-white p-5 shadow-sm"
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#edf2ee] text-[#24463f]">
                  <Icon size={19} />
                </div>
                <StatusBadge tone={metric.tone}>Live</StatusBadge>
              </div>
              <p className="text-3xl font-semibold text-[#202326]">
                {metric.value}
              </p>
              <p className="mt-1 text-sm text-[#676c70]">{metric.label}</p>
            </div>
          )
        })}
      </div>

      <div className="mt-6 rounded-md border border-[#deded7] bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#e8f1ed] text-[#24463f]">
            <ShieldCheck size={19} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#202326]">
              Session active
            </h2>
            <p className="text-sm text-[#676c70]">
              Authenticated as {user?.type === 'admin' ? user.role : 'employee'}.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
