import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { formatDate, formatDateTime, formatStatus } from "../../../lib/format.js";
import {
  getUserDisplayName,
  getUserEmail,
  getUserInitials,
} from "../../../lib/session.js";
import { unitsApi } from "../../master-data/api/masterDataApi.js";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";

function ProfileRow({ label, value }) {
  return (
    <div className="grid min-w-0 gap-1 border-b border-(--mws-line) py-3 last:border-b-0 sm:grid-cols-[180px_minmax(0,1fr)]">
      <dt className="text-sm font-medium text-(--mws-muted)">{label}</dt>
      <dd className="break-words text-sm text-(--mws-charcoal)">{value || "-"}</dd>
    </div>
  );
}

function AccessRow({ label, enabled, detail }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 border-b border-(--mws-line) py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-(--mws-charcoal)">{label}</p>
        {detail ? <p className="mt-0.5 text-xs text-(--mws-muted)">{detail}</p> : null}
      </div>
      <StatusBadge tone={enabled ? "green" : "neutral"}>
        {enabled ? "Enabled" : "Disabled"}
      </StatusBadge>
    </div>
  );
}

export function ProfilePage() {
  const { user } = useAuth();
  const isAdmin = user?.type === "admin";
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const myUnitQuery = useQuery({
    queryKey: ["units", user?.unit_id],
    queryFn: () => unitsApi.get(user.unit_id),
    enabled: isAdmin && Boolean(user?.unit_id),
  });

  return (
    <div className="min-w-0">
      <PageHeader title="Profile" description="Current signed-in account." />

      <div className="min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <div className="flex items-center gap-4 border-b border-(--mws-line) p-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#fff4d8] font-display text-lg font-bold text-[#8a6419]">
            {isAdmin && user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              getUserInitials(user)
            )}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-(--mws-charcoal)">
              {getUserDisplayName(user)}
            </h2>
            <p className="truncate text-sm text-(--mws-muted)">
              {getUserEmail(user)}
            </p>
          </div>
        </div>

        <dl className="p-5">
          {isAdmin ? (
            <>
              <ProfileRow label="Admin ID" value={user.admin_no} />
              <ProfileRow label="Role" value={formatStatus(user.role)} />
              <ProfileRow
                label="Unit"
                value={
                  user.unit_id
                    ? myUnitQuery.data?.name || (myUnitQuery.isLoading ? "Loading..." : "-")
                    : "-"
                }
              />
              <ProfileRow
                label="Last Login"
                value={
                  user.last_login ? formatDateTime(user.last_login) : "Never"
                }
              />
              <ProfileRow
                label="Account Created"
                value={formatDate(user.created_at)}
              />

            </>
          ) : (
            <>
              <ProfileRow
                label="Employee ID"
                value={user?.employment?.employee_id}
              />
              <ProfileRow label="Unit" value={user?.employment?.unit} />
              <ProfileRow
                label="Position"
                value={user?.employment?.job_position}
              />
              <ProfileRow
                label="Job Level"
                value={user?.employment?.job_level}
              />
              <ProfileRow label="Status" value={user?.status_info?.status} />
            </>
          )}
        </dl>
      </div>

      {isAdmin ? (
        <section className="mt-5 min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
          <div className="mb-2">
            <h2 className="font-display text-lg font-bold text-(--mws-charcoal)">
              Effective Access
            </h2>
            <p className="mt-1 text-sm text-(--mws-muted)">
              Current domain, task, sensitive-data, and unit permissions.
            </p>
          </div>
          {isSuperAdmin ? (
            <div className="mt-4 rounded-xl border border-[#cfe3cb] bg-[#f2f8f0] px-4 py-3 text-sm font-semibold text-[#476b43]">
              Super Admin has full access to all domains, units, sensitive data, and management actions.
            </div>
          ) : (
            <div className="mt-3 grid gap-x-8 lg:grid-cols-2">
              <div>
                <AccessRow label="View Students" enabled={user.can_view_student_data} detail="Browse student lists and profiles." />
                <AccessRow label="Sensitive Student Data" enabled={user.can_view_sensitive_data} detail="View protected student records and fields." />
                <AccessRow label="Manage Enrollments" enabled={user.can_manage_enrollments} detail="Enroll, move, promote, close, or reactivate class enrollment." />
                <AccessRow label="Write Student Data" enabled={user.can_write_student_data} detail="Create and edit student profiles and student-domain records." />
              </div>
              <div>
                <AccessRow label="View Employees & Interns" enabled={user.can_view_employee_data} detail="Browse employee and intern lists and profiles." />
                <AccessRow label="Employee & Intern PII" enabled={user.can_view_employee_pii} detail="View protected workforce identity and contact data." />
                <AccessRow label="Manage Teacher Assignments" enabled={user.can_manage_teacher_assignments} detail="Assign, move, promote, end, or remove class teacher assignments." />
                <AccessRow label="Write Employee & Intern Data" enabled={user.can_write_employee_data} detail="Create and edit workforce profiles and records." />
              </div>
              <div className="lg:col-span-2">
                <AccessRow label="All Units (View Only)" enabled={user.can_view_all_units} detail={user.can_view_all_units ? "Read access is not limited to the assigned unit." : "Read access is limited to the assigned unit."} />
                <AccessRow
                  label="After-hours Write Grant"
                  enabled={Boolean(user.after_hours_write_until && new Date(user.after_hours_write_until) > new Date())}
                  detail={user.after_hours_write_until ? `Until ${formatDateTime(user.after_hours_write_until)}` : "No temporary write exception."}
                />
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
