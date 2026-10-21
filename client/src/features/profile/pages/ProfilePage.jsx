import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "../../../components/ui/Button.jsx";
import { PhotoCropDialog } from "../../../components/photo/PhotoCropDialog.jsx";
import { employeesApi } from "../../employees/api/employeesApi.js";
import { MAX_PHOTO_SIZE_BYTES, validateFileSize } from "../../../lib/fileSize.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
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
import { Tabs } from "../../../components/ui/Tabs.jsx";
import { TextAction } from "../../../components/ui/TextAction.jsx";
import { EmploymentPanel, FamilyPanel, PersonalPanel } from "../components/OwnEmployeePanels.jsx";

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

function unitScopeDetail(user, domain, unitNames) {
  const canView = domain === "student"
    ? user.can_view_student_data
    : user.can_view_employee_data;
  if (!canView) return "Domain view access is disabled.";

  const allUnits = domain === "student"
    ? user.can_view_all_student_units
    : user.can_view_all_employee_units;
  if (allUnits) return "All units.";

  const unitIds = domain === "student"
    ? user.student_view_unit_ids || []
    : user.employee_view_unit_ids || [];
  if (unitIds.length === 0) return "Assigned unit only.";

  return unitIds.map((id) => unitNames.get(id) || id).join(", ");
}

export function ProfilePage() {
  const { user } = useAuth();
  const isAdmin = user?.type === "admin";
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const queryClient = useQueryClient();
  const photoInputRef = useRef(null);
  const [cropFile, setCropFile] = useState(null);
  // An employee changes their own photo, and Google follows. Nobody else can.
  const ownPhoto = useMutation({
    mutationFn: (file) => employeesApi.uploadOwnPhoto(file),
    onSuccess: () => {
      setCropFile(null);
      queryClient.invalidateQueries();
      showSuccessToast("Photo updated.");
    },
    onError: (error) => showErrorToast(error, "Photo upload failed."),
  });

  const myUnitQuery = useQuery({
    queryKey: ["units", user?.unit_id],
    queryFn: () => unitsApi.get(user.unit_id),
    enabled: isAdmin && Boolean(user?.unit_id),
  });
  const customUnitIds = [
    ...(user?.student_view_unit_ids || []),
    ...(user?.employee_view_unit_ids || []),
  ];
  const scopeUnitsQuery = useQuery({
    queryKey: ["units", "profile-scope"],
    queryFn: () => unitsApi.list({ page: 1, size: 100 }),
    enabled: isAdmin && customUnitIds.length > 0,
  });
  const unitNames = new Map(
    (scopeUnitsQuery.data?.data || []).map((unit) => [unit.id, unit.name]),
  );

  // The person's own employee record. An admin is made from an employee, so it is theirs when the link exists.
  const isEmployee = user?.type === "employee";
  const employeeId = isAdmin ? user?.employee_id : null;
  const hasRecord = isEmployee || Boolean(employeeId);
  const recordQuery = useQuery({
    queryKey: ["profile", "employee", isAdmin ? employeeId : "me"],
    queryFn: () => (isAdmin ? employeesApi.get(employeeId) : employeesApi.getOwn()),
    enabled: hasRecord,
  });
  const employee = recordQuery.data ?? null;
  const [pii, setPii] = useState(null);
  const revealPii = useMutation({
    mutationFn: () => (isAdmin ? employeesApi.recordSensitiveFieldsAccess(employeeId) : employeesApi.revealOwnSensitiveFields()),
    onSuccess: setPii,
    onError: (error) => showErrorToast(error, "Could not show the sensitive details."),
  });
  const tabs = [
    { id: "overview", label: "Overview" },
    ...(employee
      ? [
          { id: "personal", label: "Personal" },
          { id: "employment", label: "Employment" },
          { id: "family", label: "Family" },
        ]
      : []),
    ...(isAdmin ? [{ id: "access", label: "Access" }] : []),
  ];
  const [tab, setTab] = useState("overview");
  const activeTab = tabs.some((item) => item.id === tab) ? tab : "overview";
  const piiPanel = { employee, pii, revealed: Boolean(pii), revealing: revealPii.isPending, onShow: () => revealPii.mutate(), onHide: () => setPii(null) };

  return (
    <div className="min-w-0">
      <PageHeader
        title="Profile"
        description="Current signed-in account."
        actions={
          hasRecord ? (
            <TextAction asChild>
              <Link to="/change-requests/mine">Request a Change</Link>
            </TextAction>
          ) : null
        }
      />

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
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-(--mws-charcoal)">
              {getUserDisplayName(user)}
            </h2>
            <p className="truncate text-sm text-(--mws-muted)">
              {getUserEmail(user)}
            </p>
          </div>
          {!isAdmin && user?.type === "employee" ? (
            <>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                data-testid="own-photo-input"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  const problem = validateFileSize(file, MAX_PHOTO_SIZE_BYTES);
                  if (problem) return showErrorToast(new Error(problem));
                  setCropFile(file);
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Change photo"
                title="Change photo"
                onClick={() => photoInputRef.current?.click()}
              >
                <Camera size={16} />
              </Button>
            </>
          ) : null}
        </div>
        {cropFile ? (
          <PhotoCropDialog
            file={cropFile}
            isSaving={ownPhoto.isPending}
            onCancel={() => setCropFile(null)}
            onCropped={(blob) => ownPhoto.mutate(blob)}
          />
        ) : null}

        {activeTab === "overview" ? (
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
        ) : null}
        {activeTab === "overview" && isAdmin && !employeeId ? (
          <p role="note" className="border-t border-(--mws-line) px-5 py-4 text-sm text-(--mws-muted)" data-testid="no-employee-note">
            No employee record is linked to this admin. Add the employee with the same email, then reload this page.
          </p>
        ) : null}
      </div>

      {tabs.length > 1 ? (
        <div className="mt-5">
          <Tabs label="Profile sections" tabs={tabs} active={activeTab} onChange={setTab} />
        </div>
      ) : null}

      {hasRecord && recordQuery.isError && activeTab !== "overview" && activeTab !== "access" ? (
        <p className="mt-5 text-sm text-(--mws-muted)">Your employee record is unavailable.</p>
      ) : null}
      {employee && activeTab === "personal" ? <div className="mt-5"><PersonalPanel {...piiPanel} /></div> : null}
      {employee && activeTab === "employment" ? <div className="mt-5"><EmploymentPanel employee={employee} /></div> : null}
      {employee && activeTab === "family" ? <div className="mt-5"><FamilyPanel {...piiPanel} /></div> : null}

      {isAdmin && activeTab === "access" ? (
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
                <AccessRow label="Employee Disciplinary Data" enabled={user.can_view_employee_disciplinary_data} detail="View disciplinary actions and active attachments within the permitted unit scope." />
                <AccessRow label="Manage Teacher Assignments" enabled={user.can_manage_teacher_assignments} detail="Assign, move, promote, end, or remove class teacher assignments." />
                <AccessRow label="Write Employee & Intern Data" enabled={user.can_write_employee_data} detail="Create and edit workforce profiles and records." />
              </div>
              <div className="lg:col-span-2">
                <AccessRow
                  label="Student Units"
                  enabled={user.can_view_student_data}
                  detail={unitScopeDetail(user, "student", unitNames)}
                />
                <AccessRow
                  label="Employee Units"
                  enabled={user.can_view_employee_data}
                  detail={unitScopeDetail(user, "employee", unitNames)}
                />
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
