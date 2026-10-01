import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  CalendarClock,
  CalendarOff,
  MoveRight,
  RotateCcw,
  Trash2,
  UserRoundPlus,
  Users,
} from "lucide-react";
import { ActionsMenu, ActionsMenuItem } from "../../../../components/ui/ActionsMenu.jsx";
import { BulkActionBar } from "../../../../components/ui/BulkActionBar.jsx";
import { Button } from "../../../../components/ui/Button.jsx";
import { PaginationBar } from "../../../../components/ui/PaginationBar.jsx";
import { StatusBadge } from "../../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../../components/ui/useConfirm.js";
import { defaultPaging } from "../../../master-data/utils/params.js";
import { SearchBox } from "../../../master-data/components/SearchBox.jsx";
import { SelectFilter } from "../SelectFilter.jsx";
import { SortableHeader } from "../../../../components/ui/SortableHeader.jsx";
import { formatDate, formatStatus } from "../../../../lib/format.js";
import { showBulkFailureToast, showErrorToast, showSuccessToast } from "../../../../lib/toast.js";
import { pcActivityRoomsApi } from "../../api/academicApi.js";
import { assignmentDuration, humanizeAssignmentDuration } from "../../utils/assignmentDuration.js";
import {
  AddMentorDialog,
  AddStudentsDialog,
  MoveAssignmentsDialog,
  StartDateDialog,
} from "./AssignmentDialogs.jsx";

const MAX_ROOM_STUDENTS = 100;
const MAX_ROOM_MENTORS = 3;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "EXPIRED", label: "Expired" },
  { value: "ENDED", label: "Ended" },
];

function statusTone(status) {
  if (status === "ACTIVE") return "green";
  if (status === "SCHEDULED") return "blue";
  if (status === "EXPIRED") return "amber";
  return "neutral";
}

function AssignmentActions({ row, kind, onAction }) {
  const isEnded = row.status === "ENDED";
  const removeLabel = kind === "student" ? "Drop / remove" : "Remove";
  return (
    <ActionsMenu label={`Actions for ${kind === "student" ? row.student_name : row.mentor_name}`}>
      {(close) => (
        <>
          <ActionsMenuItem onClick={() => { close(); onAction("date", row); }}>
            <span className="flex items-center gap-2"><CalendarClock size={15} />Edit start date</span>
          </ActionsMenuItem>
          {!isEnded ? (
            <>
              <ActionsMenuItem onClick={() => { close(); onAction("move", row); }}>
                <span className="flex items-center gap-2"><MoveRight size={15} />Move</span>
              </ActionsMenuItem>
              <ActionsMenuItem onClick={() => { close(); onAction("promote", row); }}>
                <span className="flex items-center gap-2"><MoveRight size={15} />Promote to next year</span>
              </ActionsMenuItem>
              <ActionsMenuItem onClick={() => { close(); onAction("end", row); }}>
                <span className="flex items-center gap-2"><CalendarOff size={15} />End</span>
              </ActionsMenuItem>
            </>
          ) : (
            <ActionsMenuItem onClick={() => { close(); onAction("reopen", row); }}>
              <span className="flex items-center gap-2"><RotateCcw size={15} />Reopen</span>
            </ActionsMenuItem>
          )}
          <div className="my-1 border-t border-(--mws-line)" />
          <ActionsMenuItem tone="danger" onClick={() => { close(); onAction("remove", row); }}>
            <span className="flex items-center gap-2"><Trash2 size={15} />{removeLabel}</span>
          </ActionsMenuItem>
        </>
      )}
    </ActionsMenu>
  );
}

