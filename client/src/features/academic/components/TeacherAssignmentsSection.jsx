import {
  CalendarClock,
  CalendarOff,
  Eye,
  GraduationCap,
  MoveRight,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
import { DenseTable, denseCellClass, denseRowClass } from "../../../components/ui/DenseTable.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { SortableHeader } from "../../../components/ui/SortableHeader.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { SelectFilter } from "./SelectFilter.jsx";
import { PaginatedSingleSelect } from "../../../components/ui/PaginatedSingleSelect.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue.js";
import { dateInputFromIso, isoFromDateInput } from "../../../lib/form.js";
import { formatDate, formatStatus } from "../../../lib/format.js";
import { classTeacherRoles, classesApi } from "../api/academicApi.js";
import { classSelectOptions } from "../utils/selectOptions.js";
import { AssignmentDurationCell } from "./AssignmentDurationCell.jsx";

function formatSubjectDetail(assignment) {
  return assignment.subject || null
}

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "ENDED", label: "Ended" },
];

// Derived from the dates; the server keeps no status for class teachers.
function assignmentStatus(assignment, now = Date.now()) {
  if (assignment.end_date && new Date(assignment.end_date).getTime() <= now) return "ENDED";
  if (new Date(assignment.start_date).getTime() > now) return "SCHEDULED";
  return "ACTIVE";
}

const STATUS_TONES = { ACTIVE: "green", SCHEDULED: "amber", ENDED: "neutral" };

function teacherName(assignment) {
  return assignment.workforce_member?.full_name ?? assignment.employee?.full_name ?? "";
}

function sortValue(assignment, column) {
  if (column === "teacher") return teacherName(assignment).toLocaleLowerCase();
  if (column === "role") return assignment.role;
  if (column === "status") return assignmentStatus(assignment);
  if (column === "job_position") return (assignment.job_position_name ?? "").toLocaleLowerCase();
  return assignment.start_date;
}

