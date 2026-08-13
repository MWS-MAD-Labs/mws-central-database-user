import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Edit,
  GraduationCap,
  Mail,
  RefreshCw,
  Trash2,
  UserRound,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { EnrollmentHistoryPanel } from "../../academic/components/EnrollmentHistoryPanel.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { loadStudentFormOptions } from "../api/studentFormOptions.js";
import { studentsApi, studentEntryTypes } from "../api/studentsApi.js";
import { SearchableSelect } from "../../../components/ui/FormControls.jsx";
import {
  StudentConsentPanel,
  StudentHealthPanel,
  StudentParentsPanel,
  StudentPcActivitiesPanel,
  StudentSupportAssignmentPanel,
  StudentVaccinePanel,
} from "../components/StudentSensitivePanels.jsx";
import { formatDate, formatStatus, statusTone } from "../../../lib/format.js";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { useState } from "react";
import { DetailRow } from "../components/DetailRow.jsx";
import { ServiceBadge } from "../components/ServiceBadge.jsx";
import { getClassName, getYearName } from "../format.js";

export function StudentDetailPage() {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [isReissueModalOpen, setIsReissueModalOpen] = useState(false);
  // Starts blank on purpose - import defaults entry_type to PSB for legacy
  // rows whose real value was never confirmed, so this must be an explicit
  // admin choice each time, not silently reused from the stored value.
  const [reissueEntryType, setReissueEntryType] = useState("");

  const studentQuery = useQuery({
    queryKey: ["students", studentId],
    queryFn: () => studentsApi.get(studentId),
    enabled: Boolean(studentId),
  });

  const optionsQuery = useQuery({
    queryKey: ["student-form-options"],
    queryFn: loadStudentFormOptions,
  });

  const deleteMutation = useMutation({
    mutationFn: () => studentsApi.remove(studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students"] });
      navigate("/students?is_deleted=true", { replace: true });
    },
  });

  const reissueNisMutation = useMutation({
    mutationFn: () => studentsApi.reissueNis(studentId, reissueEntryType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students", studentId] });
    },
  });

  const student = studentQuery.data;
  const className = getClassName(
    optionsQuery.data?.classes || [],
    student?.academic?.current_class_id,
  );
  const joinYearName = getYearName(
    optionsQuery.data?.academicYears || [],
    student?.academic?.join_academic_year_id,
  );
  // Mirrors student-service.ts's update() and the parents/consent/health/
  // vaccine/pc-activity services' assertWriteAllowed() - all of them now
  // require can_write_data AND the student's current grade to be in the
  // DB Admin's own unit (assertStudentInAdminUnit).
  const studentGrade = (optionsQuery.data?.grades || []).find(
    (grade) => grade.name === student?.academic?.current_grade,
  );
  const canWrite =
    (user?.role === "SUPER_ADMIN" ||
      (user?.role === "DATABASE_ADMIN" && Boolean(user?.can_write_data))) &&
    (user?.role === "SUPER_ADMIN" || studentGrade?.unit_id === user?.unit_id);
  const canDelete = user?.role === "SUPER_ADMIN";
  // Mirrors sensitive-data.ts's canViewSensitiveData() - health record,
  // health notes, vaccine records, and consent attachments all reject
  // anyone who fails this check, regardless of write access.
  const canViewSensitive =
    user?.role === "SUPER_ADMIN" || Boolean(user?.can_view_sensitive_data);

  function handleDelete() {
    const confirmed = window.confirm(
      "Archive this student? You can restore it from the trash bin.",
    );
    if (confirmed) {
      deleteMutation.mutate();
    }
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title={student?.identity?.full_name || "Student Detail"}
        description={
          student
            ? `${student.academic.nis || "No NIS yet"} / ${student.academic.current_grade}`
            : "Student identity and academic record."
        }
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to="/students">
                <ArrowLeft size={16} />
                Back
              </Link>
            </Button>
            {canWrite ? (
              <Button asChild variant="secondary">
                <Link to={`/students/${studentId}/edit`}>
                  <Edit size={16} />
                  Edit
                </Link>
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                type="button"
                variant="danger"
                disabled={deleteMutation.isPending}
                onClick={handleDelete}
              >
                <Trash2 size={16} />
                Archive
              </Button>
            ) : null}
          </>
        }
      />

      {studentQuery.isLoading ? (
        <PanelMessage>Loading student...</PanelMessage>
      ) : studentQuery.isError ? (
        <PanelMessage>Student data is unavailable.</PanelMessage>
      ) : student ? (
        <div className="min-w-0 space-y-5">
          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
            <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
              <div className="flex items-center gap-4 border-b border-[var(--mws-line)] p-5">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
                  <UserRound size={24} />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-[var(--mws-charcoal)]">
                    {student.identity.full_name}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusBadge tone={statusTone(student.status)}>
                      {formatStatus(student.status)}
                    </StatusBadge>
                    <StatusBadge tone="neutral">
                      {student.academic.current_grade}
                    </StatusBadge>
                  </div>
                </div>
              </div>

              <dl className="p-5">
                <DetailRow
                  label="Nick name"
                  value={student.identity.nick_name}
                />
                <DetailRow label="Email" value={student.identity.email} />
                <DetailRow
                  label="NIS"
                  value={
                    student.academic.nis || (
                      <span className="flex items-center gap-2">
                        <span className="text-[var(--mws-muted)]">
                          Not yet assigned
                        </span>
                        {canDelete ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={reissueNisMutation.isPending}
                            onClick={() => {
                              setReissueEntryType("");
                              setIsReissueModalOpen(true);
                            }}
                          >
                            <RefreshCw size={14} />
                            Reissue NIS
                          </Button>
                        ) : null}
                      </span>
                    )
                  }
                />
                {student.academic.legacy_nis ? (
                  <DetailRow
                    label="Legacy NIS"
                    value={student.academic.legacy_nis}
                  />
                ) : null}
                <DetailRow label="NISN" value={student.academic.nisn} />
                <DetailRow
                  label="Current grade"
                  value={student.academic.current_grade}
                />
                <DetailRow label="Current class" value={className} />
                <DetailRow label="Join academic year" value={joinYearName} />
                <DetailRow
                  label="Join grade"
                  value={student.academic.join_grade}
                />
                <DetailRow
                  label="Entry type"
                  value={
                    student.academic.entry_type === "PSB"
                      ? "PSB"
                      : formatStatus(student.academic.entry_type)
                  }
                />
                <DetailRow
                  label="Previous school"
                  value={student.academic.previous_school}
                />
                <DetailRow
                  label="Created at"
                  value={formatDate(student.created_at)}
                />
              </dl>
            </section>

            <div className="min-w-0 space-y-5">
              <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
                <div className="mb-4 flex items-center gap-3">
                  <Mail size={18} className="text-[var(--mws-burgundy)]" />
                  <h2 className="text-base font-semibold text-[var(--mws-charcoal)]">
                    Contact
                  </h2>
                </div>
                <p className="truncate rounded-xl border border-[var(--mws-line)] px-3 py-2 text-sm text-[var(--mws-charcoal)]">
                  {student.identity.email}
                </p>
              </section>

              {"gender" in student.identity ? (
                <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
                  <h2 className="mb-4 text-base font-semibold text-[var(--mws-charcoal)]">
                    Profile Details
                  </h2>
                  <dl>
                    <DetailRow
                      compact
                      label="Gender"
                      value={formatStatus(student.identity.gender)}
                    />
                    <DetailRow
                      compact
                      label="Religion"
                      value={formatStatus(student.identity.religion)}
                    />
                    <DetailRow
                      compact
                      label="Birth place"
                      value={student.identity.birth_place}
                    />
                    <DetailRow
                      compact
                      label="Birth date"
                      value={formatDate(student.identity.birth_date)}
                    />
                    <DetailRow
                      compact
                      label="Graduation grade"
                      value={student.academic.graduation_grade}
                    />
                    <DetailRow
                      compact
                      label="Leave year"
                      value={student.academic.leave_year}
                    />
                    <DetailRow compact label="SN" value={student.academic.sn} />
                  </dl>
                </section>
              ) : null}

              {"pickup_drop_service" in student.academic ? (
                <section className="min-w-0 rounded-2xl border border-[var(--mws-line)] bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
                  <div className="mb-4 flex items-center gap-3">
                    <GraduationCap
                      size={18}
                      className="text-[var(--mws-burgundy)]"
                    />
                    <h2 className="text-base font-semibold text-[var(--mws-charcoal)]">
                      Services
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ServiceBadge
                      label="Pickup/drop"
                      active={student.academic.pickup_drop_service}
                    />
                    <ServiceBadge
                      label="Catering"
                      active={student.academic.catering_service}
                    />
                    <ServiceBadge
                      label="PSB guide"
                      active={student.academic.psb_guide}
                    />
                  </div>
                </section>
              ) : null}
            </div>
          </div>
          <EnrollmentHistoryPanel studentId={studentId} />
          {/* phone/email/address are gated by can_view_sensitive_data on
              both read (toParentGuardianResponse) and write (parent-
              guardian-service.ts) - fold it into the write gate here. */}
          <StudentParentsPanel
            studentId={studentId}
            canWrite={canWrite && canViewSensitive}
          />
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <StudentConsentPanel
              studentId={studentId}
              canWrite={canWrite}
              canViewSensitive={canViewSensitive}
            />
            <StudentHealthPanel
              studentId={studentId}
              canWrite={canWrite}
              canViewSensitive={canViewSensitive}
            />
          </div>
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <StudentVaccinePanel
              studentId={studentId}
              canWrite={canWrite}
              canViewSensitive={canViewSensitive}
            />
            <StudentPcActivitiesPanel
              studentId={studentId}
              canWrite={canWrite}
            />
          </div>
          <StudentSupportAssignmentPanel
            studentId={studentId}
            canWrite={canWrite && user?.role === "SUPER_ADMIN"}
          />
        </div>
      ) : null}
      {isReissueModalOpen && (
        <CrudDialog
          title="Reissue NIS"
          description="This action will generate a permanent NIS based on the student's current academic data."
          isOpen={isReissueModalOpen}
          onClose={() => setIsReissueModalOpen(false)}
        >
          <div className="space-y-4">
            <div className="space-y-3 rounded-lg bg-[var(--mws-soft)] p-4 text-sm text-[var(--mws-charcoal)]">
              <p>
                Please ensure the following data is correct before proceeding:
              </p>
              <ul className="list-inside list-disc font-medium text-[var(--mws-muted)]">
                <li>
                  Join Grade:{" "}
                  <span className="text-[var(--mws-charcoal)]">
                    {student?.academic?.join_grade}
                  </span>
                </li>
                <li>
                  Join Year:{" "}
                  <span className="text-[var(--mws-charcoal)]">
                    {joinYearName}
                  </span>
                </li>
              </ul>
              <p className="font-semibold text-red-600">
                Warning: The NIS cannot be changed once generated.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--mws-charcoal)]">
                Confirm Entry Type
              </label>
              <SearchableSelect
                required
                value={reissueEntryType}
                onChange={setReissueEntryType}
                options={studentEntryTypes.map((option) => ({
                  value: option,
                  label: option,
                }))}
                placeholder="Select entry type"
                searchPlaceholder="Search entry type"
              />
              <p className="text-xs text-[var(--mws-muted)]">
                Import defaults legacy rows to PSB whether or not that's
                correct - pick the real value before generating a permanent
                NIS.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                disabled={reissueNisMutation.isPending}
                onClick={() => setIsReissueModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={reissueNisMutation.isPending || !reissueEntryType}
                onClick={() => {
                  reissueNisMutation.mutate(undefined, {
                    onSuccess: () => setIsReissueModalOpen(false),
                  });
                }}
              >
                <RefreshCw
                  size={14}
                  className={reissueNisMutation.isPending ? "animate-spin" : ""}
                />
                {reissueNisMutation.isPending
                  ? "Generating..."
                  : "Generate NIS"}
              </Button>
            </div>
          </div>
        </CrudDialog>
      )}
    </div>
  );
}