function RoomAssignmentsSection({ room, canManage, kind }) {
  const isStudent = kind === "student";
  const label = isStudent ? "student" : "mentor";
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    search: "",
    status: "",
    sort_by: "start_date",
    sort_order: "desc",
  });
  const [selected, setSelected] = useState(() => new Map());
  const [dialog, setDialog] = useState(null);
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [`pc-activity-room-${label}s`, room.id, params],
    queryFn: () =>
      isStudent
        ? pcActivityRoomsApi.listStudents(room.id, params)
        : pcActivityRoomsApi.listMentors(room.id, params),
  });
  const rows = query.data?.data || [];
  const paging = query.data?.paging || defaultPaging(params);
  const pageSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const selectedRows = Array.from(selected.values());

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }));
  }
  function invalidate() {
    queryClient.invalidateQueries({ queryKey: [`pc-activity-room-${label}s`, room.id] });
    queryClient.invalidateQueries({ queryKey: ["pc-activity-room-eligible", label, room.id] });
    queryClient.invalidateQueries({ queryKey: ["pc-activity-rooms"] });
  }
  function togglePage(checked) {
    setSelected((current) => {
      const next = new Map(current);
      rows.forEach((row) => {
        if (checked) next.set(row.id, row);
        else next.delete(row.id);
      });
      return next;
    });
  }
  function toggleOne(row, checked) {
    setSelected((current) => {
      const next = new Map(current);
      if (checked) next.set(row.id, row);
      else next.delete(row.id);
      return next;
    });
  }
  function afterBulk(result, verb) {
    invalidate();
    setSelected(new Map());
    setDialog(null);
    if (result?.success_count > 0) showSuccessToast(`${result.success_count} ${label} assignment(s) ${verb}.`);
    if (result?.failed_count > 0) showBulkFailureToast(`assignment(s) failed to be ${verb}`, result);
  }

  const lifecycleMutation = useMutation({
    mutationFn: async ({ action, ids }) => {
      const payload = { assignment_ids: ids };
      if (isStudent) {
        if (action === "end") return pcActivityRoomsApi.bulkEndStudentAssignments(room.id, payload);
        if (action === "reopen") return pcActivityRoomsApi.bulkReopenStudentAssignments(room.id, payload);
        return pcActivityRoomsApi.bulkDropStudentAssignments(room.id, payload);
      }
      if (action === "end") return pcActivityRoomsApi.bulkEndMentorAssignments(room.id, payload);
      if (action === "reopen") return pcActivityRoomsApi.bulkReopenMentorAssignments(room.id, payload);
      return pcActivityRoomsApi.bulkRemoveMentorAssignments(room.id, payload);
    },
    onSuccess: (result, variables) => afterBulk(result, variables.action === "remove" ? "removed" : `${variables.action}ed`),
    onError: (error) => showErrorToast(error, `Could not update ${label} assignments.`),
  });
  const moveMutation = useMutation({
    mutationFn: ({ ids, targetRoomId }) => {
      const payload = { assignment_ids: ids, target_room_id: targetRoomId };
      return isStudent
        ? pcActivityRoomsApi.bulkMoveStudentAssignments(room.id, payload)
        : pcActivityRoomsApi.bulkMoveMentorAssignments(room.id, payload);
    },
    onSuccess: (result) => afterBulk(result, "moved"),
    onError: (error) => showErrorToast(error, `Could not move ${label} assignments.`),
  });
  const dateMutation = useMutation({
    mutationFn: ({ ids, startDate }) => {
      const payload = { assignment_ids: ids, start_date: startDate };
      if (ids.length === 1) {
        return isStudent
          ? pcActivityRoomsApi.updateStudentStartDate(room.id, ids[0], { start_date: startDate })
          : pcActivityRoomsApi.updateMentorStartDate(room.id, ids[0], { start_date: startDate });
      }
      return isStudent
        ? pcActivityRoomsApi.bulkUpdateStudentStartDates(room.id, payload)
        : pcActivityRoomsApi.bulkUpdateMentorStartDates(room.id, payload);
    },
    onSuccess: (result) => {
      invalidate();
      setSelected(new Map());
      setDialog(null);
      showSuccessToast(result?.success_count ? `${result.success_count} start date(s) updated.` : "Start date updated.");
    },
    onError: (error) => showErrorToast(error, "Could not update the start date."),
  });

  async function runLifecycle(action, targetRows) {
    const ids = targetRows.map((row) => row.id);
    const confirmed = await confirm({
      title: `${action === "remove" ? (isStudent ? "Drop" : "Remove") : formatStatus(action)} ${label} assignment${ids.length === 1 ? "" : "s"}`,
      description: `Apply this action to ${ids.length} assignment${ids.length === 1 ? "" : "s"}?`,
      confirmLabel: action === "remove" ? (isStudent ? "Drop" : "Remove") : formatStatus(action),
      tone: action === "remove" ? "danger" : undefined,
    });
    if (confirmed) lifecycleMutation.mutate({ action, ids });
  }
  function handleAction(action, row) {
    if (action === "date") setDialog({ type: "date", rows: [row] });
    else if (action === "move" || action === "promote") setDialog({ type: action, rows: [row] });
    else runLifecycle(action, [row]);
  }
  const sort = (column, order) => updateParams({ page: 1, sort_by: column, sort_order: order });
  const colSpan = canManage ? (isStudent ? 7 : 5) : isStudent ? 6 : 4;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchBox value={params.search} placeholder={`Search ${label}s`} onChange={(search) => updateParams({ page: 1, search })} />
          <SelectFilter value={params.status} options={STATUS_OPTIONS} onChange={(status) => updateParams({ page: 1, status })} placeholder="All statuses" />
        </div>
        {canManage ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setDialog({ type: "add" })}>
            {isStudent ? <UserRoundPlus size={15} /> : <Users size={15} />}
            Add {isStudent ? "Students" : "Mentors"}
          </Button>
        ) : null}
      </div>

      {canManage ? (
        <BulkActionBar selectedCount={selected.size} onClear={() => setSelected(new Map())}>
          <ActionsMenu label="Bulk Actions" disabled={selected.size === 0}>
            {(close) => (
              <>
                <ActionsMenuItem onClick={() => { close(); setDialog({ type: "date", rows: selectedRows }); }}>
                  <span className="flex items-center gap-2"><CalendarClock size={15} />Edit start date</span>
                </ActionsMenuItem>
                <ActionsMenuItem onClick={() => { close(); setDialog({ type: "move", rows: selectedRows }); }}>
                  <span className="flex items-center gap-2"><MoveRight size={15} />Move selected</span>
                </ActionsMenuItem>
                <ActionsMenuItem onClick={() => { close(); setDialog({ type: "promote", rows: selectedRows }); }}>
                  <span className="flex items-center gap-2"><MoveRight size={15} />Promote to next year</span>
                </ActionsMenuItem>
                <ActionsMenuItem onClick={() => { close(); runLifecycle("end", selectedRows); }}>
                  <span className="flex items-center gap-2"><CalendarOff size={15} />End selected</span>
                </ActionsMenuItem>
                <ActionsMenuItem disabled={!selectedRows.every((row) => row.status === "ENDED")} onClick={() => { close(); runLifecycle("reopen", selectedRows); }}>
                  <span className="flex items-center gap-2"><RotateCcw size={15} />Reopen selected</span>
                </ActionsMenuItem>
                <div className="my-1 border-t border-(--mws-line)" />
                <ActionsMenuItem tone="danger" onClick={() => { close(); runLifecycle("remove", selectedRows); }}>
                  <span className="flex items-center gap-2"><Trash2 size={15} />{isStudent ? "Drop" : "Remove"} selected</span>
                </ActionsMenuItem>
              </>
            )}
          </ActionsMenu>
        </BulkActionBar>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-(--mws-line)">
        <div className="overflow-x-auto">
          <table className={`w-full text-left text-sm ${isStudent ? "min-w-[940px]" : "min-w-[720px]"}`}>
            <thead className="bg-(--mws-soft) text-xs font-bold text-(--mws-muted)">
              <tr>
                {canManage ? <th className="w-12 px-4 py-3"><input type="checkbox" aria-label={`Select all ${label}s on this page`} checked={pageSelected} onChange={(event) => togglePage(event.target.checked)} className="h-4 w-4 accent-(--mws-burgundy)" /></th> : null}
                <th className="px-4 py-3"><SortableHeader label={isStudent ? "Student" : "Mentor"} column={isStudent ? "student_name" : "mentor_name"} sortBy={params.sort_by} sortOrder={params.sort_order} onSort={sort} /></th>
                {isStudent ? <th className="px-4 py-3">Class</th> : null}
                <th className="px-4 py-3"><SortableHeader label="Status" column="status" sortBy={params.sort_by} sortOrder={params.sort_order} onSort={sort} /></th>
                <th className="px-4 py-3"><SortableHeader label="Duration" column="start_date" sortBy={params.sort_by} sortOrder={params.sort_order} onSort={sort} /></th>
                {isStudent ? <th className="px-4 py-3">Expiry</th> : null}
                {canManage ? <th className="px-4 py-3 text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? <tr><td colSpan={colSpan} className="px-4 py-10 text-center text-(--mws-muted)">Loading {label}s...</td></tr> : rows.length === 0 ? <tr><td colSpan={colSpan} className="px-4 py-10 text-center text-(--mws-muted)">No {label} assignments match.</td></tr> : rows.map((row) => {
                const name = isStudent ? row.student_name : row.mentor_name;
                const href = isStudent ? `/students/${row.student_id}` : row.mentor_type === "INTERN" ? `/interns/${row.mentor_id}` : `/employees/${row.mentor_id}`;
                return (
                  <tr key={row.id} className="border-t border-(--mws-line) bg-white hover:bg-(--mws-soft)">
                    {canManage ? <td className="px-4 py-4"><input type="checkbox" aria-label={`Select ${name}`} checked={selected.has(row.id)} onChange={(event) => toggleOne(row, event.target.checked)} className="h-4 w-4 accent-(--mws-burgundy)" /></td> : null}
                    <td className="px-4 py-4"><Link to={href} target="_blank" rel="noreferrer" className="font-semibold text-(--mws-charcoal) hover:text-(--mws-burgundy) hover:underline">{name}</Link><p className="mt-1 text-xs text-(--mws-muted)">{isStudent ? row.nis || "No NIS" : formatStatus(row.mentor_type)}</p></td>
                    {isStudent ? <td className="px-4 py-4 text-(--mws-muted)">{row.class_name || "-"}</td> : null}
                    <td className="px-4 py-4"><StatusBadge tone={statusTone(row.status)}>{formatStatus(row.status)}</StatusBadge>{isStudent && !row.still_eligible ? <p className="mt-1"><StatusBadge tone="neutral" variant="text">Out of scope</StatusBadge></p> : null}</td>
                    <td className="px-4 py-4"><p className="font-medium text-(--mws-charcoal)">{assignmentDuration(row.start_date, row.end_date)}</p><p className="mt-1 text-xs text-(--mws-muted)">{humanizeAssignmentDuration(row.start_date, row.end_date)}</p></td>
                    {isStudent ? <td className="px-4 py-4"><p className={row.status === "EXPIRED" ? "font-bold text-[#9a5c00]" : "font-medium text-(--mws-charcoal)"}>{row.expires_at ? formatDate(row.expires_at) : "No expiry"}</p>{row.status === "EXPIRED" ? <p className="mt-1 text-xs font-semibold text-[#9a5c00]">Expired</p> : null}</td> : null}
                    {canManage ? <td className="px-4 py-4 text-right"><AssignmentActions row={row} kind={kind} onAction={handleAction} /></td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <PaginationBar paging={paging} itemLabel={`${label}s`} isLoading={query.isLoading} onPrevious={() => updateParams({ page: params.page - 1 })} onNext={() => updateParams({ page: params.page + 1 })} onPageChange={(page) => updateParams({ page })} onPageSizeChange={(size) => updateParams({ page: 1, size })} />
      </div>

      {dialog?.type === "add" && isStudent ? <AddStudentsDialog room={room} remainingSlots={Math.max(MAX_ROOM_STUDENTS - (room.student_count + (room.scheduled_count || 0)), 0)} onClose={() => setDialog(null)} onAdded={invalidate} /> : null}
      {dialog?.type === "add" && !isStudent ? <AddMentorDialog room={room} remainingSlots={Math.max(MAX_ROOM_MENTORS - (room.mentors?.length || 0), 0)} onClose={() => setDialog(null)} onAdded={invalidate} /> : null}
      {dialog?.type === "date" ? <StartDateDialog initialDate={dialog.rows.length === 1 ? dialog.rows[0].start_date : room.start_date} count={dialog.rows.length} isSubmitting={dateMutation.isPending} onClose={() => setDialog(null)} onSubmit={(startDate) => dateMutation.mutate({ ids: dialog.rows.map((row) => row.id), startDate })} /> : null}
      {dialog?.type === "move" || dialog?.type === "promote" ? <MoveAssignmentsDialog room={room} count={dialog.rows.length} kind={kind} promote={dialog.type === "promote"} isSubmitting={moveMutation.isPending} onClose={() => setDialog(null)} onSubmit={(targetRoomId) => moveMutation.mutate({ ids: dialog.rows.map((row) => row.id), targetRoomId })} /> : null}
    </div>
  );
}

export function RoomStudentsSection(props) {
  return <RoomAssignmentsSection {...props} kind="student" />;
}

export function RoomMentorsSection(props) {
  return <RoomAssignmentsSection {...props} kind="mentor" />;
}
