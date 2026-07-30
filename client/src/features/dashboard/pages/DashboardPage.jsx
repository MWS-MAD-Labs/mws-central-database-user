import { useQuery } from '@tanstack/react-query'
import { Activity, Database, KeyRound, ShieldCheck } from 'lucide-react'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { getUserDisplayName } from '../../../lib/session.js'
import { employeesApi } from '../../employees/api/employeesApi.js'
import { studentsApi } from '../../students/api/studentsApi.js'

export function DashboardPage() {
  const { user } = useAuth()
  const studentsQuery = useQuery({
    queryKey: ['dashboard', 'students-total'],
    queryFn: () => studentsApi.list({ page: 1, size: 1 }),
  })
  const employeesQuery = useQuery({
    queryKey: ['dashboard', 'employees-total'],
    queryFn: () => employeesApi.list({ page: 1, size: 1 }),
  })

  const metrics = [
    {
      label: 'Total Employees',
      value: formatMetricValue(employeesQuery),
      icon: Activity,
      tone: 'green',
      isFetching: employeesQuery.isFetching,
    },
    {
      label: 'Total Students',
      value: formatMetricValue(studentsQuery),
      icon: Database,
      tone: 'amber',
      isFetching: studentsQuery.isFetching,
    },
    { label: 'API Clients', value: '-', icon: KeyRound, tone: 'neutral' },
  ]

  return (
    <div className="min-w-0">
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${getUserDisplayName(user)}.`}
        actions={<StatusBadge tone="green">{user?.role}</StatusBadge>}
      />

      <div className="grid min-w-0 gap-4 md:grid-cols-3">
        {metrics.map((metric) => {
          const Icon = metric.icon
          return (
            <div
              key={metric.label}
              className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]"
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
                  <Icon size={19} />
                </div>
                <StatusBadge tone={metric.isFetching ? 'amber' : metric.tone}>
                  {metric.isFetching ? 'Syncing' : 'Live'}
                </StatusBadge>
              </div>
              <p className="font-display text-3xl font-extrabold text-[var(--mws-charcoal)]">
                {metric.value}
              </p>
              <p className="mt-1 text-sm text-[var(--mws-muted)]">{metric.label}</p>
            </div>
          )
        })}
      </div>

      <div className="mt-6 min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#edf4eb] text-[#476b43]">
            <ShieldCheck size={19} />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-[var(--mws-charcoal)]">
              Session active
            </h2>
            <p className="text-sm leading-6 text-[var(--mws-muted)]">
              Authenticated as {user?.type === 'admin' ? user.role : 'employee'}.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatMetricValue(query) {
  if (query.isLoading) return '-'
  return new Intl.NumberFormat('en-US').format(query.data?.paging?.total_item || 0)
}
