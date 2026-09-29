import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpen,
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
import { LiveIndicator } from "../../../components/ui/LiveIndicator.jsx";
import { getUserDisplayName } from "../../../lib/session.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { dashboardApi } from "../api/dashboardApi.js";
import { MetricCard } from "../components/MetricCard.jsx";
import { SectionTitle } from "../components/SectionTitle.jsx";
import { DistributionBars } from "../components/DistributionBars.jsx";
import { BirthdayPanel } from "../components/BirthdayPanel.jsx";
import { TimeTile } from "../components/TimeTile.jsx";
import { GenderMuiDonut } from "../components/GenderDonut.jsx";
import { RestrictedDashboardPanel } from "../components/RestrictedDashboardPanel.jsx";
import {
  canViewAcademic,
  canViewStudents,
  canViewWorkforce,
} from "../../../lib/capabilities.js";
import {
  toChartRows,
  formatGender,
  greetingFor,
  formatTime,
  formatDay,
} from "../utils/dashboardFormatters.js";

export function DashboardPage() {
  const { user } = useAuth();
  // Employee (non-admin) logins are restricted by their own teaching flag -
  // staff sees employee-side metrics only, teachers see everything.
  const isTeacher =
    user?.type === "employee" && Boolean(user?.employment?.is_teaching_role);
  const showStudents =
    user?.type === "admin" ? canViewStudents(user) : isTeacher;
  const showAcademic =
    user?.type === "admin" ? canViewAcademic(user) : isTeacher;
  const showWorkforce =
    user?.type === "admin" ? canViewWorkforce(user) : true;
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
      restricted: !showWorkforce,
      icon: UsersRound,
      tone: "green",
      caption: showWorkforce
        ? summary?.totals.interns > 0
          ? `Employee records available in the central database (including ${summary.totals.interns} intern${summary.totals.interns === 1 ? "" : "s"})`
          : "Employee records available in the central database"
        : "Employee & Intern access is required to view this metric.",
    },
    {
      label: "Total Students",
      value: summary?.totals.students,
      restricted: !showStudents,
      icon: GraduationCap,
      tone: "amber",
      caption: showStudents
        ? "Student records across active and historical cohorts"
        : "Student access is required to view this metric.",
    },
    {
      label: "Active Classes",
      value: summary?.totals.classes,
      restricted: !showAcademic,
      icon: BookOpen,
      tone: "neutral",
      caption: showAcademic
        ? "Classes currently marked active"
        : "Student or Employee & Intern access is required to view this metric.",
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
          <LiveIndicator isSyncing={isSyncing} />
        }
      />

      <div className="grid min-w-0 gap-5">
        <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,0.42fr)] xl:items-center">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <StatusBadge tone="green">Public workspace</StatusBadge>
              </div>
              <h2 className="break-words font-display text-2xl font-extrabold text-(--mws-charcoal)">
                {greetingFor(now)}, {getUserDisplayName(user)}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-(--mws-muted)">
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
        <section className="flex flex-col justify-between min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <SectionTitle
            icon={VenusAndMars}
            title="Gender Distribution"
            caption="General split across employee and student records"
          />

          <div className="grid h-full min-w-0 gap-4 lg:grid-cols-2">
              {showWorkforce ? <GenderMuiDonut title="Employees" rows={employeeGender} /> : (
                <RestrictedDashboardPanel title="Employees" message="Employee & Intern access is required to view this gender distribution." />
              )}
              {showStudents ? <GenderMuiDonut title="Students" rows={studentGender} /> : (
                <RestrictedDashboardPanel title="Students" message="Student access is required to view this gender distribution." />
              )}
          </div>
        </section>

        <BirthdayPanel
          isLoading={isLoading}
          birthdays={summary?.employees.birthdays_this_month || []}
          restricted={!showWorkforce}
        />
      </div>

      <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.42fr)]">
        <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <SectionTitle
            icon={BarChart3}
            title="Age Distribution"
            caption="Age buckets calculated from birth dates"
          />
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            {showWorkforce ? <DistributionBars title="Employees" rows={employeeAges} /> : (
              <RestrictedDashboardPanel title="Employees" message="Employee & Intern access is required to view this age distribution." />
            )}
            {showStudents ? <DistributionBars title="Students" rows={studentAges} /> : (
              <RestrictedDashboardPanel title="Students" message="Student access is required to view this age distribution." />
            )}
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <SectionTitle
            icon={ShieldCheck}
            title="Active Classes"
            caption="Class count grouped by grade"
          />
          {showAcademic ? (
            <DistributionBars title="Classes by grade" rows={classRows} scrollable />
          ) : (
            <RestrictedDashboardPanel title="Active Classes" message="Student or Employee & Intern access is required to view class distribution." />
          )}
        </section>
      </div>
    </div>
  );
}
