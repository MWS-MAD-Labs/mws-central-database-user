import {
  CalendarOff,
  GraduationCap,
  MoveRight,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import {
  ActionsMenu,
  ActionsMenuItem,
} from "../../../components/ui/ActionsMenu.jsx";
import { BulkActionBar } from "../../../components/ui/BulkActionBar.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  Field,
  SearchableSelect,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { formatDate, formatStatus } from "../../../lib/format.js";
import { classTeacherRoles, classesApi } from "../api/academicApi.js";
import { classSelectOptions } from "../utils/selectOptions.js";

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
  // This class's own id - excluded from the "Move to Class" target picker,
  // same reasoning as transfer()'s same-class guard on the backend: moving
  // an assignment to the class it's already in isn't a real move.
  currentClassId,
  isBulkMoving,
  onBulkMove,
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState(
    () => new Set(),
  );
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

  const selectedAssignments = assignments.filter((assignment) =>
    selectedAssignmentIds.has(assignment.id),
  );
  const allSelected =
    assignments.length > 0 && selectedAssignments.length === assignments.length;

  function toggleAll(checked) {
    setSelectedAssignmentIds(
      checked ? new Set(assignments.map((a) => a.id)) : new Set(),
    );
  }

  function toggleOne(assignmentId, checked) {
    setSelectedAssignmentIds((current) => {
      const next = new Set(current);
      if (checked) next.add(assignmentId);
      else next.delete(assignmentId);
      return next;
    });
  }

  function handleMoveSubmit(targetClassId) {
    onBulkMove(Array.from(selectedAssignmentIds), targetClassId);
    setSelectedAssignmentIds(new Set());
    setMoveOpen(false);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
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
        <PanelMessage>Loading teacher assignments…</PanelMessage>
      ) : error ? (
        <PanelMessage tone="error">
          Teacher assignments are unavailable.
        </PanelMessage>
      ) : assignments.length === 0 ? (
        <PanelMessage>No teacher assigned to this class yet.</PanelMessage>
      ) : (
        <>
          {canWrite ? (
            <BulkActionBar
              selectedCount={selectedAssignments.length}
              onClear={() => setSelectedAssignmentIds(new Set())}
            >
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isBulkMoving}
                onClick={() => setMoveOpen(true)}
              >
                <MoveRight size={15} />
                Move to Class
              </Button>
            </BulkActionBar>
          ) : null}

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
                isSelected={selectedAssignmentIds.has(assignment.id)}
                onToggle={(checked) => toggleOne(assignment.id, checked)}
              />
            ))}
          </div>

          <div className="hidden w-full overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-bold text-[var(--mws-muted)]">
                <tr>
                  {canWrite ? (
                    <th className="w-10 px-2 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select All Teacher Assignments"
                        checked={allSelected}
                        onChange={(event) => toggleAll(event.target.checked)}
                        className="h-4 w-4 accent-[var(--mws-burgundy)]"
                      />
                    </th>
                  ) : null}
                  <th className="px-2 py-2">Teacher</th>
                  <th className="px-2 py-2">Role</th>
                  <th className="px-2 py-2">Subject</th>
                  <th className="px-2 py-2">Start</th>
                  <th className="px-2 py-2">End</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {assignments.map((assignment) => (
                  <tr
                    key={assignment.id}
                    className="border-t border-[var(--mws-line)]"
                  >
                    {canWrite ? (
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${assignment.employee.full_name}`}
                          checked={selectedAssignmentIds.has(assignment.id)}
                          onChange={(event) =>
                            toggleOne(assignment.id, event.target.checked)
                          }
                          className="h-4 w-4 accent-[var(--mws-burgundy)]"
                        />
                      </td>
                    ) : null}
                    <td className="px-2 py-2 font-semibold text-[var(--mws-charcoal)]">
                      <Link
                        to={`/employees/${assignment.employee.id}`}
                        className="hover:underline"
                      >
                        {assignment.employee.full_name}
                      </Link>
                      <p className="text-xs font-normal text-[var(--mws-muted)]">
                        {assignment.employee.employee_id}
                      </p>
                    </td>
                    <td className="px-2 py-2">
                      {formatStatus(assignment.role)}
                    </td>
                    <td className="px-2 py-2">{assignment.subject || "-"}</td>
                    <td className="px-2 py-2">
                      {formatDate(assignment.start_date)}
                    </td>
                    <td className="px-2 py-2">
                      {assignment.end_date
                        ? formatDate(assignment.end_date)
                        : "Current"}
                    </td>
                    <td className="px-2 py-2 text-right">
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

      {moveOpen ? (
        <MoveTeacherAssignmentsDialog
          selectedAssignments={selectedAssignments}
          currentClassId={currentClassId}
          isSubmitting={isBulkMoving}
          onClose={() => setMoveOpen(false)}
          onSubmit={handleMoveSubmit}
        />
      ) : null}
    </div>
  );
}

// Target-class picker for the "Move to Class" bulk action - each selected
// assignment is ended here and re-created on the target class with the same
// role/subject (see ClassService.bulkMoveTeacherAssignments), so this is
// deliberately just "which class", not a full re-entry of role/subject.
function MoveTeacherAssignmentsDialog({
  selectedAssignments,
  currentClassId,
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const [targetClassId, setTargetClassId] = useState("");

  const classesQuery = useQuery({
    queryKey: ["classes", "move-teacher-target"],
    queryFn: () =>
      classesApi.list({
        page: 1,
        size: 200,
        sort_by: "created_at",
        sort_order: "desc",
      }),
  });

  const targetOptions = classSelectOptions(
    (classesQuery.data?.data || []).filter(
      (klass) => klass.id !== currentClassId,
    ),
  );

  function handleSubmit(event) {
    event.preventDefault();
    if (!targetClassId) return;
    onSubmit(targetClassId);
  }

  return (
    <CrudDialog
      title="Move to Class"
      description={`${selectedAssignments.length} assignment(s) will end here and be re-created on the target class with the same role/subject.`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="move-teacher-form"
            type="submit"
            disabled={isSubmitting || !targetClassId}
          >
            <MoveRight size={16} />
            Move
          </Button>
        </>
      }
    >
      <form
        id="move-teacher-form"
        onSubmit={handleSubmit}
        noValidate
        className="grid gap-3"
      >
        <Field label="Target Class">
          <SearchableSelect
            value={targetClassId}
            onChange={setTargetClassId}
            options={targetOptions}
            placeholder={
              classesQuery.isLoading ? "Loading classes..." : "Select Class"
            }
            searchPlaceholder="Search Classes"
          />
        </Field>
      </form>
    </CrudDialog>
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
  isSelected,
  onToggle,
}) {
  return (
    <div className="rounded-xl border border-[var(--mws-line)] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {canWrite ? (
            <input
              type="checkbox"
              aria-label={`Select ${assignment.employee.full_name}`}
              checked={isSelected}
              onChange={(event) => onToggle(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--mws-burgundy)]"
            />
          ) : null}
          <div className="min-w-0">
            <Link
              to={`/employees/${assignment.employee.id}`}
              className="font-semibold text-[var(--mws-charcoal)] hover:underline"
            >
              {assignment.employee.full_name}
            </Link>
            <p className="text-xs text-[var(--mws-muted)]">
              {assignment.employee.employee_id}
            </p>
          </div>
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
