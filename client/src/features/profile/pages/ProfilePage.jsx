import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import {
  getUserDisplayName,
  getUserEmail,
  getUserInitials,
} from "../../../lib/session.js";

function ProfileRow({ label, value }) {
  return (
    <div className="grid min-w-0 gap-1 border-b border-[var(--mws-line)] py-3 last:border-b-0 sm:grid-cols-[180px_minmax(0,1fr)]">
      <dt className="text-sm font-medium text-[var(--mws-muted)]">{label}</dt>
      <dd className="break-words text-sm text-[var(--mws-charcoal)]">{value || "-"}</dd>
    </div>
  );
}

export function ProfilePage() {
  const { user } = useAuth();
  const isAdmin = user?.type === "admin";
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  return (
    <div className="min-w-0">
      <PageHeader
        title="Profile"
        description="Current signed-in account."
        actions={
          <StatusBadge tone={isAdmin ? "green" : "neutral"}>
            {isAdmin ? user.role : "EMPLOYEE"}
          </StatusBadge>
        }
      />

      <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <div className="flex items-center gap-4 border-b border-[var(--mws-line)] p-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#fff4d8] font-display text-lg font-bold text-[#8a6419]">
            {getUserInitials(user)}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-[var(--mws-charcoal)]">
              {getUserDisplayName(user)}
            </h2>
            <p className="truncate text-sm text-[var(--mws-muted)]">
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

              {!isSuperAdmin && (
                <>
                  <ProfileRow
                    label="Write Access"
                    value={user.can_write_data ? "Enabled" : "Disabled"}
                  />
                  <ProfileRow
                    label="Sensitive Data"
                    value={
                      user.can_view_sensitive_data ? "Enabled" : "Disabled"
                    }
                  />
                  <ProfileRow
                    label="All Units"
                    value={user.can_view_all_units ? "Enabled" : "Disabled"}
                  />
                  <ProfileRow
                    label="Employee PII"
                    value={
                      user.can_view_employee_pii ? "Enabled" : "Disabled"
                    }
                  />
                  <ProfileRow
                    label="Write Employee Data"
                    value={
                      user.can_write_employee_data ? "Enabled" : "Disabled"
                    }
                  />
                  <ProfileRow
                    label="Write Student Data"
                    value={
                      user.can_write_student_data ? "Enabled" : "Disabled"
                    }
                  />
                </>
              )}
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
    </div>
  );
}
