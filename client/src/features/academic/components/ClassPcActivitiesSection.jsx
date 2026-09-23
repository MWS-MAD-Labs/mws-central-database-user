import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import {
  ChevronDown,
  Plus,
  Puzzle,
  RotateCcw,
  Trash2,
  UserCog,
  UserPlus,
} from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, SearchableSelect, TextInput } from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { PCActivityMentorsDialog } from "../../master-data/components/PCActivityMentorsDialog.jsx";
import { cn } from "../../../lib/cn.js";
import { enumOptions, formatStatus } from "../../../lib/format.js";
import { showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { pcDays, studentSensitiveApi } from "../../students/api/studentSensitiveApi.js";
import { classesApi } from "../api/academicApi.js";

const DAY_GROUP_PAGE_SIZE = 8;

function IconAction({ icon: Icon, label, tone, ...props }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        "shrink-0 rounded-lg p-2 transition-colors disabled:pointer-events-none disabled:opacity-40",
        tone === "danger"
          ? "text-(--mws-muted) hover:bg-[#fff0f1] hover:text-[#9f3d41]"
          : "text-(--mws-muted) hover:bg-(--mws-soft) hover:text-(--mws-burgundy)",
      )}
      {...props}
    >
      <Icon size={16} />
    </button>
  );
}

