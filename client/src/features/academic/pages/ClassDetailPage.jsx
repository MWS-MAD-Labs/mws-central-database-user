import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, GraduationCap, Users } from "lucide-react";
import { Link, useParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { formatDate, formatStatus, statusTone } from "../../../lib/format.js";
import { classesApi, enrollmentsApi } from "../api/academicApi.js";
import { studentSensitiveApi } from "../../students/api/studentSensitiveApi.js";

const TEACHER_ROLE_LABELS = {
  HOMEROOM: "Homeroom",
  SUPPORTING_HOMEROOM: "Supporting Homeroom",
  SUBJECT_TEACHER: "Subject Teacher",
};

export function ClassDetailPage() {
  const { classId } = useParams();

  const classQuery = useQuery({
    queryKey: ["classes", classId],
    queryFn: () => classesApi.get(classId),
    enabled: Boolean(classId),
  });

  const teachersQuery = useQuery({
    queryKey: ["classes", classId, "teacher-assignments"],
    queryFn: () => classesApi.teacherAssignments(classId),
    enabled: Boolean(classId),
  });

  const enrollmentsQuery = useQuery({
    queryKey: ["enrollments", { class_id: classId }],
    queryFn: () =>
      enrollmentsApi.list({ class_id: classId, page: 1, size: 100 }),
    enabled: Boolean(classId),
  });

  const klass = classQuery.data;
  const teachers = teachersQuery.data || [];
  const students = enrollmentsQuery.data?.data || [];
  const studentIds = students.map((enrollment) => enrollment.student.id);

  // Which enrolled students already have an active SPECIAL_ED teacher - a
  // quick "does this student still need one" signal without leaving this
  // page, since the actual assign/end flow lives on the student's own page.
  const activeSupportQuery = useQuery({
    queryKey: ["support-assignments", "active-student-ids", studentIds],
    queryFn: () => studentSensitiveApi.getActiveSupportStudentIds(studentIds),
    enabled: studentIds.length > 0,
  });
  const activeSupportStudentIds = new Set(activeSupportQuery.data || []);

  return (
    <div className="min-w-0">
      <PageHeader
        title={klass?.name || "Class Detail"}
        description={
          klass
            ? `${klass.grade.name} / ${klass.academic_year.name}`
            : "Class roster: students and teachers."
        }
        actions={
          <Button asChild variant="secondary">
            <Link to="/academic?tab=classes">
              <ArrowLeft size={16} />
              Back
            </Link>
          </Button>
        }
      />

      {klass ? (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <StatusBadge tone={statusTone(klass.status)}>
            {formatStatus(klass.status)}
          </StatusBadge>
          <span className="text-sm text-[var(--mws-muted)]">
            {klass.active_enrollment_count} active student
            {klass.active_enrollment_count === 1 ? "" : "s"}
            {klass.capacity ? ` / ${klass.capacity} capacity` : ""}
          </span>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--mws-line)] bg-white p-5">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-[var(--mws-charcoal)]">
            <GraduationCap size={18} />
            Teachers
          </h2>
          {teachersQuery.isLoading ? (
            <PanelMessage>Loading teachers…</PanelMessage>
          ) : teachers.length === 0 ? (
            <PanelMessage>No teachers assigned to this class.</PanelMessage>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-bold text-[var(--mws-muted)]">
                <tr>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">Role</th>
                  <th className="px-2 py-2">Subject</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {teachers.map((assignment) => (
                  <tr
                    key={assignment.id}
                    className="border-t border-[var(--mws-line)]"
                  >
                    <td className="px-2 py-2 font-semibold text-[var(--mws-charcoal)]">
                      {assignment.employee.full_name}
                    </td>
                    <td className="px-2 py-2">
                      {TEACHER_ROLE_LABELS[assignment.role] || assignment.role}
                    </td>
                    <td className="px-2 py-2">{assignment.subject || "—"}</td>
                    <td className="px-2 py-2">
                      <StatusBadge
                        tone={assignment.end_date ? "neutral" : "success"}
                      >
                        {assignment.end_date
                          ? `Ended ${formatDate(assignment.end_date)}`
                          : "Active"}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--mws-line)] bg-white p-5">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-[var(--mws-charcoal)]">
            <Users size={18} />
            Students
          </h2>
          {enrollmentsQuery.isLoading ? (
            <PanelMessage>Loading students…</PanelMessage>
          ) : students.length === 0 ? (
            <PanelMessage>No students enrolled in this class.</PanelMessage>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-bold text-[var(--mws-muted)]">
                <tr>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">NIS</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">SE Teacher</th>
                </tr>
              </thead>
              <tbody>
                {students.map((enrollment) => (
                  <tr
                    key={enrollment.id}
                    className="border-t border-[var(--mws-line)]"
                  >
                    <td className="px-2 py-2 font-semibold text-[var(--mws-charcoal)]">
                      <Link
                        to={`/students/${enrollment.student.id}`}
                        className="hover:underline"
                      >
                        {enrollment.student.full_name}
                      </Link>
                    </td>
                    <td className="px-2 py-2">
                      {enrollment.student.nis || "—"}
                    </td>
                    <td className="px-2 py-2">
                      <StatusBadge tone={statusTone(enrollment.enrollment_status)}>
                        {formatStatus(enrollment.enrollment_status)}
                      </StatusBadge>
                    </td>
                    <td className="px-2 py-2">
                      {activeSupportQuery.isLoading ? (
                        <span className="text-[var(--mws-muted)]">…</span>
                      ) : (
                        <StatusBadge
                          tone={
                            activeSupportStudentIds.has(enrollment.student.id)
                              ? "green"
                              : "amber"
                          }
                        >
                          {activeSupportStudentIds.has(enrollment.student.id)
                            ? "Assigned"
                            : "Not assigned"}
                        </StatusBadge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
