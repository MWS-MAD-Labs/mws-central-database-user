import { useDeferredValue, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "../../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../../components/ui/CrudDialog.jsx";
import {
  Field,
  SearchableSelect,
  TextInput,
} from "../../../../components/ui/FormControls.jsx";
import { defaultPaging } from "../../../master-data/utils/params.js";
import { dateInputFromIso, isoFromDateInput } from "../../../../lib/form.js";
import { formatStatus } from "../../../../lib/format.js";
import { showBulkFailureToast, showErrorToast, showSuccessToast } from "../../../../lib/toast.js";
import { academicYearsApi, pcActivityRoomsApi } from "../../api/academicApi.js";
import { PaginatedCandidatePicker } from "./PaginatedCandidatePicker.jsx";

export function StartDateDialog({
  title = "Edit Start Date",
  initialDate,
  count = 1,
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const [startDate, setStartDate] = useState(dateInputFromIso(initialDate));
  return (
    <CrudDialog
      title={title}
      description={`Update the start date for ${count} assignment${count === 1 ? "" : "s"}.`}
      onClose={onClose}
      panelClassName="max-w-md"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            disabled={!startDate}
            loading={isSubmitting}
            onClick={() => onSubmit(isoFromDateInput(startDate))}
          >
            Save Date
          </Button>
        </>
      }
    >
      <Field label="Start Date">
        <TextInput
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
      </Field>
    </CrudDialog>
  );
}

export function MoveAssignmentsDialog({
  room,
  count,
  kind,
  promote = false,
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const [targetRoomId, setTargetRoomId] = useState("");
  const yearsQuery = useQuery({
    queryKey: ["academic-years", "pc-room-assignment-targets"],
    queryFn: () => academicYearsApi.list({
      page: 1,
      size: 100,
      sort_by: "start_date",
      sort_order: "asc",
    }),
  });
  const years = yearsQuery.data?.data || [];
  const currentYear = years.find((year) => year.id === room.academic_year_id);
  const targetYearId = promote
    ? years
        .filter(
          (year) =>
            new Date(year.start_date).getTime() >
            new Date(currentYear?.start_date || room.start_date).getTime(),
        )
        .sort(
          (left, right) =>
            new Date(left.start_date).getTime() -
            new Date(right.start_date).getTime(),
        )[0]?.id
    : room.academic_year_id;
  const roomsQuery = useQuery({
    queryKey: ["pc-activity-rooms", "assignment-targets", room.id, targetYearId],
    queryFn: () =>
      pcActivityRoomsApi.list({
        page: 1,
        size: 100,
        academic_year_id: targetYearId,
      }),
    enabled: Boolean(targetYearId),
  });
  const rooms = (roomsQuery.data?.data || []).filter(
    (candidate) => candidate.id !== room.id,
  );
  const noun = kind === "student" ? "Student" : "Mentor";

  return (
    <CrudDialog
      title={`${promote ? "Promote" : "Move"} ${noun}${count === 1 ? "" : "s"}`}
      description={`${count} assignment${count === 1 ? "" : "s"} will be ${promote ? "scheduled in the next academic year" : "moved immediately"}.`}
      onClose={onClose}
      panelClassName="max-w-lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            disabled={!targetRoomId}
            loading={isSubmitting}
            onClick={() => onSubmit(targetRoomId)}
          >
            {promote ? "Promote" : "Move"}
          </Button>
        </>
      }
    >
      <Field label="Target Room">
        <SearchableSelect
          value={targetRoomId}
          onChange={setTargetRoomId}
          options={rooms.map((candidate) => ({
            value: candidate.id,
            label: `${candidate.display_name} / ${formatStatus(candidate.day)}`,
            description: candidate.academic_year_name,
          }))}
          placeholder={roomsQuery.isLoading ? "Loading rooms..." : "Select target room"}
          searchPlaceholder="Search rooms"
        />
      </Field>
    </CrudDialog>
  );
}

function useCandidateState(room, kind) {
  const [params, setParams] = useState({ page: 1, size: 10, search: "" });
  const deferredSearch = useDeferredValue(params.search);
  const requestParams = {
    ...params,
    search: deferredSearch,
    ...(kind === "student" ? { available_only: true } : {}),
  };
  const query = useQuery({
    queryKey: ["pc-activity-room-eligible", kind, room.id, requestParams],
    queryFn: () =>
      kind === "student"
        ? pcActivityRoomsApi.listEligibleStudents(room.id, requestParams)
        : pcActivityRoomsApi.listEligibleMentors(room.id, requestParams),
  });
  const [selected, setSelected] = useState(() => new Map());
  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }));
  }
  function toggle(item, checked) {
    setSelected((current) => {
      const next = new Map(current);
      if (checked) next.set(item.id, item);
      else next.delete(item.id);
      return next;
    });
  }
  function togglePage(checked, items) {
    setSelected((current) => {
      const next = new Map(current);
      items.forEach((item) => {
        if (checked) next.set(item.id, item);
        else next.delete(item.id);
      });
      return next;
    });
  }
  return { params, updateParams, query, selected, toggle, togglePage };
}