export function ClassPcActivitiesSection({
  classId,
  offerings,
  isLoading,
  error,
  canWrite,
  classUnitId,
  activityOptions,
  rosterStudents,
  hasStudentAccess,
  isAssigning,
  onAssign,
  isRemoving,
  onRemove,
  isBulkEnrolling,
  onBulkEnroll,
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [enrollFor, setEnrollFor] = useState(null);
  const [mentorFor, setMentorFor] = useState(null);
  const [viewStudentsFor, setViewStudentsFor] = useState(null);
  const [closedDays, setClosedDays] = useState(() => new Set());
  const [dayPage, setDayPage] = useState({});
  const confirm = useConfirm();

  const offeredDaysByActivity = new Map();
  offerings.forEach((offering) => {
    const days = offeredDaysByActivity.get(offering.activity_id) || new Set();
    days.add(offering.day);
    offeredDaysByActivity.set(offering.activity_id, days);
  });

  const offeringsByDay = new Map();
  offerings.forEach((offering) => {
    const list = offeringsByDay.get(offering.day) || [];
    list.push(offering);
    offeringsByDay.set(offering.day, list);
  });
  const daysWithOfferings = pcDays.filter(
    (day) => (offeringsByDay.get(day) || []).length > 0,
  );

  function toggleDay(day) {
    setClosedDays((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  async function handleRemove(offering) {
    const confirmed = await confirm({
      title: "Remove PC activity",
      description: `Remove "${offering.activity_name}" (${formatStatus(offering.day)}) from this class? Any enrolled students must be removed first.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (confirmed) onRemove(offering.id);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-lg font-bold text-(--mws-charcoal)">
          <Puzzle size={18} />
          PC Activities
        </h3>
        {canWrite ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAssignOpen(true)}
          >
            <Plus size={14} />
            Assign activity
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <PanelMessage>Loading PC activities…</PanelMessage>
      ) : error ? (
        <PanelMessage tone="error">PC activities are unavailable.</PanelMessage>
      ) : offerings.length === 0 ? (
        <PanelMessage>No PC activities assigned to this class yet.</PanelMessage>
      ) : (
        <div className="space-y-3">
          {daysWithOfferings.map((day) => {
            const dayOfferings = offeringsByDay.get(day) || [];
            const isOpen = !closedDays.has(day);
            const page = dayPage[day] || 1;
            const totalPages = Math.max(
              Math.ceil(dayOfferings.length / DAY_GROUP_PAGE_SIZE),
              1,
            );
            const clampedPage = Math.min(page, totalPages);
            const pagedOfferings = dayOfferings.slice(
              (clampedPage - 1) * DAY_GROUP_PAGE_SIZE,
              clampedPage * DAY_GROUP_PAGE_SIZE,
            );

            return (
              <div
                key={day}
                className="overflow-hidden rounded-xl border border-(--mws-line) bg-white"
              >
                <button
                  type="button"
                  onClick={() => toggleDay(day)}
                  className="flex w-full items-center justify-between gap-2 px-4 py-3 hover:bg-(--mws-soft)"
                >
                  <span className="flex items-center gap-2 font-display text-sm font-bold text-(--mws-charcoal)">
                    <ChevronDown
                      size={16}
                      className={cn(
                        "text-(--mws-muted) transition-transform",
                        isOpen ? "rotate-180" : "",
                      )}
                    />
                    {formatStatus(day)}
                  </span>
                  <span className="text-xs text-(--mws-muted)">
                    {dayOfferings.length} activit
                    {dayOfferings.length === 1 ? "y" : "ies"}
                  </span>
                </button>

                {isOpen ? (
                  <div className="divide-y divide-(--mws-line) border-t border-(--mws-line)">
                    {pagedOfferings.map((offering) => (
                      <div
                        key={offering.id}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-(--mws-charcoal)">
                            {offering.activity_name}
                          </p>
                          <p className="mt-0.5 truncate text-xs">
                            {offering.mentor_name ? (
                              <Link
                                to={
                                  offering.mentor_type === "INTERN"
                                    ? `/interns/${offering.mentor_id}`
                                    : `/employees/${offering.mentor_id}`
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="text-(--mws-charcoal) hover:text-(--mws-burgundy) hover:underline"
                              >
                                {offering.mentor_name}
                              </Link>
                            ) : (
                              <span className="text-[#805b18]">No mentor</span>
                            )}
                            {" · "}
                            <button
                              type="button"
                              onClick={() => setViewStudentsFor(offering)}
                              className="text-(--mws-muted) underline decoration-dotted underline-offset-2 hover:text-(--mws-burgundy)"
                            >
                              {offering.enrolled_count} student
                              {offering.enrolled_count === 1 ? "" : "s"}
                            </button>
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          {canWrite ? (
                            <IconAction
                              icon={UserCog}
                              label={
                                offering.mentor_name
                                  ? "Change mentor"
                                  : "Set mentor"
                              }
                              onClick={() => {
                                const activity = activityOptions.find(
                                  (item) => item.id === offering.activity_id,
                                );
                                setMentorFor(
                                  activity || {
                                    id: offering.activity_id,
                                    name: offering.activity_name,
                                  },
                                );
                              }}
                            />
                          ) : null}
                          {canWrite && hasStudentAccess ? (
                            <IconAction
                              icon={UserPlus}
                              label="Enroll students"
                              onClick={() => setEnrollFor(offering)}
                            />
                          ) : null}
                          {canWrite ? (
                            <IconAction
                              icon={Trash2}
                              label="Remove offering"
                              tone="danger"
                              disabled={isRemoving}
                              onClick={() => handleRemove(offering)}
                            />
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {isOpen && dayOfferings.length > DAY_GROUP_PAGE_SIZE ? (
                  <PaginationBar
                    paging={{
                      current_page: clampedPage,
                      total_page: totalPages,
                      total_item: dayOfferings.length,
                      size: DAY_GROUP_PAGE_SIZE,
                    }}
                    itemLabel="activities"
                    onPrevious={() =>
                      setDayPage((current) => ({
                        ...current,
                        [day]: Math.max(clampedPage - 1, 1),
                      }))
                    }
                    onNext={() =>
                      setDayPage((current) => ({
                        ...current,
                        [day]: Math.min(clampedPage + 1, totalPages),
                      }))
                    }
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {assignOpen ? (
        <AssignActivityDialog
          activityOptions={activityOptions}
          offeredDaysByActivity={offeredDaysByActivity}
          isSubmitting={isAssigning}
          onClose={() => setAssignOpen(false)}
          onSubmit={(payload) => {
            onAssign(payload);
            setAssignOpen(false);
          }}
        />
      ) : null}

      {enrollFor ? (
        <BulkEnrollStudentsDialog
          classId={classId}
          offering={enrollFor}
          rosterStudents={rosterStudents}
          isSubmitting={isBulkEnrolling}
          onClose={() => setEnrollFor(null)}
          onSubmit={(studentIds) => {
            onBulkEnroll(enrollFor.id, studentIds);
            setEnrollFor(null);
          }}
        />
      ) : null}

      {mentorFor ? (
        <PCActivityMentorsDialog
          activity={mentorFor}
          canWrite={canWrite}
          restrictToUnitId={classUnitId}
          onClose={() => setMentorFor(null)}
        />
      ) : null}

      {viewStudentsFor ? (
        <EnrolledStudentsDialog
          classId={classId}
          offering={viewStudentsFor}
          onClose={() => setViewStudentsFor(null)}
        />
      ) : null}
    </div>
  );
}

function AssignActivityDialog({
  activityOptions,
  offeredDaysByActivity,
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const [activityId, setActivityId] = useState("");
  const [day, setDay] = useState(pcDays[0]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const activityError =
    hasAttemptedSubmit && !activityId ? "Activity is required." : undefined;
  const dayAlreadyOffered = activityId
    ? (offeredDaysByActivity.get(activityId) || new Set()).has(day)
    : false;

  function submit(event) {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    if (!activityId) return;
    onSubmit({ activity_id: activityId, day });
  }

  return (
    <CrudDialog
      title="Assign PC Activity"
      description="Only activities allowed for this class's unit are shown."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="assign-pc-activity-form"
            type="submit"
            disabled={isSubmitting || !activityId}
            loading={isSubmitting}
          >
            <Plus size={16} />
            Assign
          </Button>
        </>
      }
    >
      <form
        id="assign-pc-activity-form"
        onSubmit={submit}
        noValidate
        className="grid gap-3"
      >
        <Field label="Activity" error={activityError}>
          <SearchableSelect
            required={hasAttemptedSubmit}
            value={activityId}
            onChange={setActivityId}
            options={activityOptions.map((activity) => ({
              value: activity.id,
              label: activity.name,
            }))}
            placeholder="Select Activity"
            searchPlaceholder="Search Activity"
          />
        </Field>
        <Field
          label="Day"
          hint={
            dayAlreadyOffered
              ? "This activity is already offered on this day for this class."
              : undefined
          }
        >
          <SearchableSelect
            value={day}
            onChange={setDay}
            options={enumOptions(pcDays)}
            placeholder="Select Day"
            searchPlaceholder="Search Day"
          />
        </Field>
      </form>
    </CrudDialog>
  );
}

function BulkEnrollStudentsDialog({
  classId,
  offering,
  rosterStudents,
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState("");

  const rosterStatusQuery = useQuery({
    queryKey: ["classes", classId, "pc-activities", offering.id, "roster-status"],
    queryFn: () => classesApi.pcActivityRosterStatus(classId, offering.id),
  });
  const statusByStudentId = new Map(
    (rosterStatusQuery.data || []).map((status) => [status.student_id, status]),
  );
  const enrollableStudents = rosterStudents.filter(
    (student) => !statusByStudentId.get(student.id)?.already_enrolled,
  );

  const searchTerm = search.trim().toLowerCase();
  const filteredStudents = searchTerm
    ? enrollableStudents.filter((student) =>
        `${student.full_name} ${student.nis || ""}`
          .toLowerCase()
          .includes(searchTerm),
      )
    : enrollableStudents;
  const eligibleStudents = filteredStudents.filter(
    (student) => !statusByStudentId.get(student.id)?.other_activity,
  );
  const allSelected =
    eligibleStudents.length > 0 &&
    eligibleStudents.every((student) => selectedIds.includes(student.id));

  function toggleStudent(studentId) {
    setSelectedIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId],
    );
  }

  function toggleAll(checked) {
    setSelectedIds((current) => {
      const eligibleIds = new Set(eligibleStudents.map((s) => s.id));
      if (checked) return Array.from(new Set([...current, ...eligibleIds]));
      return current.filter((id) => !eligibleIds.has(id));
    });
  }

  function submit(event) {
    event.preventDefault();
    if (selectedIds.length === 0) return;
    onSubmit(selectedIds);
  }

  return (
    <CrudDialog
      title={`Enroll Students Into ${offering.activity_name}`}
      description={`${formatStatus(offering.day)}. Only this class's own roster can be enrolled here.`}
      onClose={onClose}
      panelClassName="max-w-2xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="bulk-enroll-pc-activity-form"
            type="submit"
            disabled={isSubmitting || selectedIds.length === 0}
            loading={isSubmitting}
          >
            <UserPlus size={16} />
            Enroll {selectedIds.length > 0 ? selectedIds.length : ""}
          </Button>
        </>
      }
    >
      <form
        id="bulk-enroll-pc-activity-form"
        onSubmit={submit}
        noValidate
        className="grid gap-3"
      >
        <TextInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search Name or NIS"
        />
        <div className="overflow-hidden rounded-xl border border-(--mws-line) bg-white">
          {eligibleStudents.length > 0 ? (
            <label className="flex cursor-pointer items-center gap-3 border-b border-(--mws-line) bg-(--mws-soft) px-3 py-2 text-sm font-semibold text-(--mws-charcoal)">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-(--mws-burgundy)"
                checked={allSelected}
                onChange={(event) => toggleAll(event.target.checked)}
              />
              Select all {eligibleStudents.length} eligible student
              {eligibleStudents.length === 1 ? "" : "s"}
            </label>
          ) : null}
          {rosterStatusQuery.isLoading ? (
            <p className="p-3 text-sm leading-6 text-(--mws-muted)">
              Checking roster availability…
            </p>
          ) : filteredStudents.length === 0 ? (
            <p className="p-3 text-sm leading-6 text-(--mws-muted)">
              No students match.
            </p>
          ) : (
            <div className="max-h-80 divide-y divide-(--mws-line) overflow-y-auto">
              {filteredStudents.map((student) => {
                const otherActivity = statusByStudentId.get(student.id)?.other_activity;
                return (
                  <label
                    key={student.id}
                    className={`flex min-w-0 items-center gap-3 px-3 py-2 ${
                      otherActivity
                        ? "cursor-not-allowed opacity-60"
                        : "cursor-pointer hover:bg-(--mws-soft)"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-(--mws-burgundy)"
                      checked={selectedIds.includes(student.id)}
                      disabled={Boolean(otherActivity)}
                      onChange={() => toggleStudent(student.id)}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-display text-sm font-bold text-(--mws-charcoal)">
                        {student.full_name}
                      </p>
                      <p className="truncate text-xs text-(--mws-muted)">
                        {otherActivity
                          ? `Already has "${otherActivity.activity_name}" (${formatStatus(otherActivity.day)})`
                          : student.nis || "No NIS yet"}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <p className="text-xs font-semibold text-(--mws-muted)">
          {selectedIds.length} student{selectedIds.length === 1 ? "" : "s"}{" "}
          selected.
        </p>
      </form>
    </CrudDialog>
  );
}

const ENROLLED_STUDENTS_PAGE_SIZE = 10;

function EnrolledStudentsDialog({ classId, offering, onClose }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  // remove()/restore() are SUPER_ADMIN-only server-side (pc-activity-service.ts).
  const canDecide = user?.role === "SUPER_ADMIN";

  const studentsQuery = useQuery({
    queryKey: ["classes", classId, "pc-activities", offering.id, "enrolled-students"],
    queryFn: () => classesApi.pcActivityEnrolledStudents(classId, offering.id),
  });

  function invalidate(studentId) {
    queryClient.invalidateQueries({
      queryKey: ["classes", classId, "pc-activities"],
    });
    queryClient.invalidateQueries({
      queryKey: ["students", studentId, "pc-activities"],
    });
  }

  const removeMutation = useMutation({
    mutationFn: (row) => studentSensitiveApi.removePcActivity(row.student_id, row.id),
    onSuccess: (_, row) => {
      invalidate(row.student_id);
      showSuccessToast("Enrollment removed.");
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (row) => studentSensitiveApi.restorePcActivity(row.student_id, row.id),
    onSuccess: (_, row) => {
      invalidate(row.student_id);
      showSuccessToast("Enrollment restored.");
    },
  });

  async function handleRemove(row) {
    const confirmed = await confirm({
      title: "Remove student from PC activity",
      description: `Remove ${row.student_name} from "${offering.activity_name}"? This can be rolled back afterward.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (confirmed) removeMutation.mutate(row);
  }

  const rows = studentsQuery.data || [];
  const totalPages = Math.max(
    Math.ceil(rows.length / ENROLLED_STUDENTS_PAGE_SIZE),
    1,
  );
  const clampedPage = Math.min(page, totalPages);
  const pagedRows = rows.slice(
    (clampedPage - 1) * ENROLLED_STUDENTS_PAGE_SIZE,
    clampedPage * ENROLLED_STUDENTS_PAGE_SIZE,
  );
  // Grouped by status per page - active rows sort first from the API, so
  // this only splits what's already contiguous, it doesn't re-sort.
  const activeRows = pagedRows.filter((row) => row.deleted_at === null);
  const removedRows = pagedRows.filter((row) => row.deleted_at !== null);

  function renderRow(row, zebraIndex) {
    const isRemoved = row.deleted_at !== null;
    return (
      <tr
        key={row.id}
        className={`border-t border-(--mws-line) hover:bg-(--mws-soft) ${
          zebraIndex % 2 === 1 ? "bg-(--mws-soft)" : "bg-white"
        }`}
      >
        <td className="px-3 py-2">
          <Link
            to={`/students/${row.student_id}`}
            target="_blank"
            rel="noreferrer"
            className="font-display font-semibold text-(--mws-charcoal) hover:text-(--mws-burgundy) hover:underline"
          >
            {row.student_name}
          </Link>
        </td>
        <td className="px-3 py-2 text-(--mws-muted)">
          {row.nis || "No NIS yet"}
        </td>
        <td className="px-3 py-2">
          {isRemoved ? (
            <StatusBadge tone="red">Removed</StatusBadge>
          ) : row.still_on_roster ? (
            <StatusBadge tone="green">On roster</StatusBadge>
          ) : (
            <StatusBadge tone="amber">Left the class</StatusBadge>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          {canDecide ? (
            isRemoved ? (
              <IconAction
                icon={RotateCcw}
                label="Restore"
                disabled={restoreMutation.isPending}
                onClick={() => restoreMutation.mutate(row)}
              />
            ) : (
              <IconAction
                icon={Trash2}
                label="Remove"
                tone="danger"
                disabled={removeMutation.isPending}
                onClick={() => handleRemove(row)}
              />
            )
          ) : null}
        </td>
      </tr>
    );
  }

  function renderGroupLabel(label, count) {
    return (
      <tr>
        <td
          colSpan={4}
          className="bg-white px-3 pt-3 pb-1 font-display text-xs font-bold tracking-wide text-(--mws-muted) uppercase"
        >
          {label} ({count})
        </td>
      </tr>
    );
  }

  return (
    <CrudDialog
      title={`Students Enrolled In ${offering.activity_name}`}
      description={`${formatStatus(offering.day)}. Removed students stay listed here and can be rolled back.`}
      onClose={onClose}
      panelClassName="max-w-2xl"
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {studentsQuery.isLoading ? (
        <PanelMessage>Loading students…</PanelMessage>
      ) : rows.length === 0 ? (
        <PanelMessage>No students enrolled in this offering yet.</PanelMessage>
      ) : (
        <div className="overflow-hidden rounded-xl border border-(--mws-line)">
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
                <tr>
                  <th className="px-3 py-2">Student</th>
                  <th className="px-3 py-2">NIS</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {activeRows.length > 0 ? (
                  <>
                    {renderGroupLabel("Active", activeRows.length)}
                    {activeRows.map((row, index) => renderRow(row, index))}
                  </>
                ) : null}
                {removedRows.length > 0 ? (
                  <>
                    {renderGroupLabel("Removed", removedRows.length)}
                    {removedRows.map((row, index) => renderRow(row, index))}
                  </>
                ) : null}
              </tbody>
            </table>
          </div>
          {rows.length > ENROLLED_STUDENTS_PAGE_SIZE ? (
            <PaginationBar
              paging={{
                current_page: clampedPage,
                total_page: totalPages,
                total_item: rows.length,
                size: ENROLLED_STUDENTS_PAGE_SIZE,
              }}
              itemLabel="students"
              onPrevious={() => setPage((current) => Math.max(current - 1, 1))}
              onNext={() => setPage((current) => Math.min(current + 1, totalPages))}
            />
          ) : null}
        </div>
      )}
    </CrudDialog>
  );
}
