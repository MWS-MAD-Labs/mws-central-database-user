import {
  CalendarOff,
  Eye,
  GraduationCap,
  MoveRight,
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
import { BulkActionBar } from "../../../components/ui/BulkActionBar.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  DateField,
  Field,
  SearchableSelect,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { dateInputFromIso, isoFromDateInput } from "../../../lib/form.js";
import { formatDate, formatStatus } from "../../../lib/format.js";
import { classTeacherRoles } from "../api/academicApi.js";
import { classSelectOptions } from "../utils/selectOptions.js";

function formatSubjectDetail(assignment) {
  return assignment.subject || null
}

function humanizeDuration(startDate, endDate) {
  const start = new Date(startDate)
  const end = endDate ? new Date(endDate) : new Date()
  const days = Math.max(1, Math.floor((end - start) / (1000 * 60 * 60 * 24)))

  if (days < 30) return `${days} Day${days === 1 ? '' : 's'}`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} Month${months === 1 ? '' : 's'}`
  const years = Math.floor(days / 365)
  return `${years} Year${years === 1 ? '' : 's'}`
}

function formatDurationDetail(assignment) {
  if (assignment.end_date) {
    return `${formatDate(assignment.start_date)} – ${formatDate(assignment.end_date)}`
  }
  return `Since ${formatDate(assignment.start_date)}`
}

const ASSIGNMENT_PAGE_SIZE = 10;

export function TeacherAssignmentsSection({
  assignments,
  isLoading,
  error,
  teachingEmployees,
  teachingInterns = [],
  unitWarning,
  canWrite,
  isAssigning,
  onAssign,
  homeroomTakenEmployeeIds = new Set(),
  supportingHomeroomTakenEmployeeIds = new Set(),
  currentClassId,
  moveTargetClassOptions = [],
  academicYears = [],
  isBulkMoving,
  onBulkMove,
  isBulkEnding,
  onBulkEnd,
  isBulkRemoving,
  onBulkRemove,
  isBulkReopening,
  onBulkReopen,
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [bulkEndOpen, setBulkEndOpen] = useState(false);
  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState(
    () => new Set(),
  );
  const [assignmentPage, setAssignmentPage] = useState(1);
  const confirm = useConfirm();
  const [form, setForm] = useState({
    employee_id: "",
    intern_id: "",
    role: "HOMEROOM",
    subject: "",
  });

  const nonSubjectTeachingPositions = new Set([
    "homeroom teacher",
    "special education teacher",
  ]);
  const assignedToThisClassIds = new Set(
    assignments.filter((a) => !a.end_date).map((a) => a.workforce_member?.id ?? a.employee?.id),
  );
  function deriveSubjectFromJobPosition(jobPosition) {
    if (!jobPosition) return "";
    return jobPosition.replace(/\s*Teacher\s*$/i, "").trim();
  }

  const assignableEmployees = teachingEmployees.filter((employee) => {
    if (assignedToThisClassIds.has(employee.id)) return false;
    const jobPosition = employee.employment.job_position?.trim().toLowerCase();
    if (form.role === "HOMEROOM") {
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
  const assignableInterns = teachingInterns.filter((intern) => {
    if (form.role === "HOMEROOM") return false;
    if (assignedToThisClassIds.has(intern.id)) return false;
    const jobPosition = intern.employment.job_position?.trim().toLowerCase();
    if (form.role === "SUBJECT_TEACHER") {
      return !nonSubjectTeachingPositions.has(jobPosition);
    }
    return true;
  });

  function submitBulkEnd(endDate) {
    onBulkEnd(Array.from(selectedAssignmentIds), endDate);
    setSelectedAssignmentIds(new Set());
    setBulkEndOpen(false);
  }

  async function handleBulkRemove() {
    const confirmed = await confirm({
      title: "Remove assignments",
      description: `Remove ${selectedAssignments.length} teacher assignment(s)? Use this only to correct a mistake, not to close a finished assignment. "End selected" does that instead.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (confirmed) {
      onBulkRemove(Array.from(selectedAssignmentIds));
      setSelectedAssignmentIds(new Set());
    }
  }

  async function handleBulkReopen() {
    if (!canReopenSelection) return;
    const confirmed = await confirm({
      title: "Reopen assignments",
      description: `Reopen ${selectedAssignments.length} teacher assignment(s)? This clears their end date.`,
      confirmLabel: "Reopen",
    });
    if (confirmed) {
      onBulkReopen(Array.from(selectedAssignmentIds));
      setSelectedAssignmentIds(new Set());
    }
  }

  async function submitAssign(event) {
    event.preventDefault();
    if (!form.employee_id && !form.intern_id) return;
    const employee = teachingEmployees.find((candidate) => candidate.id === form.employee_id);
    const intern = teachingInterns.find((candidate) => candidate.id === form.intern_id);
    const memberName = employee?.identity.full_name ?? intern?.identity.full_name;
    const confirmed = await confirm({
      title: "Confirm teacher assignment",
      description: `${memberName} (${intern ? "Intern" : "Employee"}) will be assigned as ${formatStatus(form.role)}${form.subject ? ` for ${form.subject}` : ""}.`,
      confirmLabel: "Add assignment",
    });
    if (!confirmed) return;

    onAssign({
      ...(form.employee_id ? { employee_id: form.employee_id } : { intern_id: form.intern_id }),
      role: form.role,
      subject:
        form.role === "SUBJECT_TEACHER" ? form.subject || undefined : undefined,
    });
    setForm({ employee_id: "", intern_id: "", role: form.role, subject: "" });
    setAssignOpen(false);
  }

  const selectedAssignments = assignments.filter((assignment) =>
    selectedAssignmentIds.has(assignment.id),
  );
  const canReopenSelection =
    selectedAssignments.length > 0 &&
    selectedAssignments.every((assignment) => assignment.end_date != null);
  const allSelected =
    assignments.length > 0 && selectedAssignments.length === assignments.length;
  const assignmentTotalPages = Math.max(
    Math.ceil(assignments.length / ASSIGNMENT_PAGE_SIZE),
    1,
  );
  const clampedAssignmentPage = Math.min(
    assignmentPage,
    assignmentTotalPages,
  );
  const pagedAssignments = assignments.slice(
    (clampedAssignmentPage - 1) * ASSIGNMENT_PAGE_SIZE,
    clampedAssignmentPage * ASSIGNMENT_PAGE_SIZE,
  );

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

  function handlePromoteSubmit(targetClassId) {
    onBulkMove(Array.from(selectedAssignmentIds), targetClassId);
    setSelectedAssignmentIds(new Set());
    setPromoteOpen(false);
  }

  function handleMoveSubmit(targetClassId) {
    onBulkMove(Array.from(selectedAssignmentIds), targetClassId);
    setSelectedAssignmentIds(new Set());
    setMoveOpen(false);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-lg font-bold text-(--mws-charcoal)">
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
              <ActionsMenu
                label="Bulk Actions"
                disabled={
                  isBulkMoving ||
                  isBulkEnding ||
                  isBulkRemoving ||
                  isBulkReopening
                }
              >
                {(closeMenu) => (
                  <>
                    <ActionsMenuItem
                      onClick={() => {
                        closeMenu();
                        setMoveOpen(true);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <MoveRight size={15} />
                        Move Class
                      </span>
                    </ActionsMenuItem>
                    <ActionsMenuItem
                      onClick={() => {
                        closeMenu();
                        setPromoteOpen(true);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <MoveRight size={15} />
                        Promote to Next Class
                      </span>
                    </ActionsMenuItem>
                    <ActionsMenuItem
                      onClick={() => {
                        closeMenu();
                        setBulkEndOpen(true);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <CalendarOff size={15} />
                        End selected
                      </span>
                    </ActionsMenuItem>
                    <ActionsMenuItem
                      disabled={!canReopenSelection}
                      title={
                        canReopenSelection
                          ? undefined
                          : "Select only ended assignments to reopen"
                      }
                      onClick={() => {
                        closeMenu();
                        handleBulkReopen();
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <RotateCcw size={15} />
                        Reopen selected
                      </span>
                    </ActionsMenuItem>
                    <div className="my-1 border-t border-(--mws-line)" />
                    <ActionsMenuItem
                      tone="danger"
                      onClick={() => {
                        closeMenu();
                        handleBulkRemove();
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <Trash2 size={15} />
                        Remove selected
                      </span>
                    </ActionsMenuItem>
                  </>
                )}
              </ActionsMenu>
            </BulkActionBar>
          ) : null}

          <div className="space-y-3 md:hidden">
            {pagedAssignments.map((assignment) => (
              <TeacherAssignmentCard
                key={assignment.id}
                assignment={assignment}
                canWrite={canWrite}
                isSelected={selectedAssignmentIds.has(assignment.id)}
                onToggle={(checked) => toggleOne(assignment.id, checked)}
              />
            ))}
          </div>

          <div className="hidden w-full overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-bold text-(--mws-muted)">
                <tr>
                  {canWrite ? (
                    <th className="w-10 px-2 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select All Teacher Assignments"
                        checked={allSelected}
                        onChange={(event) => toggleAll(event.target.checked)}
                        className="h-4 w-4 accent-(--mws-burgundy)"
                      />
                    </th>
                  ) : null}
                  <th className="px-2 py-2">Teacher</th>
                  <th className="px-2 py-2">Role</th>
                  <th className="px-2 py-2">Duration</th>
                </tr>
              </thead>
              <tbody>
                {pagedAssignments.map((assignment) => (
                  <tr
                    key={assignment.id}
                    className="border-t border-(--mws-line)"
                  >
                    {canWrite ? (
                      <td className="px-2 py-3">
                        <input
                          type="checkbox"
                           aria-label={`Select ${assignment.workforce_member?.full_name ?? assignment.employee?.full_name}`}
                          checked={selectedAssignmentIds.has(assignment.id)}
                          onChange={(event) =>
                            toggleOne(assignment.id, event.target.checked)
                          }
                          className="h-4 w-4 accent-(--mws-burgundy)"
                        />
                      </td>
                    ) : null}
                    <td className="px-2 py-3 font-semibold text-(--mws-charcoal)">
                       <Link
                         to={assignment.workforce_member?.type === "INTERN" ? `/interns/${assignment.workforce_member.id}` : `/employees/${assignment.workforce_member?.id ?? assignment.employee?.id}`}
                        className="hover:underline"
                      >
                         {assignment.workforce_member?.full_name ?? assignment.employee?.full_name}
                      </Link>
                      <p className="mt-0.5 text-xs font-normal text-(--mws-muted)">
                         {assignment.workforce_member?.type === "INTERN" ? "Intern" : assignment.employee?.employee_id}
                      </p>
                    </td>
                    <td className="px-2 py-3">
                      {formatStatus(assignment.role)}
                      {formatSubjectDetail(assignment) ? (
                        <p className="mt-0.5 text-xs text-(--mws-muted)">
                          {formatSubjectDetail(assignment)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-2 py-3">
                      {humanizeDuration(
                        assignment.start_date,
                        assignment.end_date,
                      )}
                      <p className="mt-0.5 text-xs text-(--mws-muted)">
                        {formatDurationDetail(assignment)}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {assignments.length > ASSIGNMENT_PAGE_SIZE ? (
            <PaginationBar
              paging={{
                current_page: clampedAssignmentPage,
                total_page: assignmentTotalPages,
                total_item: assignments.length,
                size: ASSIGNMENT_PAGE_SIZE,
              }}
              itemLabel="assignments"
              onPrevious={() =>
                setAssignmentPage((page) => Math.max(page - 1, 1))
              }
              onNext={() =>
                setAssignmentPage((page) =>
                  Math.min(page + 1, assignmentTotalPages),
                )
              }
            />
          ) : null}
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
                disabled={isAssigning || (!form.employee_id && !form.intern_id)}
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
          <div className="mb-3 rounded-xl border border-(--mws-line) bg-(--mws-soft) px-4 py-3 text-sm text-(--mws-muted)">
            Interns cannot be assigned as the primary Homeroom teacher. Choose
            Supporting Homeroom or Subject Teacher when assigning an intern.
          </div>
          <form
            id="assign-teacher-form"
            onSubmit={submitAssign}
            noValidate
            className="grid gap-3"
          >
            <Field label="Teacher">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <SearchableSelect
                     value={form.employee_id || form.intern_id}
                    onChange={(value) => {
                       const employee = assignableEmployees.find(
                         (candidate) => candidate.id === value,
                       );
                       const intern = assignableInterns.find((candidate) => candidate.id === value);
                       setForm((current) => ({
                         ...current,
                         employee_id: employee ? value : "",
                         intern_id: intern ? value : "",
                        subject:
                          current.role === "SUBJECT_TEACHER" &&
                          !current.subject
                            ? deriveSubjectFromJobPosition(
                                employee?.employment?.job_position,
                              )
                            : current.subject,
                      }));
                    }}
                     options={[
                       ...employeeSelectOptions(assignableEmployees),
                       ...assignableInterns.map((intern) => ({ value: intern.id, label: `${intern.identity.full_name} (Intern)` })),
                     ]}
                     placeholder="Select Teacher or Intern"
                     searchPlaceholder="Search Teachers and Interns"
                  />
                </div>
                 {form.employee_id ? (
                   <Link
                     to={`/employees/${form.employee_id}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open teacher detail in a new tab"
                    className="shrink-0 rounded-lg border border-(--mws-line) p-2 text-(--mws-muted) hover:border-(--mws-burgundy) hover:text-(--mws-burgundy)"
                  >
                    <Eye size={16} />
                   </Link>
                 ) : form.intern_id ? (
                   <Link to={`/interns/${form.intern_id}`} target="_blank" rel="noreferrer" title="Open intern detail in a new tab" className="shrink-0 rounded-lg border border-(--mws-line) p-2 text-(--mws-muted) hover:border-(--mws-burgundy) hover:text-(--mws-burgundy)">
                     <Eye size={16} />
                   </Link>
                ) : null}
              </div>
            </Field>
            <Field
              label="Role"
              hint={
                form.role === "SUBJECT_TEACHER"
                  ? "Not capped to one class. The same teacher can be assigned as Subject Teacher in several classes, as long as they're all in this teacher's own unit."
                  : form.role === "HOMEROOM" ||
                      form.role === "SUPPORTING_HOMEROOM"
                    ? "Capped to one active class per teacher per academic year, unlike Subject Teacher."
                    : undefined
              }
            >
              <SearchableSelect
                value={form.role}
                onChange={(value) =>
                   setForm({ ...form, role: value, employee_id: "", intern_id: "" })
                }
                options={enumOptions(classTeacherRoles)}
                placeholder="Select Role"
                searchPlaceholder="Search Role"
              />
            </Field>
            {form.role === "SUBJECT_TEACHER" ? (
              <Field
                label="Subject"
                hint="Pre-filled from the teacher's job position. Edit if it doesn't fit."
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

      {promoteOpen ? (
        <MoveTeacherAssignmentsDialog
          mode="promote"
          selectedAssignments={selectedAssignments}
          currentClassId={currentClassId}
          classOptions={moveTargetClassOptions}
          academicYears={academicYears}
          isSubmitting={isBulkMoving}
          onClose={() => setPromoteOpen(false)}
          onSubmit={handlePromoteSubmit}
        />
      ) : null}

      {moveOpen ? (
        <MoveTeacherAssignmentsDialog
          mode="move"
          selectedAssignments={selectedAssignments}
          currentClassId={currentClassId}
          classOptions={moveTargetClassOptions}
          academicYears={academicYears}
          isSubmitting={isBulkMoving}
          onClose={() => setMoveOpen(false)}
          onSubmit={handleMoveSubmit}
        />
      ) : null}

      {bulkEndOpen ? (
        <EndAssignmentDialog
          count={selectedAssignments.length}
          isSubmitting={isBulkEnding}
          onClose={() => setBulkEndOpen(false)}
          onSubmit={submitBulkEnd}
        />
      ) : null}
    </div>
  );
}

function EndAssignmentDialog({ count, isSubmitting, onClose, onSubmit }) {
  const [endDate, setEndDate] = useState(() =>
    dateInputFromIso(new Date().toISOString()),
  );

  function handleSubmit(event) {
    event.preventDefault();
    if (!endDate) return;
    onSubmit(isoFromDateInput(endDate));
  }

  return (
    <CrudDialog
      title="End Assignments"
      description={`${count} assignment(s) will end on the selected date.`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="end-assignment-form"
            type="submit"
            disabled={isSubmitting || !endDate}
          >
            End
          </Button>
        </>
      }
    >
      <form
        id="end-assignment-form"
        className="space-y-4"
        onSubmit={handleSubmit}
        noValidate
      >
        <Field
          label="End Date"
          hint=""
        >
          <DateField
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </Field>
      </form>
    </CrudDialog>
  );
}

// Cross-year promotion only makes sense once the source year is ending;
// mirrors the server's CLASS_STATUS_TRANSITION_WINDOW_DAYS. A same-year
// move has no such window - it's how a teacher gets reassigned
// mid-semester, which can happen any time.
const PROMOTE_WINDOW_DAYS = 30;

function MoveTeacherAssignmentsDialog({
  mode,
  selectedAssignments,
  currentClassId,
  classOptions,
  academicYears = [],
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const [targetClassId, setTargetClassId] = useState("");
  const [now] = useState(() => new Date());
  const isPromote = mode === "promote";

  const currentClass = classOptions.find((klass) => klass.id === currentClassId);
  const currentYearStart = Number(
    currentClass?.academic_year?.name?.match(/^(\d{4})\//)?.[1],
  );
  const nextAcademicYearStart = classOptions
    .filter(
      (klass) =>
        Number(klass.academic_year?.name?.match(/^(\d{4})\//)?.[1]) >
        currentYearStart,
    )
    .map((klass) => Number(klass.academic_year.name.match(/^(\d{4})\//)?.[1]))
    .sort((left, right) => left - right)[0];
  const targetYearClasses = classOptions.filter((klass) => {
    if (klass.id === currentClassId) return false;
    const klassYearStart = Number(
      klass.academic_year?.name?.match(/^(\d{4})\//)?.[1],
    );
    return isPromote
      ? klassYearStart === nextAcademicYearStart
      : klassYearStart === currentYearStart;
  });
  const targetOptions = classSelectOptions(targetYearClasses);

  const currentAcademicYear = academicYears.find(
    (year) => year.id === currentClass?.academic_year?.id,
  );
  const daysUntilEnd = currentAcademicYear?.end_date
    ? (new Date(currentAcademicYear.end_date).getTime() - now.getTime()) /
      (1000 * 60 * 60 * 24)
    : null;
  const promoteWindowBlocked =
    isPromote && daysUntilEnd !== null && daysUntilEnd > PROMOTE_WINDOW_DAYS;

  function handleSubmit(event) {
    event.preventDefault();
    if (!targetClassId || promoteWindowBlocked) return;
    onSubmit(targetClassId);
  }

  const title = isPromote
    ? "Promote Teachers to Next Class"
    : "Move Teachers to Another Class";
  const description = isPromote
    ? `${selectedAssignments.length} assignment(s) will be created in the next academic year's class with the same role and subject, then ended in this class.`
    : `${selectedAssignments.length} assignment(s) will be created in the selected class with the same role and subject, then ended in this class. Use this for a mid-semester reassignment within the same academic year.`;

  return (
    <CrudDialog
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="move-teacher-form"
            type="submit"
            disabled={isSubmitting || !targetClassId || promoteWindowBlocked}
            loading={isSubmitting}
          >
            <MoveRight size={16} />
            {isPromote ? "Promote" : "Move"}
          </Button>
        </>
      }
    >
      <form
        id="move-teacher-form"
        onSubmit={handleSubmit}
        noValidate
        className="grid gap-3 py-2"
      >
        {promoteWindowBlocked ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]">
            Too early to promote. {currentAcademicYear.name} doesn't end
            until {formatDate(currentAcademicYear.end_date)}. Opens{" "}
            {Math.max(1, Math.ceil(daysUntilEnd - PROMOTE_WINDOW_DAYS))} day
            {Math.max(1, Math.ceil(daysUntilEnd - PROMOTE_WINDOW_DAYS)) === 1
              ? ""
              : "s"}{" "}
            from now.
          </div>
        ) : null}
        <Field
          label="Target Class"
          hint={
            isPromote
              ? "Only showing classes in this class's unit for the next academic year."
              : "Only showing other classes in this class's unit for the same academic year."
          }
        >
          <SearchableSelect
            value={targetClassId}
            onChange={setTargetClassId}
            options={targetOptions}
            placeholder="Select Class"
            searchPlaceholder="Search Classes"
            emptyLabel={
              isPromote
                ? "No next academic year classes are available in this unit"
                : "No other classes are available in this unit for the same academic year"
            }
          />
        </Field>
      </form>
    </CrudDialog>
  );
}

function TeacherAssignmentCard({
  assignment,
  canWrite,
  isSelected,
  onToggle,
}) {
  const workforceMember = assignment.workforce_member ?? assignment.employee;
  const isIntern = assignment.workforce_member?.type === "INTERN";

  return (
    <div className="rounded-xl border border-(--mws-line) bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {canWrite ? (
            <input
              type="checkbox"
              aria-label={`Select ${workforceMember.full_name}`}
              checked={isSelected}
              onChange={(event) => onToggle(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-(--mws-burgundy)"
            />
          ) : null}
          <div className="min-w-0">
            <Link
              to={isIntern ? `/interns/${workforceMember.id}` : `/employees/${workforceMember.id}`}
              className="font-semibold text-(--mws-charcoal) hover:underline"
            >
              {workforceMember.full_name}
            </Link>
            <p className="mt-0.5 text-xs text-(--mws-muted)">
              {isIntern ? "Intern" : assignment.employee?.employee_id}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div>
          <p className="text-xs text-(--mws-muted)">Role</p>
          <p className="text-(--mws-charcoal)">
            {formatStatus(assignment.role)}
          </p>
          {formatSubjectDetail(assignment) ? (
            <p className="mt-0.5 text-xs text-(--mws-muted)">
              {formatSubjectDetail(assignment)}
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-xs text-(--mws-muted)">Duration</p>
          <p className="text-(--mws-charcoal)">
            {humanizeDuration(assignment.start_date, assignment.end_date)}
          </p>
          <p className="mt-0.5 text-xs text-(--mws-muted)">
            {formatDurationDetail(assignment)}
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