export function AddStudentsDialog({ room, remainingSlots, onClose, onAdded }) {
  const state = useCandidateState(room, "student");
  const [startDate, setStartDate] = useState(dateInputFromIso(room.start_date));
  const rows = state.query.data?.data || [];
  const paging = state.query.data?.paging || defaultPaging(state.params);
  const items = rows.map((student) => ({
    id: student.student_id,
    label: student.full_name,
    sublabel: [student.nis, student.grade_name, student.class_name]
      .filter(Boolean)
      .join(" / "),
    extra: student.other_activity
      ? `Also in ${student.other_activity.activity_name}`
      : null,
  }));
  const assignMutation = useMutation({
    mutationFn: () =>
      pcActivityRoomsApi.bulkAssignStudents(room.id, {
        student_ids: Array.from(state.selected.keys()),
        start_date: isoFromDateInput(startDate),
      }),
    onSuccess: () => {
      showSuccessToast(`${state.selected.size} student(s) assigned.`);
      onAdded();
      onClose();
    },
    onError: (error) => showErrorToast(error, "Could not assign students."),
  });

  function toggle(item, checked) {
    if (checked && state.selected.size >= remainingSlots) {
      showErrorToast("This room has no more available student slots.");
      return;
    }
    state.toggle(item, checked);
  }

  return (
    <CrudDialog
      title="Add Students"
      description="Search eligible students on the server. Selections stay checked across pages."
      onClose={onClose}
      panelClassName="max-w-2xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            disabled={state.selected.size === 0 || !startDate}
            loading={assignMutation.isPending}
            onClick={() => assignMutation.mutate()}
          >
            Assign Students
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Start Date" hint="Defaults to the room start date and can be changed manually.">
          <TextInput type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </Field>
        <PaginatedCandidatePicker
          items={items}
          selected={state.selected}
          paging={paging}
          search={state.params.search}
          isLoading={state.query.isLoading}
          emptyMessage="No eligible students match."
          itemLabel="student"
          onSearchChange={(search) => state.updateParams({ page: 1, search })}
          onToggle={toggle}
          onTogglePage={(checked, pageItems) => {
            const available = Math.max(remainingSlots - state.selected.size, 0);
            state.togglePage(checked, checked ? pageItems.slice(0, available) : pageItems);
          }}
          onPageChange={(page) => state.updateParams({ page })}
          onPageSizeChange={(size) => state.updateParams({ page: 1, size })}
        />
      </div>
    </CrudDialog>
  );
}

export function AddMentorDialog({ room, remainingSlots, onClose, onAdded }) {
  const state = useCandidateState(room, "mentor");
  const [startDate, setStartDate] = useState(dateInputFromIso(room.start_date));
  const rows = state.query.data?.data || [];
  const paging = state.query.data?.paging || defaultPaging(state.params);
  const items = rows.map((mentor) => ({
    id: `${mentor.type}:${mentor.id}`,
    label: mentor.name,
    sublabel: [mentor.type, mentor.unit_name]
      .filter(Boolean)
      .join(" / "),
    source: mentor,
  }));
  const assignMutation = useMutation({
    mutationFn: () =>
      pcActivityRoomsApi.bulkAssignMentors(room.id, {
        targets: Array.from(state.selected.values()).map((item) => {
          const [type, id] = item.id.split(":");
          return type === "INTERN" ? { intern_id: id } : { employee_id: id };
        }),
        start_date: isoFromDateInput(startDate),
      }),
    onSuccess: (result) => {
      if (result.success_count > 0) showSuccessToast(`${result.success_count} mentor(s) assigned.`);
      if (result.failed_count > 0) showBulkFailureToast("mentor(s) failed to assign", result);
      onAdded();
      onClose();
    },
    onError: (error) => showErrorToast(error, "Could not assign mentors."),
  });

  function toggle(item, checked) {
    if (checked && state.selected.size >= remainingSlots) {
      showErrorToast("This room has no more available mentor slots.");
      return;
    }
    state.toggle(item, checked);
  }

  return (
    <CrudDialog
      title="Add Mentors"
      description="Search eligible employees and interns on the server. Selections stay checked across pages."
      onClose={onClose}
      panelClassName="max-w-2xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            disabled={state.selected.size === 0 || !startDate}
            loading={assignMutation.isPending}
            onClick={() => assignMutation.mutate()}
          >
            Assign Mentors
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Start Date" hint="Defaults to the room start date and can be changed manually.">
          <TextInput type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </Field>
        <PaginatedCandidatePicker
          items={items}
          selected={state.selected}
          paging={paging}
          search={state.params.search}
          isLoading={state.query.isLoading}
          emptyMessage="No eligible mentors match."
          itemLabel="mentor"
          onSearchChange={(search) => state.updateParams({ page: 1, search })}
          onToggle={toggle}
          onTogglePage={(checked, pageItems) => {
            const available = Math.max(remainingSlots - state.selected.size, 0);
            state.togglePage(checked, checked ? pageItems.slice(0, available) : pageItems);
          }}
          onPageChange={(page) => state.updateParams({ page })}
          onPageSizeChange={(size) => state.updateParams({ page: 1, size })}
        />
      </div>
    </CrudDialog>
  );
}
