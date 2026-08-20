import {
  CalendarOff,
  GraduationCap,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import {
  ActionsMenu,
  ActionsMenuItem,
} from "../../../components/ui/ActionsMenu.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  Field,
  SearchableSelect,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
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
  isRemoving,
  isReopening,
  onAssign,
  onEnd,
  onRemove,
  onReopen,
  // Employee ids already holding an active HOMEROOM/SUPPORTING_HOMEROOM
  // assignment in another class this academic year - mirrors class-service.ts's
  // ROLE_CAPPED_PER_TEACHER_PER_YEAR, so the picker doesn't offer someone
  // who'd just get rejected by that check.
  homeroomTakenEmployeeIds = new Set(),
  supportingHomeroomTakenEmployeeIds = new Set(),
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const confirm = useConfirm();
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
  // Real subject-teaching job positions are already "<Subject> Teacher"
  // (see the comment above) - reuse that instead of making the admin
  // retype the same word. Still just a default: the field stays editable
  // for the rare position that doesn't fit the pattern.
  function deriveSubjectFromJobPosition(jobPosition) {
    if (!jobPosition) return "";
    return jobPosition.replace(/\s*Teacher\s*$/i, "").trim();
  }

  const assignableEmployees = teachingEmployees.filter((employee) => {
    if (assignedToThisClassIds.has(employee.id)) return false;
    const jobPosition = employee.employment.job_position?.trim().toLowerCase();
    if (form.role === "HOMEROOM") {
      // Mirrors assertHasHomeroomPosition in class-service.ts - not just
      // any teaching job level, specifically the Homeroom Teacher position.
      return (
        jobPosition === "homeroom teacher" &&
        !homeroomTakenEmployeeIds.has(employee.id)
      );
    }
    if (form.role === "SUPPORTING_HOMEROOM") {
      return (
        jobPosition === "homeroom teacher" &&
        !supportingHomeroomTakenEmployeeIds.has(employee.id)
      );
    }
    if (form.role === "SUBJECT_TEACHER") {
      return !nonSubjectTeachingPositions.has(jobPosition);
    }
    return true;
  });

  async function handleRemove(assignment) {
    const confirmed = await confirm({
      title: "Remove assignment",
      description: `Remove ${assignment.employee.full_name}'s ${formatStatus(assignment.role)} assignment? Use this only to correct a mistake, not to close a finished assignment - "End" does that instead.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (confirmed) {
      onRemove(assignment.id);
    }
  }

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
            variant="ghost"
            size="sm"
            onClick={() => setAssignOpen(true)}
          >
            <Plus size={14} />
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
        <>
          {/* Below md: one card per assignment instead of a 6-column table
          row - same fields, stacked. */}
          <div className="space-y-3 md:hidden">
            {assignments.map((assignment) => (
              <TeacherAssignmentCard
                key={assignment.id}
                assignment={assignment}
                canWrite={canWrite}
                isEnding={isEnding}
                isReopening={isReopening}
                onEnd={onEnd}
                onReopen={onReopen}
                onRemove={() => handleRemove(assignment)}
                isRemoving={isRemoving}
              />
            ))}
          </div>

          <div className="hidden min-w-0 overflow-x-auto rounded-xl border border-[var(--mws-line)] md:block">
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
                      <Link
                        to={`/employees/${assignment.employee.id}`}
                        className="font-semibold text-[var(--mws-burgundy)] hover:underline"
                      >
                        {assignment.employee.full_name}
                      </Link>
                      <p className="font-mono text-xs text-[var(--mws-muted)]">
                        {assignment.employee.employee_id}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {formatStatus(assignment.role)}
                    </td>
                    <td className="px-4 py-3">{assignment.subject || "-"}</td>
                    <td className="px-4 py-3">
                      {formatDate(assignment.start_date)}
                    </td>
                    <td className="px-4 py-3">
                      {assignment.end_date
                        ? formatDate(assignment.end_date)
                        : "Current"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canWrite ? (
                        <ActionsMenu label="Assignment Actions">
                          {(closeMenu) => (
                            <>
                              {!assignment.end_date ? (
                                <ActionsMenuItem
                                  disabled={isEnding}
                                  onClick={() => {
                                    closeMenu();
                                    onEnd(assignment.id);
                                  }}
                                >
                                  <span className="flex items-center gap-2">
                                    <CalendarOff size={15} />
                                    End
                                  </span>
                                </ActionsMenuItem>
                              ) : (
                                <ActionsMenuItem
                                  disabled={isReopening}
                                  onClick={() => {
                                    closeMenu();
                                    onReopen(assignment.id);
                                  }}
                                >
                                  <span className="flex items-center gap-2">
                                    <RotateCcw size={15} />
                                    Reopen
                                  </span>
                                </ActionsMenuItem>
                              )}
                              <ActionsMenuItem
                                tone="danger"
                                disabled={isRemoving}
                                onClick={() => {
                                  closeMenu();
                                  handleRemove(assignment);
                                }}
                              >
                                <span className="flex items-center gap-2">
                                  <Trash2 size={15} />
                                  Remove
                                </span>
                              </ActionsMenuItem>
                            </>
                          )}
                        </ActionsMenu>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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
            noValidate
            className="grid gap-3"
          >
            <Field label="Teacher">
              <SearchableSelect
                value={form.employee_id}
                onChange={(value) => {
                  const employee = assignableEmployees.find(
                    (candidate) => candidate.id === value,
                  );
                  setForm((current) => ({
                    ...current,
                    employee_id: value,
                    subject:
                      current.role === "SUBJECT_TEACHER" && !current.subject
                        ? deriveSubjectFromJobPosition(
                            employee?.employment?.job_position,
                          )
                        : current.subject,
                  }));
                }}
                options={employeeSelectOptions(assignableEmployees)}
                placeholder="Select Teacher"
                searchPlaceholder="Search Teachers"
              />
            </Field>
            <Field
              label="Role"
              hint={
                form.role === "SUBJECT_TEACHER"
                  ? "Not capped to one class - the same teacher can be assigned as Subject Teacher in several classes, as long as they're all in this teacher's own unit ."
                  : form.role === "HOMEROOM" ||
                      form.role === "SUPPORTING_HOMEROOM"
                    ? "Capped to one active class per teacher per academic year, unlike Subject Teacher."
                    : undefined
              }
            >
              <SearchableSelect
                value={form.role}
                onChange={(value) =>
                  setForm({ ...form, role: value, employee_id: "" })
                }
                options={enumOptions(classTeacherRoles)}
                placeholder="Select Role"
                searchPlaceholder="Search Role"
              />
            </Field>
            {form.role === "SUBJECT_TEACHER" ? (
              <Field
                label="Subject"
                hint="Pre-filled from the teacher's job position - edit if it doesn't fit."
              >
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

// Mobile (<md) stand-in for one <tr> of the assignments table.
function TeacherAssignmentCard({
  assignment,
  canWrite,
  isEnding,
  isReopening,
  isRemoving,
  onEnd,
  onReopen,
  onRemove,
}) {
  return (
    <div className="rounded-xl border border-[var(--mws-line)] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/employees/${assignment.employee.id}`}
            className="font-semibold text-[var(--mws-burgundy)] hover:underline"
          >
            {assignment.employee.full_name}
          </Link>
          <p className="font-mono text-xs text-[var(--mws-muted)]">
            {assignment.employee.employee_id}
          </p>
        </div>
        {canWrite ? (
          <ActionsMenu label="Assignment Actions">
            {(closeMenu) => (
              <>
                {!assignment.end_date ? (
                  <ActionsMenuItem
                    disabled={isEnding}
                    onClick={() => {
                      closeMenu();
                      onEnd(assignment.id);
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <CalendarOff size={15} />
                      End
                    </span>
                  </ActionsMenuItem>
                ) : (
                  <ActionsMenuItem
                    disabled={isReopening}
                    onClick={() => {
                      closeMenu();
                      onReopen(assignment.id);
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <RotateCcw size={15} />
                      Reopen
                    </span>
                  </ActionsMenuItem>
                )}
                <ActionsMenuItem
                  tone="danger"
                  disabled={isRemoving}
                  onClick={() => {
                    closeMenu();
                    onRemove();
                  }}
                >
                  <span className="flex items-center gap-2">
                    <Trash2 size={15} />
                    Remove
                  </span>
                </ActionsMenuItem>
              </>
            )}
          </ActionsMenu>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div>
          <p className="text-xs text-[var(--mws-muted)]">Role</p>
          <p className="text-[var(--mws-charcoal)]">
            {formatStatus(assignment.role)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--mws-muted)]">Subject</p>
          <p className="text-[var(--mws-charcoal)]">
            {assignment.subject || "-"}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--mws-muted)]">Start</p>
          <p className="text-[var(--mws-charcoal)]">
            {formatDate(assignment.start_date)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--mws-muted)]">End</p>
          <p className="text-[var(--mws-charcoal)]">
            {assignment.end_date ? formatDate(assignment.end_date) : "Current"}
          </p>
        </div>
      </div>
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