export function TeacherAssignmentsSection({
  assignments,
  isLoading,
  error,
  unitWarning,
  canWrite,
  isAssigning,
  onAssign,
  currentClassId,
  academicYearStartDate,
  academicYearEndDate,
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
  isUpdatingStartDate,
  onUpdateStartDate,
  isBulkUpdatingStartDate,
  onBulkUpdateStartDate,
  onEnd,
  onRemove,
  onReopen,
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [bulkEndOpen, setBulkEndOpen] = useState(false);
  const [startDateDialog, setStartDateDialog] = useState(null);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [candidatePage, setCandidatePage] = useState(1);
  const debouncedCandidateSearch = useDebouncedValue(candidateSearch);
  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState(
    () => new Set(),
  );
  const [assignmentPage, setAssignmentPage] = useState(1);
  const [assignmentPageSize, setAssignmentPageSize] = useState(10);
  const [teacherSearch, setTeacherSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [teacherSort, setTeacherSort] = useState({ sort_by: "start_date", sort_order: "desc" });
  const [candidatePageSize, setCandidatePageSize] = useState(10);
  const confirm = useConfirm();
  const [form, setForm] = useState({
    workforce_target: "",
    role: "HOMEROOM",
    subject: "",
    start_date: dateInputFromIso(academicYearStartDate),
  });

  const candidatesQuery = useQuery({
    queryKey: [
      "classes",
      currentClassId,
      "teacher-candidates",
      { page: candidatePage, size: candidatePageSize, search: debouncedCandidateSearch, role: form.role },
    ],
    queryFn: () =>
      classesApi.teacherCandidates(currentClassId, {
        page: candidatePage,
        size: candidatePageSize,
        search: debouncedCandidateSearch || undefined,
        role: form.role,
      }),
    enabled: assignOpen && Boolean(currentClassId),
  });
  const candidates = candidatesQuery.data?.data || [];
  const candidatePaging = candidatesQuery.data?.paging || {
    current_page: candidatePage,
    total_page: 1,
    total_item: candidates.length,
    size: candidatePageSize,
  };
  function deriveSubjectFromJobPosition(jobPosition) {
    if (!jobPosition) return "";
    return jobPosition.replace(/\s*Teacher\s*$/i, "").trim();
  }

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
    if (!form.workforce_target || !form.start_date) return;
    const candidate = candidates.find(
      (item) => candidateValue(item) === form.workforce_target,
    );
    const confirmed = await confirm({
      title: "Confirm teacher assignment",
      description: `${candidateName(candidate)} will be assigned as ${formatStatus(form.role)}${form.subject ? ` for ${form.subject}` : ""}.`,
      confirmLabel: "Add assignment",
    });
    if (!confirmed) return;

    onAssign({
      ...candidateTargetPayload(form.workforce_target),
      role: form.role,
      start_date: isoFromDateInput(form.start_date),
      subject:
        form.role === "SUBJECT_TEACHER" ? form.subject || undefined : undefined,
    });
    setForm({
      workforce_target: "",
      role: form.role,
      subject: "",
      start_date: dateInputFromIso(academicYearStartDate),
    });
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
  const visibleAssignments = useMemo(() => {
    const term = teacherSearch.trim().toLocaleLowerCase();
    const direction = teacherSort.sort_order === "desc" ? -1 : 1;
    return assignments
      .filter((assignment) => !statusFilter || assignmentStatus(assignment) === statusFilter)
      .filter(
        (assignment) =>
          !term ||
          [
            teacherName(assignment),
            assignment.job_position_name,
            assignment.unit_name,
            assignment.subject,
            formatStatus(assignment.role),
          ]
            .filter(Boolean)
            .some((value) => String(value).toLocaleLowerCase().includes(term)),
      )
      .sort((left, right) => {
        const leftValue = sortValue(left, teacherSort.sort_by);
        const rightValue = sortValue(right, teacherSort.sort_by);
        return leftValue === rightValue
          ? left.id.localeCompare(right.id)
          : leftValue.localeCompare(rightValue) * direction;
      });
  }, [assignments, statusFilter, teacherSearch, teacherSort]);
  const assignmentTotalPages = Math.max(
    Math.ceil(visibleAssignments.length / assignmentPageSize),
    1,
  );
  const clampedAssignmentPage = Math.min(
    assignmentPage,
    assignmentTotalPages,
  );
  const pagedAssignments = visibleAssignments.slice(
    (clampedAssignmentPage - 1) * assignmentPageSize,
    clampedAssignmentPage * assignmentPageSize,
  );
  function sortTeachers(sort_by, sort_order) {
    setTeacherSort({ sort_by, sort_order });
    setAssignmentPage(1);
  }

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

      {assignments.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={teacherSearch}
            onChange={(event) => {
              setTeacherSearch(event.target.value);
              setAssignmentPage(1);
            }}
            placeholder="Search teachers"
            aria-label="Search teachers"
            className="h-9 min-w-48 flex-1 rounded-full border border-(--mws-line) px-3 text-sm outline-none focus:border-(--mws-burgundy)"
          />
          <SelectFilter
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              setAssignmentPage(1);
            }}
            options={STATUS_FILTER_OPTIONS}
            placeholder="All Statuses"
          />
        </div>
      ) : null}

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
                        setStartDateDialog({ mode: "bulk" });
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <CalendarClock size={15} />
                        Edit Start Date
                      </span>
                    </ActionsMenuItem>
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

          <DenseTable
            minWidth={980}
            head={
              <>
                {canWrite ? (
                  <th className="w-12 px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Select All Teacher Assignments"
                      checked={allSelected}
                      onChange={(event) => toggleAll(event.target.checked)}
                      className="h-4 w-4 accent-(--mws-burgundy)"
                    />
                  </th>
                ) : null}
                <th className="px-4 py-2.5">
                  <SortableHeader label="Teacher" column="teacher" sortBy={teacherSort.sort_by} sortOrder={teacherSort.sort_order} onSort={sortTeachers} />
                </th>
                <th className="px-4 py-2.5">
                  <SortableHeader label="Job position" column="job_position" sortBy={teacherSort.sort_by} sortOrder={teacherSort.sort_order} onSort={sortTeachers} />
                </th>
                <th className="px-4 py-2.5">Unit</th>
                <th className="px-4 py-2.5">
                  <SortableHeader label="Role" column="role" sortBy={teacherSort.sort_by} sortOrder={teacherSort.sort_order} onSort={sortTeachers} />
                </th>
                <th className="px-4 py-2.5">
                  <SortableHeader label="Status" column="status" sortBy={teacherSort.sort_by} sortOrder={teacherSort.sort_order} onSort={sortTeachers} />
                </th>
                <th className="px-4 py-2.5">
                  <SortableHeader label="Duration" column="start_date" sortBy={teacherSort.sort_by} sortOrder={teacherSort.sort_order} onSort={sortTeachers} />
                </th>
                {canWrite ? <th className="px-4 py-2.5 text-right">Actions</th> : null}
              </>
            }
            footer={
              visibleAssignments.length > 0 ? (
                <PaginationBar
                  paging={{
                    current_page: clampedAssignmentPage,
                    total_page: assignmentTotalPages,
                    total_item: visibleAssignments.length,
                    size: assignmentPageSize,
                  }}
                  itemLabel="assignments"
                  onPrevious={() => setAssignmentPage((page) => Math.max(page - 1, 1))}
                  onNext={() =>
                    setAssignmentPage((page) => Math.min(page + 1, assignmentTotalPages))
                  }
                  onPageChange={setAssignmentPage}
                  onPageSizeChange={(size) => {
                    setAssignmentPageSize(size);
                    setAssignmentPage(1);
                  }}
                />
              ) : null
            }
          >
            {pagedAssignments.length === 0 ? (
              <tr>
                <td colSpan={canWrite ? 8 : 6} className="px-4 py-8 text-center text-(--mws-muted)">
                  No teacher assignments match.
                </td>
              </tr>
            ) : null}
            {pagedAssignments.map((assignment) => {
              const status = assignmentStatus(assignment);
              const isIntern = assignment.workforce_member?.type === "INTERN";
              return (
                <tr key={assignment.id} className={denseRowClass}>
                  {canWrite ? (
                    <td className={denseCellClass}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${teacherName(assignment)}`}
                        checked={selectedAssignmentIds.has(assignment.id)}
                        onChange={(event) =>
                          toggleOne(assignment.id, event.target.checked)
                        }
                        className="h-4 w-4 accent-(--mws-burgundy)"
                      />
                    </td>
                  ) : null}
                  <td className={`${denseCellClass} max-w-56 truncate font-semibold text-(--mws-charcoal)`}>
                    <Link
                      to={isIntern ? `/interns/${assignment.workforce_member.id}` : `/employees/${assignment.workforce_member?.id ?? assignment.employee?.id}`}
                      title={teacherName(assignment)}
                      className="hover:underline"
                    >
                      {teacherName(assignment)}
                    </Link>
                    {isIntern ? (
                      <span className="ml-1.5 text-xs font-normal text-(--mws-muted)">Intern</span>
                    ) : null}
                  </td>
                  <td className={`${denseCellClass} max-w-48 truncate text-(--mws-charcoal)`} title={assignment.job_position_name || undefined}>
                    {assignment.job_position_name || "-"}
                  </td>
                  <td className={`${denseCellClass} max-w-40 truncate text-(--mws-muted)`}>
                    {assignment.unit_name || "-"}
                  </td>
                  <td className={`${denseCellClass} whitespace-nowrap`}>
                    {formatStatus(assignment.role)}
                    {formatSubjectDetail(assignment) ? (
                      <span className="ml-1.5 text-xs text-(--mws-muted)">{formatSubjectDetail(assignment)}</span>
                    ) : null}
                  </td>
                  <td className={denseCellClass}>
                    <StatusBadge tone={STATUS_TONES[status]}>{formatStatus(status)}</StatusBadge>
                  </td>
                  <td className={denseCellClass}>
                    <AssignmentDurationCell
                      compact
                      startDate={assignment.start_date}
                      endDate={assignment.end_date}
                    />
                  </td>
                  {canWrite ? (
                    <td className={`${denseCellClass} text-right`}>
                      <TeacherAssignmentActions
                        assignment={assignment}
                        onEditStartDate={() =>
                          setStartDateDialog({ mode: "single", assignment })
                        }
                        onEnd={() => onEnd?.(assignment)}
                        onRemove={() => onRemove?.(assignment)}
                        onReopen={() => onReopen?.(assignment)}
                      />
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </DenseTable>
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
                disabled={!form.workforce_target || !form.start_date}
                loading={isAssigning}
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
              <PaginatedSingleSelect
                itemLabel="teacher or intern"
                options={candidates.map(candidateOption)}
                value={form.workforce_target}
                paging={candidatePaging}
                search={candidateSearch}
                isLoading={candidatesQuery.isLoading}
                emptyMessage="No teachers or interns match."
                onChange={(value) => {
                  const candidate = candidates.find(
                    (item) => candidateValue(item) === value,
                  );
                  setForm((current) => ({
                    ...current,
                    workforce_target: value,
                    subject:
                      current.role === "SUBJECT_TEACHER" && !current.subject
                        ? deriveSubjectFromJobPosition(
                            candidate?.employment?.job_position ||
                              candidate?.job_position,
                          )
                        : current.subject,
                  }));
                }}
                onSearchChange={(value) => {
                  setCandidateSearch(value);
                  setCandidatePage(1);
                }}
                onPageChange={setCandidatePage}
                onPageSizeChange={(size) => {
                  setCandidatePageSize(size);
                  setCandidatePage(1);
                }}
              />
              {form.workforce_target ? (
                <Link
                  to={candidateHref(form.workforce_target)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-(--mws-muted) hover:text-(--mws-burgundy)"
                >
                  <Eye size={14} />
                  Open teacher detail in a new tab
                </Link>
              ) : null}
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
                   setForm({ ...form, role: value, workforce_target: "" })
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
            <Field
              label="Start Date"
              hint={
                academicYearStartDate
                  ? `Starts on the academic year's first day. Pick a later date inside the year if the teacher joined mid-year.`
                  : undefined
              }
            >
              <DateField
                value={form.start_date}
                min={dateInputFromIso(academicYearStartDate) || undefined}
                max={dateInputFromIso(academicYearEndDate) || undefined}
                onChange={(event) =>
                  setForm({ ...form, start_date: event.target.value })
                }
              />
            </Field>
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
      {startDateDialog ? (
        <EditAssignmentStartDateDialog
          min={dateInputFromIso(academicYearStartDate) || undefined}
          max={dateInputFromIso(academicYearEndDate) || undefined}
          count={
            startDateDialog.mode === "bulk" ? selectedAssignments.length : 1
          }
          initialDate={
            startDateDialog.mode === "single"
              ? startDateDialog.assignment.start_date
              : selectedAssignments[0]?.start_date
          }
          isSubmitting={
            startDateDialog.mode === "bulk"
              ? isBulkUpdatingStartDate
              : isUpdatingStartDate
          }
          onClose={() => setStartDateDialog(null)}
          onSubmit={(startDate) => {
            if (startDateDialog.mode === "single") {
              onUpdateStartDate(startDateDialog.assignment.id, startDate);
            } else {
              onBulkUpdateStartDate(Array.from(selectedAssignmentIds), startDate);
              setSelectedAssignmentIds(new Set());
            }
            setStartDateDialog(null);
          }}
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
            disabled={!endDate}
            loading={isSubmitting}
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

function EditAssignmentStartDateDialog({
  min,
  max,
  count,
  initialDate,
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const [startDate, setStartDate] = useState(() => dateInputFromIso(initialDate));

  return (
    <CrudDialog
      title="Edit Start Date"
      description={`${count} assignment(s) will use the selected start date.`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="edit-assignment-start-date-form"
            type="submit"
            disabled={!startDate}
            loading={isSubmitting}
          >
            Save
          </Button>
        </>
      }
    >
      <form
        id="edit-assignment-start-date-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (startDate) onSubmit(isoFromDateInput(startDate));
        }}
      >
        <Field label="Start Date">
          <DateField
            value={startDate}
                min={min}
                max={max}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </Field>
      </form>
    </CrudDialog>
  );
}

function TeacherAssignmentActions({
  assignment,
  onEditStartDate,
  onEnd,
  onRemove,
  onReopen,
}) {
  return (
    <ActionsMenu label={`Actions for ${assignment.workforce_member?.full_name ?? assignment.employee?.full_name}`}>
      {(closeMenu) => (
        <>
          <ActionsMenuItem onClick={() => { closeMenu(); onEditStartDate(); }}>
            Edit Start Date
          </ActionsMenuItem>
          {assignment.end_date ? (
            <ActionsMenuItem onClick={() => { closeMenu(); onReopen(); }}>
              Reopen
            </ActionsMenuItem>
          ) : (
            <ActionsMenuItem onClick={() => { closeMenu(); onEnd(); }}>
              End
            </ActionsMenuItem>
          )}
          <ActionsMenuItem tone="danger" onClick={() => { closeMenu(); onRemove(); }}>
            Remove
          </ActionsMenuItem>
        </>
      )}
    </ActionsMenu>
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

function enumOptions(values) {
  return values.map((value) => ({ value, label: formatStatus(value) }));
}

function candidateType(candidate) {
  return candidate?.workforce_type || candidate?.type || "EMPLOYEE";
}

function candidateName(candidate) {
  return candidate?.identity?.full_name || candidate?.full_name || "Selected teacher";
}

function candidateValue(candidate) {
  return `${candidateType(candidate)}:${candidate.id}`;
}

function candidateOption(candidate) {
  const type = candidateType(candidate);
  return {
    value: candidateValue(candidate),
    label: `${candidateName(candidate)}${type === "INTERN" ? " (Intern)" : ""}`,
    description: candidate.employment?.job_position || candidate.job_position,
  };
}

function candidateTargetPayload(value) {
  const [type, id] = value.split(":");
  return type === "INTERN" ? { intern_id: id } : { employee_id: id };
}

function candidateHref(value) {
  const [type, id] = value.split(":");
  return type === "INTERN" ? `/interns/${id}` : `/employees/${id}`;
}
