import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  CalendarDays,
  Clock3,
  Database,
  GraduationCap,
  KeyRound,
  ShieldCheck,
  UsersRound,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { getUserDisplayName } from '../../../lib/session.js'
import { employeesApi } from '../../employees/api/employeesApi.js'
import { studentsApi } from '../../students/api/studentsApi.js'
import { apiClientsApi } from '../../api-clients/api/apiClientsApi.js'
import { formatStatus } from '../../../lib/format.js'

export function DashboardPage() {
  const { user } = useAuth()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(intervalId)
  }, [])

  const studentsQuery = useQuery({
    queryKey: ['dashboard', 'students-total'],
    queryFn: () => studentsApi.list({ page: 1, size: 1 }),
  })
  const employeesQuery = useQuery({
    queryKey: ['dashboard', 'employees-total'],
    queryFn: () => employeesApi.list({ page: 1, size: 1 }),
  })
  const apiClientsQuery = useQuery({
    queryKey: ['dashboard', 'api-clients-total'],
    queryFn: apiClientsApi.list,
    enabled: user?.role === 'SUPER_ADMIN',
  })

  const calendarDays = useMemo(() => buildCalendarDays(now), [now])
  const canWrite =
    user?.role === 'SUPER_ADMIN' ||
    (user?.role === 'DATABASE_ADMIN' && Boolean(user?.can_write_data))
  const apiClientsTotal =
    user?.role === 'SUPER_ADMIN'
      ? formatListMetricValue(apiClientsQuery)
      : 'Restricted'

  const metrics = [
    {
      label: 'Total Employees',
      value: formatMetricValue(employeesQuery),
      icon: Activity,
      tone: 'green',
      isFetching: employeesQuery.isFetching,
      caption: 'Employee records in the central database',
    },
    {
      label: 'Total Students',
      value: formatMetricValue(studentsQuery),
      icon: Database,
      tone: 'amber',
      isFetching: studentsQuery.isFetching,
      caption: 'Student records across academic years',
    },
    {
      label: 'API Clients',
      value: apiClientsTotal,
      icon: KeyRound,
      tone: 'neutral',
      isFetching: apiClientsQuery.isFetching,
      caption: 'Scoped tokens for internal applications',
    },
  ]

  return (
    <div className="min-w-0">
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${getUserDisplayName(user)}.`}
        actions={<StatusBadge tone="green">{user?.role}</StatusBadge>}
      />

      <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.38fr)]">
        <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,0.42fr)] xl:items-center">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <StatusBadge tone="green">Live workspace</StatusBadge>
                <StatusBadge tone="neutral">
                  {user?.type === 'admin' ? formatStatus(user.role) : 'Employee'}
                </StatusBadge>
              </div>
              <h2 className="break-words font-display text-2xl font-extrabold text-[var(--mws-charcoal)]">
                {greetingFor(now)}, {getUserDisplayName(user)}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mws-muted)]">
                Centralized view for employee, student, academic, access, and internal API data.
              </p>
            </div>

            <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <TimeTile icon={Clock3} label="Local Time" value={formatTime(now)} />
              <TimeTile icon={CalendarDays} label="Today" value={formatDay(now)} />
            </div>
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
                <CalendarDays size={19} />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-base font-bold text-[var(--mws-charcoal)]">
                  {formatMonthYear(now)}
                </h2>
                <p className="text-xs text-[var(--mws-muted)]">
                  Academic operations calendar
                </p>
              </div>
            </div>
          </div>
          <MiniCalendar days={calendarDays} today={now.getDate()} />
        </section>
      </div>

      <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-3">
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
              <p className="mt-3 text-xs leading-5 text-[var(--mws-muted)]">
                {metric.caption}
              </p>
            </div>
          )
        })}
      </div>

      <div className="mt-5 grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)]">
        <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <div className="mb-4 flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#edf4eb] text-[#476b43]">
              <ShieldCheck size={19} />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-[var(--mws-charcoal)]">
                Session active
              </h2>
              <p className="text-sm leading-6 text-[var(--mws-muted)]">
                Authenticated as {user?.type === 'admin' ? formatStatus(user.role) : 'employee'}.
              </p>
            </div>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            <SessionFact label="Account type" value={user?.type === 'admin' ? 'Admin' : 'Employee'} />
            <SessionFact label="Write access" value={canWrite ? 'Available' : 'Read only'} />
            <SessionFact label="Sensitive data" value={user?.can_view_sensitive_data || user?.role === 'SUPER_ADMIN' ? 'Allowed' : 'Restricted'} />
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <h2 className="mb-4 font-display text-base font-bold text-[var(--mws-charcoal)]">
            Quick Actions
          </h2>
          <div className="grid gap-2">
            <Button asChild variant="secondary" className="justify-start">
              <Link to="/students">
                <GraduationCap size={16} />
                Review students
              </Link>
            </Button>
            <Button asChild variant="secondary" className="justify-start">
              <Link to="/employees">
                <UsersRound size={16} />
                Review employees
              </Link>
            </Button>
            {user?.role === 'SUPER_ADMIN' ? (
              <Button asChild variant="secondary" className="justify-start">
                <Link to="/api-clients">
                  <KeyRound size={16} />
                  Manage API clients
                </Link>
              </Button>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}

function TimeTile({ icon: Icon, label, value }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-4">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-[var(--mws-burgundy)]">
        <Icon size={17} />
      </div>
      <p className="text-xs font-semibold text-[var(--mws-muted)]">{label}</p>
      <p className="mt-1 truncate font-display text-lg font-bold text-[var(--mws-charcoal)]">
        {value}
      </p>
    </div>
  )
}

function MiniCalendar({ days, today }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-[var(--mws-muted)]">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
          <span key={`${day}-${index}`}>{day}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, index) => (
          <div
            key={`${day || 'blank'}-${index}`}
            className={[
              'flex aspect-square items-center justify-center rounded-lg text-xs font-semibold',
              day === today
                ? 'bg-[var(--mws-burgundy)] text-white'
                : day
                  ? 'bg-[var(--mws-soft)] text-[var(--mws-charcoal)]'
                  : 'bg-transparent',
            ].join(' ')}
          >
            {day || ''}
          </div>
        ))}
      </div>
    </div>
  )
}

function SessionFact({ label, value }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-3">
      <p className="text-xs font-semibold text-[var(--mws-muted)]">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-[var(--mws-charcoal)]">
        {value}
      </p>
    </div>
  )
}

function formatMetricValue(query) {
  if (query.isLoading) return '-'
  return new Intl.NumberFormat('en-US').format(query.data?.paging?.total_item || 0)
}

function formatListMetricValue(query) {
  if (query.isLoading) return '-'
  return new Intl.NumberFormat('en-US').format(query.data?.length || 0)
}

function formatTime(date) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function formatDay(date) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(date)
}

function formatMonthYear(date) {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function greetingFor(date) {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function buildCalendarDays(date) {
  const year = date.getFullYear()
  const month = date.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const totalDays = new Date(year, month + 1, 0).getDate()
  return [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: totalDays }, (_, index) => index + 1),
  ]
}
