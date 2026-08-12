import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpen,
  Cake,
  CalendarDays,
  Clock3,
  GraduationCap,
  ShieldCheck,
  UsersRound,
  VenusAndMars,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { cn } from "../../../lib/cn.js";
import { formatStatus } from "../../../lib/format.js";
import { getUserDisplayName } from "../../../lib/session.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { dashboardApi } from "../api/dashboardApi.js";

export function DashboardPage() {
  const { user } = useAuth();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const dashboardQuery = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: dashboardApi.summary,
  });

  const summary = dashboardQuery.data;
  const isSyncing = dashboardQuery.isFetching;
  const isLoading = dashboardQuery.isLoading;

  const metrics = [
    {
      label: "Total Employees",
      value: summary?.totals.employees,
      icon: UsersRound,
      tone: "green",
      caption: "Employee records available in the central database",
    },
    {
      label: "Total Students",
      value: summary?.totals.students,
      icon: GraduationCap,
      tone: "amber",
      caption: "Student records across active and historical cohorts",
    },
    {
      label: "Active Classes",
      value: summary?.totals.classes,
      icon: BookOpen,
      tone: "neutral",
      caption: "Classes currently marked active",
    },
  ];

  const employeeGender = useMemo(
    () => toChartRows(summary?.employees.by_gender, formatGender),
    [summary],
  );
  const studentGender = useMemo(
    () => toChartRows(summary?.students.by_gender, formatGender),
    [summary],
  );
  const employeeAges = useMemo(
    () => toChartRows(summary?.employees.by_age_bucket),
    [summary],
  );
  const studentAges = useMemo(
    () => toChartRows(summary?.students.by_age_bucket),
    [summary],
  );
  const classRows = useMemo(
    () =>
      (summary?.classes.by_grade || []).map((item) => ({
        label: item.grade_name,
        value: item.total,
      })),
    [summary],
  );

  return (
    <div className="min-w-0">
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${getUserDisplayName(user)}.`}
        actions={
          <StatusBadge tone={isSyncing ? "amber" : "green"}>
            {isSyncing ? "Syncing" : user?.role || "Employee"}
          </StatusBadge>
        }
      />

      <div className="grid min-w-0 gap-5">
        <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,0.42fr)] xl:items-center">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <StatusBadge tone="green">Public workspace</StatusBadge>
                <StatusBadge tone="neutral">
                  {user?.type === "admin"
                    ? formatStatus(user.role)
                    : "Employee"}
                </StatusBadge>
              </div>
              <h2 className="break-words font-display text-2xl font-extrabold text-[var(--mws-charcoal)]">
                {greetingFor(now)}, {getUserDisplayName(user)}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mws-muted)]">
                General school data view for employees, students, active
                classes, age groups, gender split, and staff birthdays.
              </p>
            </div>

            <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <TimeTile
                icon={Clock3}
                label="Local Time"
                value={formatTime(now)}
              />
              <TimeTile
                icon={CalendarDays}
                label="Today"
                value={formatDay(now)}
              />
            </div>
          </div>
        </section>
      </div>

      <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-3">
        {metrics.map((metric) => (
          <MetricCard
            key={metric.label}
            metric={metric}
            isLoading={isLoading}
            isSyncing={isSyncing}
          />
        ))}
      </div>

      <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.42fr)]">
        <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <SectionTitle
            icon={VenusAndMars}
            title="Gender Distribution"
            caption="General split across employee and student records"
          />
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <DistributionBars title="Employees" rows={employeeGender} />
            <DistributionBars title="Students" rows={studentGender} />
          </div>
        </section>

        <BirthdayPanel
          isLoading={isLoading}
          birthdays={summary?.employees.birthdays_this_month || []}
        />
      </div>

      <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.42fr)]">
        <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <SectionTitle
            icon={BarChart3}
            title="Age Distribution"
            caption="Age buckets calculated from birth dates"
          />
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <DistributionBars title="Employees" rows={employeeAges} />
            <DistributionBars title="Students" rows={studentAges} />
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <SectionTitle
            icon={ShieldCheck}
            title="Active Classes"
            caption="Class count grouped by grade"
          />
          <DistributionBars title="Classes by grade" rows={classRows} />
        </section>
      </div>
    </div>
  );
}

function MetricCard({ metric, isLoading, isSyncing }) {
  const Icon = metric.icon;

  return (
    <div className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
          <Icon size={19} />
        </div>
        <StatusBadge tone={isSyncing ? "amber" : metric.tone}>
          {isSyncing ? "Syncing" : "Live"}
        </StatusBadge>
      </div>
      <p className="font-display text-3xl font-extrabold text-[var(--mws-charcoal)]">
        {isLoading ? "-" : formatNumber(metric.value || 0)}
      </p>
      <p className="mt-1 text-sm text-[var(--mws-muted)]">{metric.label}</p>
      <p className="mt-3 text-xs leading-5 text-[var(--mws-muted)]">
        {metric.caption}
      </p>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, caption }) {
  return (
    <div className="mb-4 flex min-w-0 items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#edf4eb] text-[#476b43]">
        <Icon size={19} />
      </div>
      <div className="min-w-0">
        <h2 className="font-display text-base font-bold text-[var(--mws-charcoal)]">
          {title}
        </h2>
        <p className="text-sm leading-6 text-[var(--mws-muted)]">{caption}</p>
      </div>
    </div>
  );
}

function DistributionBars({ title, rows }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="min-w-0 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-4">
      <p className="mb-3 font-display text-sm font-bold text-[var(--mws-charcoal)]">
        {title}
      </p>
      <div className="grid gap-3">
        {rows.length > 0 ? (
          rows.map((row, index) => {
            const percentage = total > 0 ? (row.value / total) * 100 : 0;
            return (
              <div key={row.label} className="min-w-0">
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <span className="truncate font-semibold text-[var(--mws-muted)]">
                    {row.label}
                  </span>
                  <span className="shrink-0 font-bold text-[var(--mws-charcoal)]">
                    {formatNumber(row.value)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      index % 3 === 0 && "bg-[var(--mws-burgundy)]",
                      index % 3 === 1 && "bg-[#476b43]",
                      index % 3 === 2 && "bg-[#d3a22b]",
                    )}
                    style={{
                      width: `${Math.max(percentage, row.value ? 4 : 0)}%`,
                    }}
                  />
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-sm text-[var(--mws-muted)]">No data yet.</p>
        )}
      </div>
    </div>
  );
}

function BirthdayPanel({ birthdays, isLoading }) {
  return (
    <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <SectionTitle
        icon={Cake}
        title="Birthday This Month"
        caption="Current employee birthdays"
      />
      <div className="grid max-h-[24rem] gap-3 overflow-y-auto pr-1">
        {isLoading ? (
          <p className="text-sm text-[var(--mws-muted)]">Loading birthdays...</p>
        ) : birthdays.length > 0 ? (
          birthdays.map((person) => (
            <div
              key={person.id}
              className="min-w-0 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-3"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[var(--mws-charcoal)]">
                    {person.full_name}
                  </p>
                  <p className="mt-1 truncate text-xs text-[var(--mws-muted)]">
                    {person.unit} - {person.job_position}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-[var(--mws-burgundy)]">
                  {person.birthday}
                </span>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-[var(--mws-muted)]">
            No employee birthdays this month.
          </p>
        )}
      </div>
    </section>
  );
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
  );
}

function toChartRows(values, formatLabel = (label) => label) {
  return Object.entries(values || {})
    .map(([label, value]) => ({
      label: formatLabel(label),
      value,
    }))
    .filter((row) => row.value > 0);
}

function formatGender(value) {
  return value === "MALE" ? "Male" : "Female";
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function greetingFor(date) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatDay(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
