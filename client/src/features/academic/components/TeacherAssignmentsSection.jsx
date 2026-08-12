import { GraduationCap, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  Field,
  SearchableSelect,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { formatDate, formatStatus } from "../../../lib/format.js";
import { classTeacherRoles } from "../api/academicApi.js";

// Lives on ClassDetailPage only - add/end teacher assignments for a class.
// The assign form opens in a small dialog on demand, matching the Enroll
// student flow's "click a button to open a dialog" pattern.
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
  // Employee ids already holding an active HOMEROOM/SUPPORTING_HOMEROOM
  // assignment in another class this academic year - mirrors class-service.ts's
  // ROLE_CAPPED_PER_TEACHER_PER_YEAR, so the picker doesn't offer someone
  // who'd just get rejected by that check.
  homeroomTakenEmployeeIds = new Set(),
  supportingHomeroomTakenEmployeeIds = new Set(),
}) {
  const [assignOpen, setAssignOpen] = useState(false);
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
  // Already assigned to this class (any active role) - re-adding them here
  // would just hit the "already has an active assignment" conflict.
  const assignedToThisClassIds = new Set(
    assignments.filter((a) => !a.end_date).map((a) => a.employee.id),
  );
  const assignableEmployees = teachingEmployees.filter((employee) => {
    if (assignedToThisClassIds.has(employee.id)) return false;
    if (form.role === "HOMEROOM") {
      return !homeroomTakenEmployeeIds.has(employee.id);
    }
    if (form.role === "SUPPORTING_HOMEROOM") {
      return !supportingHomeroomTakenEmployeeIds.has(employee.id);
    }
    if (form.role === "SUBJECT_TEACHER") {
      return !nonSubjectTeachingPositions.has(
        employee.employment.job_position?.trim().toLowerCase(),
      );
    }
    return true;
  });

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
    setAssignOpen(false);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-lg font-bold text-[var(--mws-charcoal)]">
          <GraduationCap size={18} />
          Teachers
        </h3>
        {canWrite ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setAssignOpen(true)}
          >
            <Plus size={16} />
            Assign teacher
          </Button>
        ) : null}
      </div>

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

      {assignOpen ? (
        <CrudDialog
          title="Assign Teacher"
          onClose={() => setAssignOpen(false)}
          footer={
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setAssignOpen(false)}
              >
                Cancel
              </Button>
              <Button
                form="assign-teacher-form"
                type="submit"
                disabled={isAssigning || !form.employee_id}
              >
                <Plus size={16} />
                Add assignment
              </Button>
            </>
          }
        >
          {unitWarning ? (
            <div className="mb-3 rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]">
              {unitWarning}
            </div>
          ) : null}
          <form
            id="assign-teacher-form"
            onSubmit={submitAssign}
            className="grid gap-3"
          >
            <Field label="Teacher">
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
          </form>
        </CrudDialog>
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
