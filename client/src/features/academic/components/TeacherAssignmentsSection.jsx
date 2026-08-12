import { Plus, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import {
  Field,
  SearchableSelect,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { formatDate, formatStatus } from "../../../lib/format.js";
import { classTeacherRoles } from "../api/academicApi.js";

// Shared by AcademicPage's Class edit dialog and ClassDetailPage - one
// place to add/end teacher assignments for a class, whether reached via
// the edit modal or the class's own detail page.
export function TeacherAssignmentsSection({
  assignments,
  isLoading,
  error,
  teachingEmployees,
  unitWarning,
  canWrite,
  isAssigning,
  isEnding,
  onAssign,
  onEnd,
  // Modal usage (AcademicPage's Class edit dialog) sits below other form
  // fields and needs the top border/spacing plus its own small heading.
  // On its own page (ClassDetailPage) the section is the only thing in
  // its card, so the caller renders a matching page-level heading instead.
  standalone = false,
}) {
  const [form, setForm] = useState({
    employee_id: "",
    role: "HOMEROOM",
    subject: "",
  });

  // Real job positions are plain "<Subject> Teacher" - anyone teaching
  // except "Homeroom Teacher" and "Special Education Teacher" (its own
  // per-student assignment system) is eligible. Mirrors
  // NON_SUBJECT_TEACHING_POSITIONS in class-service.ts.
  const nonSubjectTeachingPositions = new Set([
    "homeroom teacher",
    "special education teacher",
  ]);
  const assignableEmployees =
    form.role === "SUBJECT_TEACHER"
      ? teachingEmployees.filter(
          (employee) =>
            !nonSubjectTeachingPositions.has(
              employee.employment.job_position?.trim().toLowerCase(),
            ),
        )
      : teachingEmployees;

  function submitAssign(event) {
    event.preventDefault();
    if (!form.employee_id) return;
    onAssign({
      employee_id: form.employee_id,
      role: form.role,
      subject:
        form.role === "SUBJECT_TEACHER" ? form.subject || undefined : undefined,
    });
    setForm({ employee_id: "", role: form.role, subject: "" });
  }

  return (
    <div
      className={
        standalone ? "" : "mt-6 border-t border-[var(--mws-line)] pt-6"
      }
    >
      {standalone ? null : (
        <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-bold text-[var(--mws-charcoal)]">
          <Users size={16} />
          Teachers
        </h3>
      )}

      {isLoading ? (
        <div className="rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] px-4 py-8 text-center text-sm text-[var(--mws-muted)]">
          Loading teacher assignments...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-[#f2c8cb] bg-[#fff6f7] px-4 py-3 text-sm font-semibold text-[#9f3d41]">
          Teacher assignments are unavailable.
        </div>
      ) : assignments.length === 0 ? (
        <div className="rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] px-4 py-8 text-center text-sm text-[var(--mws-muted)]">
          No teacher assigned to this class yet.
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-xl border border-[var(--mws-line)]">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
              <tr>
                <th className="px-4 py-3">Teacher</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Start</th>
                <th className="px-4 py-3">End</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {assignments.map((assignment) => (
                <tr
                  key={assignment.id}
                  className="border-t border-[var(--mws-line)]"
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[var(--mws-charcoal)]">
                      {assignment.employee.full_name}
                    </p>
                    <p className="font-mono text-xs text-[var(--mws-muted)]">
                      {assignment.employee.employee_id}
                    </p>
                  </td>
                  <td className="px-4 py-3">{formatStatus(assignment.role)}</td>
                  <td className="px-4 py-3">{assignment.subject || "-"}</td>
                  <td className="px-4 py-3">
                    {formatDate(assignment.start_date)}
                  </td>
                  <td className="px-4 py-3">
                    {assignment.end_date
                      ? formatDate(assignment.end_date)
                      : "Current"}
                  </td>
                  <td className="px-4 py-3">
                    {canWrite && !assignment.end_date ? (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={isEnding}
                        onClick={() => onEnd(assignment.id)}
                      >
                        End
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canWrite ? (
        <>
          {unitWarning ? (
            <div className="mt-3 rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]">
              {unitWarning}
            </div>
          ) : null}
          <form
            onSubmit={submitAssign}
            className="mt-3 grid gap-3 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-4 md:grid-cols-3"
          >
            <Field label="Teacher" className="md:col-span-1">
              <SearchableSelect
                value={form.employee_id}
                onChange={(value) => setForm({ ...form, employee_id: value })}
                options={employeeSelectOptions(assignableEmployees)}
                placeholder="Select teacher"
                searchPlaceholder="Search teachers"
              />
            </Field>
            <Field label="Role">
              <SearchableSelect
                value={form.role}
                onChange={(value) =>
                  setForm({ ...form, role: value, employee_id: "" })
                }
                options={enumOptions(classTeacherRoles)}
                placeholder="Select role"
                searchPlaceholder="Search role"
              />
            </Field>
            {form.role === "SUBJECT_TEACHER" ? (
              <Field label="Subject">
                <TextInput
                  placeholder="e.g. Visual Arts"
                  value={form.subject}
                  onChange={(event) =>
                    setForm({ ...form, subject: event.target.value })
                  }
                />
              </Field>
            ) : null}
            <div className="md:col-span-3">
              <Button type="submit" disabled={isAssigning || !form.employee_id}>
                <Plus size={16} />
                Add assignment
              </Button>
            </div>
          </form>
        </>
      ) : null}
    </div>
  );
}

function enumOptions(values) {
  return values.map((value) => ({ value, label: formatStatus(value) }));
}

function employeeSelectOptions(employees) {
  return employees.map((employee) => ({
    value: employee.id,
    label: employee.identity.full_name,
    description: employee.employment.job_level,
    searchText: `${employee.identity.full_name} ${employee.employment.job_level}`,
  }));
}
