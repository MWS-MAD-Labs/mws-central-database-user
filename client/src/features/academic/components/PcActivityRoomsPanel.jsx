import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import {
  CalendarOff,
  Eye,
  MoveRight,
  Plus,
  Puzzle,
  RotateCcw,
  Trash2,
  UserRoundPlus,
  Users,
} from "lucide-react";
import {
  ActionsMenu,
  ActionsMenuItem,
} from "../../../components/ui/ActionsMenu.jsx";
import { BulkActionBar } from "../../../components/ui/BulkActionBar.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  CheckboxField,
  Field,
  SearchableSelect,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { ChecklistPicker } from "../../../components/ui/ChecklistPicker.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { FilterResetButton } from "../../../components/ui/FilterResetButton.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { enumOptions, formatDate, formatStatus } from "../../../lib/format.js";
import {
  showBulkFailureToast,
  showErrorToast,
  showSuccessToast,
} from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import {
  academicYearsApi,
  classesApi,
  gradesApi,
  pcActivityRoomsApi,
} from "../api/academicApi.js";
import { pcActivitiesApi } from "../../master-data/api/masterDataApi.js";
import { defaultPaging } from "../../master-data/utils/params.js";
import { distinctGradeUnits } from "../../master-data/utils/pcActivityUnits.js";
import { HeaderCell } from "../../master-data/components/HeaderCell.jsx";
import { LoadingRows } from "../../master-data/components/LoadingRows.jsx";
import { PanelFrame } from "../../master-data/components/PanelFrame.jsx";
import { RowActions } from "../../master-data/components/RowActions.jsx";
import { SearchBox } from "../../master-data/components/SearchBox.jsx";
import { SelectFilter } from "./SelectFilter.jsx";
import { useMentorOptions } from "../../master-data/hooks/useMentorOptions.js";
import { workforceTargetValue } from "../utils/selectOptions.js";

const DAY_VALUES = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY"];
const DAY_OPTIONS = enumOptions(DAY_VALUES);
const DURATION_OPTIONS = [
  {
    value: "HALF_SEMESTER",
    label: "Half Semester",
    description: "Half of one semester, about one academic quarter.",
  },
  {
    value: "SEMESTER",
    label: "One Semester",
    description: "From the academic year start through its midpoint.",
  },
  {
    value: "FULL_YEAR",
    label: "Full Academic Year",
    description: "The complete selected academic year.",
  },
  {
    value: "CUSTOM",
    label: "Custom Days",
    description: "A custom period, up to one semester.",
  },
];
const LEGACY_SIX_MONTHS_OPTION = {
  value: "SIX_MONTHS",
  label: "Six Months (Legacy)",
  description: "Existing data only. Use One Semester for new rooms.",
};
const DURATION_LABELS = {
  SIX_MONTHS: "Six Months",
  HALF_SEMESTER: "Half Semester",
  SEMESTER: "One Semester",
  FULL_YEAR: "Full Academic Year",
  CUSTOM: "Custom",
};
const MAX_ROOM_MENTORS = 3;
const MAX_ROOM_STUDENTS = 100;
const PROMOTE_WINDOW_DAYS = 30;

async function listAllClasses(academicYearId) {
  if (!academicYearId) return [];
  const first = await classesApi.list({
    page: 1,
    size: 100,
    academic_year_id: academicYearId,
    sort_by: "name",
    sort_order: "asc",
  });
  const rows = [...(first.data || [])];
  const totalPages = first.paging?.total_page || 1;
  for (let page = 2; page <= totalPages; page += 1) {
    const response = await classesApi.list({
      page,
      size: 100,
      academic_year_id: academicYearId,
      sort_by: "name",
      sort_order: "asc",
    });
    rows.push(...(response.data || []));
  }
  return rows;
}

export function PcActivityRoomsPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isSuperAdmin = user?.type === "admin" && user?.role === "SUPER_ADMIN";
  const isDatabaseAdmin =
    user?.type === "admin" && user?.role === "DATABASE_ADMIN";
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    search: "",
    academic_year_id: "",
    sort_by: "created_at",
    sort_order: "desc",
  });
  const [formDialog, setFormDialog] = useState(null);
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["pc-activity-rooms", params],
    queryFn: () => pcActivityRoomsApi.list(params),
  });
  const rooms = query.data?.data || [];
  const paging = query.data?.paging || defaultPaging(params);

  const gradesQuery = useQuery({
    queryKey: ["master-data", "grades", "all"],
    queryFn: () => gradesApi.list({ page: 1, size: 100 }),
  });
  const grades = gradesQuery.data?.data || [];
  const units = distinctGradeUnits(grades);

  const activitiesQuery = useQuery({
    queryKey: ["master-data", "pc-activities", "all"],
    queryFn: () => pcActivitiesApi.list({ page: 1, size: 100 }),
  });
  const activities = activitiesQuery.data?.data || [];

  const yearsQuery = useQuery({
    queryKey: ["academic-years", "pc-activity-rooms"],
    queryFn: () => academicYearsApi.list({ page: 1, size: 100 }),
  });
  const years = yearsQuery.data?.data || [];
  const activeYearId = years.find((year) => year.status === "ACTIVE")?.id || "";

  // One-time default once years load, so the filter opens on the active
  // year instead of "All academic years". Guarded so it never re-fires,
  // satisfying react-hooks/set-state-in-effect, and so clearing the filter
  // via FilterResetButton sticks afterward.
  const didDefaultFilterYearRef = useRef(false);
  useEffect(() => {
    if (didDefaultFilterYearRef.current || !activeYearId) return;
    didDefaultFilterYearRef.current = true;
    setParams((current) =>
      current.academic_year_id
        ? current
        : { ...current, academic_year_id: activeYearId },
    );
  }, [activeYearId]);

  const classesQuery = useQuery({
    queryKey: ["classes", "pc-activity-rooms"],
    queryFn: () => classesApi.list({ page: 1, size: 100 }),
  });
  const classes = classesQuery.data?.data || [];

  const dbAdminUnit = isDatabaseAdmin
    ? units.find((unit) => unit.id === user?.unit_id) || null
    : null;
  const canWrite = isSuperAdmin || (isDatabaseAdmin && Boolean(dbAdminUnit));
  function canManageRoom(room) {
    if (isSuperAdmin) return true;
    if (!isDatabaseAdmin) return false;
    return room.units.some((unit) => unit.id === user?.unit_id);
  }

  const removeMutation = useMutation({
    mutationFn: (roomId) => pcActivityRoomsApi.remove(roomId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pc-activity-rooms"] });
      showSuccessToast("Room deleted.");
    },
  });

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }));
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 });
  }

  async function handleDelete(room) {
    const confirmed = await confirm({
      title: "Delete room",
      description: `Delete "${room.display_name}"? End or correct every student assignment first.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (confirmed) {
      removeMutation.mutate(room.id);
    }
  }

  return (
    <PanelFrame
      title="PC Activity Rooms"
      description="Rooms are scoped to units and optional grades rather than a single class. Assign any eligible student here."
      icon={Puzzle}
      isFetching={query.isFetching}
      toolbar={
        <>
          <SearchBox
            value={params.search}
            placeholder="Search rooms"
            onChange={(value) => resetPageAndUpdate({ search: value })}
          />
          <SearchableSelect
            value={params.academic_year_id}
            onChange={(value) =>
              resetPageAndUpdate({ academic_year_id: value })
            }
            options={years.map((year) => ({
              value: year.id,
              label: year.name,
            }))}
            placeholder="All academic years"
            searchPlaceholder="Search years"
          />
          <FilterResetButton
            visible={Boolean(params.search || params.academic_year_id)}
            onReset={() =>
              resetPageAndUpdate({ search: "", academic_year_id: "" })
            }
          />
        </>
      }
      action={
        canWrite ? (
          <Button
            type="button"
            size="sm"
            onClick={() => setFormDialog({ mode: "create" })}
          >
            <Plus size={16} />
            Create Room
          </Button>
        ) : null
      }
      notice={
        !isSuperAdmin && !isDatabaseAdmin
          ? "Only Super Admin or your unit's Database Admin can manage PC Activity rooms."
          : isDatabaseAdmin && !dbAdminUnit
            ? "PC Activity rooms don't apply to your unit."
            : null
      }
    >
      <table className="w-full min-w-[1010px] table-fixed text-left text-sm">
        <colgroup>
          <col className="w-[250px]" />
          <col className="w-[100px]" />
          <col className="w-[150px]" />
          <col className="w-[180px]" />
          <col className="w-[100px]" />
          <col className="w-[230px]" />
        </colgroup>
        <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
          <tr>
            <th className="px-4 py-3">Room</th>
            <HeaderCell
              label="Day"
              column="day"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <th className="px-4 py-3">Coverage</th>
            <th className="px-4 py-3">Mentors</th>
            <th className="px-4 py-3">Students</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <LoadingRows
            isLoading={query.isLoading}
            isEmpty={rooms.length === 0}
            colSpan={6}
            label="PC Activity rooms"
          />
          {!query.isLoading
            ? rooms.map((room) => (
                <tr
                  key={room.id}
                  className="border-t border-(--mws-line) bg-white hover:bg-(--mws-soft)"
                >
                  <td className="px-4 py-3 align-middle">
                    <Link
                      to={`/academic/pc-activity-rooms/${room.id}`}
                      className="font-semibold text-(--mws-charcoal) hover:text-(--mws-burgundy) hover:underline"
                    >
                      {room.display_name}
                    </Link>
                    <p className="mt-1 truncate text-xs text-(--mws-muted)">
                      {room.academic_year_name} ·{" "}
                      {DURATION_LABELS[room.duration_type] ||
                        formatStatus(room.duration_type)}
                    </p>
                  </td>
                  <td className="px-4 py-3 align-middle font-medium text-(--mws-charcoal)">
                    {formatStatus(room.day)}
                  </td>
                  <td className="px-4 py-3 align-middle text-(--mws-muted)">
                    <p
                      className="truncate font-medium text-(--mws-charcoal)"
                      title={room.units.map((unit) => unit.name).join(", ")}
                    >
                      {room.units.map((unit) => unit.name).join(", ")}
                    </p>
                    {room.grades.length > 0 || room.classes.length > 0 ? (
                      <p
                        className="mt-1 truncate text-xs"
                        title={[
                          room.grades.length > 0
                            ? room.grades.map((grade) => grade.name).join(", ")
                            : null,
                          room.classes.length > 0
                            ? room.classes.map((klass) => klass.name).join(", ")
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      >
                        {room.grades.length > 0
                          ? `${room.grades.length} grade${room.grades.length === 1 ? "" : "s"}`
                          : "All grades"}
                        {room.classes.length > 0
                          ? ` · ${room.classes.length} class${room.classes.length === 1 ? "" : "es"}`
                          : ""}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-middle text-(--mws-muted)">
                    {room.mentors.length === 0 ? (
                      "No mentor"
                    ) : (
                      <p
                        className="truncate text-(--mws-charcoal)"
                        title={room.mentors
                          .map((mentor) => mentor.name)
                          .join(", ")}
                      >
                        {room.mentors[0].name}
                        {room.mentors.length > 1
                          ? ` +${room.mentors.length - 1} more`
                          : ""}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 align-middle text-(--mws-muted)">
                    {room.student_count} active
                    {room.expired_count > 0 ? (
                      <p className="mt-0.5 text-xs">
                        <StatusBadge tone="amber" variant="text">
                          {room.expired_count} expired
                        </StatusBadge>
                      </p>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 align-middle">
                    <RowActions
                      onView={() =>
                        navigate(`/academic/pc-activity-rooms/${room.id}`)
                      }
                      onEdit={
                        canManageRoom(room)
                          ? () => setFormDialog({ mode: "edit", room })
                          : undefined
                      }
                      disableDelete={!canManageRoom(room)}
                      onDelete={() => handleDelete(room)}
                    />
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>

      <PaginationBar
        paging={paging}
        itemLabel="rooms"
        isLoading={query.isLoading}
        onPrevious={() => updateParams({ page: params.page - 1 })}
        onNext={() => updateParams({ page: params.page + 1 })}
        onPageSizeChange={(size) => updateParams({ page: 1, size })}
      />

      {formDialog ? (
        <RoomFormDialog
          mode={formDialog.mode}
          room={formDialog.room}
          activities={activities}
          units={units}
          grades={grades}
          years={years}
          classes={classes}
          databaseAdminUnitId={isDatabaseAdmin ? user?.unit_id : null}
          onClose={() => setFormDialog(null)}
        />
      ) : null}
    </PanelFrame>
  );
}

export function RoomFormDialog({
  mode,
  room,
  activities,
  units,
  grades,
  years: suppliedYears,
  classes: suppliedClasses,
  databaseAdminUnitId,
  onClose,
}) {
  const isEdit = mode === "edit";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() => ({
    academic_year_id: room?.academic_year_id || "",
    activity_id: room?.activity_id || "",
    label: room?.label || "",
    day: room?.day || "",
    duration_type: room?.duration_type || "",
    custom_duration_days: room?.custom_duration_days
      ? String(room.custom_duration_days)
      : "",
    unit_ids: room
      ? room.units.map((unit) => unit.id)
      : databaseAdminUnitId
        ? [databaseAdminUnitId]
        : [],
    grade_ids: room ? room.grades.map((grade) => grade.id) : [],
    class_ids: room ? room.classes.map((klass) => klass.id) : [],
  }));
  const [allowAllClasses, setAllowAllClasses] = useState(() =>
    Boolean(room && room.classes.length === 0),
  );
  const [classSearch, setClassSearch] = useState("");
  const [classPage, setClassPage] = useState(1);
  const [classPageSize, setClassPageSize] = useState(10);
  const deferredClassSearch = useDeferredValue(
    classSearch.trim().toLowerCase(),
  );
  const yearsQuery = useQuery({
    queryKey: ["academic-years", "pc-activity-room-form"],
    queryFn: () => academicYearsApi.list({ page: 1, size: 100 }),
    enabled: !suppliedYears,
  });
  const classesQuery = useQuery({
    queryKey: ["classes", "pc-activity-room-form", values.academic_year_id],
    queryFn: () => listAllClasses(values.academic_year_id),
    enabled: Boolean(values.academic_year_id),
    initialData: suppliedClasses,
  });
  const years = suppliedYears || yearsQuery.data?.data || [];
  const classes = classesQuery.data || [];
  const activeYearId = years.find((year) => year.status === "ACTIVE")?.id || "";

  // One-time default once the active year loads late (e.g. years wasn't
  // pre-fetched by the parent) - guarded so it never re-fires after the
  // first successful default, satisfying react-hooks/set-state-in-effect.
  const didDefaultYearRef = useRef(false);
  useEffect(() => {
    if (didDefaultYearRef.current || isEdit || !activeYearId) return;
    didDefaultYearRef.current = true;
    setValues((current) =>
      current.academic_year_id
        ? current
        : { ...current, academic_year_id: activeYearId },
    );
  }, [activeYearId, isEdit]);

  const selectedActivity = activities.find((a) => a.id === values.activity_id);
  const availableUnits = databaseAdminUnitId
    ? units.filter((unit) => unit.id === databaseAdminUnitId)
    : units;
  const availableGrades = grades.filter((grade) =>
    values.unit_ids.includes(grade.unit_id),
  );
  const availableClasses = classes.filter((klass) => {
    if (klass.academic_year.id !== values.academic_year_id) return false;
    const acceptedGradeIds = [
      klass.grade.id,
      ...(klass.additional_grades || []).map((grade) => grade.id),
    ];
    const unitMatches = grades.some(
      (grade) =>
        grade.id === klass.grade.id && values.unit_ids.includes(grade.unit_id),
    );
    const gradeMatches =
      values.grade_ids.length === 0 ||
      acceptedGradeIds.some((id) => values.grade_ids.includes(id));
    return unitMatches && gradeMatches;
  });
  const selectedClassIds = allowAllClasses
    ? availableClasses.map((klass) => klass.id)
    : values.class_ids.filter((id) =>
        availableClasses.some((klass) => klass.id === id),
      );
  const filteredClasses = availableClasses.filter((klass) => {
    if (!deferredClassSearch) return true;
    const gradeNames = [
      klass.grade.name,
      ...(klass.additional_grades || []).map((grade) => grade.name),
    ];
    return `${klass.name} ${gradeNames.join(" ")}`
      .toLowerCase()
      .includes(deferredClassSearch);
  });
  const classItems = filteredClasses.map((klass) => ({
    id: klass.id,
    label: klass.name,
    sublabel: [
      klass.grade.name,
      ...(klass.additional_grades || []).map((grade) => grade.name),
    ].join(", "),
  }));
  const durationOptions =
    values.duration_type === "SIX_MONTHS"
      ? [LEGACY_SIX_MONTHS_OPTION, ...DURATION_OPTIONS]
      : DURATION_OPTIONS;

  function toggleUnit(unitId) {
    setValues((current) => {
      const nextUnitIds = current.unit_ids.includes(unitId)
        ? current.unit_ids.filter((id) => id !== unitId)
        : [...current.unit_ids, unitId];
      return {
        ...current,
        unit_ids: nextUnitIds,
        grade_ids: current.grade_ids.filter((gradeId) =>
          grades.some(
            (grade) =>
              grade.id === gradeId && nextUnitIds.includes(grade.unit_id),
          ),
        ),
        class_ids: [],
      };
    });
    setAllowAllClasses(false);
    setClassPage(1);
  }

  function toggleAllUnits(checked) {
    const unitIds = checked ? availableUnits.map((unit) => unit.id) : [];
    setValues((current) => ({
      ...current,
      unit_ids: unitIds,
      grade_ids: current.grade_ids.filter((gradeId) =>
        grades.some(
          (grade) =>
            grade.id === gradeId && unitIds.includes(grade.unit_id),
        ),
      ),
      class_ids: [],
    }));
    setAllowAllClasses(false);
    setClassPage(1);
  }

  function toggleGrade(gradeId) {
    setValues((current) => {
      const grade_ids = current.grade_ids.includes(gradeId)
        ? current.grade_ids.filter((id) => id !== gradeId)
        : [...current.grade_ids, gradeId];
      return { ...current, grade_ids, class_ids: [] };
    });
    setAllowAllClasses(false);
    setClassPage(1);
  }

  function toggleAllGrades(checked) {
    setValues((current) => ({
      ...current,
      grade_ids: checked ? availableGrades.map((grade) => grade.id) : [],
      class_ids: [],
    }));
    setAllowAllClasses(false);
    setClassPage(1);
  }

  function toggleClass(classId) {
    setValues((current) => {
      const currentIds = allowAllClasses
        ? availableClasses.map((klass) => klass.id)
        : current.class_ids;
      return {
        ...current,
        class_ids: currentIds.includes(classId)
          ? currentIds.filter((id) => id !== classId)
          : [...currentIds, classId],
      };
    });
    setAllowAllClasses(false);
  }

  function toggleAllMatchingClasses(checked) {
    const matchingIds = filteredClasses.map((klass) => klass.id);
    setValues((current) => ({
      ...current,
      class_ids: checked
        ? [...new Set([...selectedClassIds, ...matchingIds])]
        : selectedClassIds.filter((id) => !matchingIds.includes(id)),
    }));
    setAllowAllClasses(false);
  }

  function toggleAllowAllClasses(checked) {
    setAllowAllClasses(checked);
    setValues((current) => ({
      ...current,
      class_ids: checked ? [] : current.class_ids,
    }));
    setClassPage(1);
  }

  function changeAcademicYear(value) {
    setValues((current) => ({
      ...current,
      academic_year_id: value,
      class_ids: [],
    }));
    setAllowAllClasses(false);
    setClassSearch("");
    setClassPage(1);
  }

  const isValid =
    values.activity_id &&
    values.academic_year_id &&
    values.day &&
    values.duration_type &&
    (values.duration_type !== "CUSTOM" ||
      Number(values.custom_duration_days) > 0) &&
    values.unit_ids.length > 0 &&
    values.grade_ids.length > 0 &&
    selectedClassIds.length > 0;

  const saveMutation = useMutation({
    mutationFn: () => {
      if (isEdit) {
        return pcActivityRoomsApi.update(room.id, {
          label: values.label || null,
          duration_type: values.duration_type,
          custom_duration_days:
            values.duration_type === "CUSTOM"
              ? Number(values.custom_duration_days)
              : null,
          unit_ids: values.unit_ids,
          grade_ids: values.grade_ids,
          class_ids: selectedClassIds,
        });
      }
      return pcActivityRoomsApi.create({
        activity_id: values.activity_id,
        academic_year_id: values.academic_year_id,
        label: values.label || undefined,
        day: values.day,
        duration_type: values.duration_type,
        custom_duration_days:
          values.duration_type === "CUSTOM"
            ? Number(values.custom_duration_days)
            : undefined,
        unit_ids: values.unit_ids,
        grade_ids: values.grade_ids,
        class_ids: selectedClassIds,
      });
    },
    onSuccess: (savedRoom) => {
      queryClient.invalidateQueries({ queryKey: ["pc-activity-rooms"] });
      showSuccessToast(isEdit ? "Room updated." : "Room created.");
      onClose();
      if (!isEdit) navigate(`/academic/pc-activity-rooms/${savedRoom.id}`);
    },
  });

  return (
    <CrudDialog
      title={isEdit ? "Edit Room" : "Create Room"}
      onClose={onClose}
      panelClassName="max-w-3xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!isValid}
            loading={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {isEdit ? (
          <div className="rounded-xl border border-(--mws-line) bg-(--mws-soft) px-4 py-3 text-sm text-(--mws-muted)">
            {room.activity_name} - {room.academic_year_name} -{" "}
            {formatStatus(room.day)}. The activity, academic year, and day can't
            be changed after creation; delete and recreate the room if either
            needs to change.
          </div>
        ) : (
          <>
            <Field label="Activity">
              <SearchableSelect
                value={values.activity_id}
                onChange={(value) =>
                  setValues((current) => ({
                    ...current,
                    activity_id: value,
                    unit_ids: [],
                    grade_ids: [],
                    class_ids: [],
                  }))
                }
                options={activities.map((a) => ({
                  value: a.id,
                  label: a.name,
                }))}
                placeholder="Select PC Activity"
                searchPlaceholder="Search activities"
              />
            </Field>
            <Field label="Academic Year">
              <SearchableSelect
                value={values.academic_year_id}
                onChange={changeAcademicYear}
                options={years.map((year) => ({
                  value: year.id,
                  label:
                    year.status === "ACTIVE"
                      ? `${year.name} (Active)`
                      : year.name,
                }))}
                placeholder="Select academic year"
                searchPlaceholder="Search years"
              />
            </Field>
            <Field label="Day">
              <SearchableSelect
                value={values.day}
                onChange={(value) =>
                  setValues((current) => ({ ...current, day: value }))
                }
                options={DAY_OPTIONS}
                placeholder="Select day"
                searchableThreshold={99}
              />
            </Field>
          </>
        )}

        <Field
          label="Room Label"
          hint="Optional. The display name is generated from the activity, for example Coding - B."
        >
          <TextInput
            value={values.label}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                label: event.target.value,
              }))
            }
            placeholder="e.g. B"
          />
        </Field>

        <Field
          label="Duration"
          hint="Sets how long the room remains active."
        >
          <SearchableSelect
            value={values.duration_type}
            onChange={(value) =>
              setValues((current) => ({ ...current, duration_type: value }))
            }
            options={durationOptions}
            placeholder="Select duration"
            searchableThreshold={99}
          />
        </Field>
        {values.duration_type === "CUSTOM" ? (
          <Field
            label="Custom Duration (Days)"
            hint="Must be longer than zero and no longer than one semester in the selected academic year."
          >
            <TextInput
              type="number"
              min="1"
              value={values.custom_duration_days}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  custom_duration_days: event.target.value,
                }))
              }
            />
          </Field>
        ) : null}

        <Field
          label="Units"
          hint={
            selectedActivity
              ? `Choose where ${selectedActivity.name} runs. The master activity no longer restricts units.`
              : "At least one unit is required."
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {!databaseAdminUnitId && availableUnits.length > 1 ? (
              <CheckboxField
                checked={availableUnits.every((unit) =>
                  values.unit_ids.includes(unit.id),
                )}
                label="Allow All Units"
                onChange={(event) => toggleAllUnits(event.target.checked)}
              />
            ) : null}
            {availableUnits.map((unit) => (
              <CheckboxField
                key={unit.id}
                checked={values.unit_ids.includes(unit.id)}
                label={unit.name}
                onChange={() => toggleUnit(unit.id)}
              />
            ))}
          </div>
        </Field>

        <Field
          label="Grades"
          hint="Check Allow All Grades, or pick specific grades within the selected units."
        >
          {values.unit_ids.length === 0 ? (
            <p className="text-sm text-(--mws-muted)">Select a unit first.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <CheckboxField
                checked={
                  availableGrades.length > 0 &&
                  availableGrades.every((grade) =>
                    values.grade_ids.includes(grade.id),
                  )
                }
                label="Allow All Grades"
                onChange={(event) => toggleAllGrades(event.target.checked)}
              />
              {availableGrades.map((grade) => (
                <CheckboxField
                  key={grade.id}
                  checked={values.grade_ids.includes(grade.id)}
                  label={grade.name}
                  onChange={() => toggleGrade(grade.id)}
                />
              ))}
            </div>
          )}
        </Field>

        <Field
          label="Classes"
          hint="Allow all compatible classes, or choose specific classes. At least one class is required."
        >
          {!values.academic_year_id ||
          values.unit_ids.length === 0 ||
          values.grade_ids.length === 0 ? (
            <p className="text-sm text-(--mws-muted)">
              Select an academic year, unit, and grade first.
            </p>
          ) : classesQuery.isLoading ? (
            <p className="text-sm text-(--mws-muted)">
              Loading compatible classes...
            </p>
          ) : availableClasses.length === 0 ? (
            <p className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]">
              No compatible classes found for the selected academic year, unit,
              and grade.
            </p>
          ) : (
            <div className="space-y-3">
              <CheckboxField
                checked={allowAllClasses}
                label={`Allow All Classes (${availableClasses.length})`}
                onChange={(event) =>
                  toggleAllowAllClasses(event.target.checked)
                }
              />
              {!allowAllClasses ? (
                <>
                  <TextInput
                    value={classSearch}
                    onChange={(event) => {
                      setClassSearch(event.target.value);
                      setClassPage(1);
                    }}
                    placeholder="Search class or grade"
                  />
                  <ChecklistPicker
                    items={classItems}
                    selectedIds={selectedClassIds}
                    onToggle={toggleClass}
                    onToggleAll={toggleAllMatchingClasses}
                    emptyMessage="No compatible classes match this search."
                    page={classPage}
                    onPageChange={setClassPage}
                    pageSize={classPageSize}
                    onPageSizeChange={(size) => {
                      setClassPageSize(size);
                      setClassPage(1);
                    }}
                    itemLabel="class"
                    itemLabelPlural="classes"
                  />
                </>
              ) : null}
              <p className="text-xs font-semibold text-(--mws-muted)">
                {selectedClassIds.length} class
                {selectedClassIds.length === 1 ? "" : "es"} selected.
              </p>
            </div>
          )}
        </Field>
      </div>
    </CrudDialog>
  );
}

export function RoomStudentsSection({ room, canManage }) {
  const [addOpen, setAddOpen] = useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkPromoteOpen, setBulkPromoteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const studentsQuery = useQuery({
    queryKey: ["pc-activity-room-students", room.id],
    queryFn: () => pcActivityRoomsApi.listStudents(room.id),
  });
  const students = studentsQuery.data || [];
  const selected = students.filter((row) => selectedIds.has(row.id));
  const allSelected =
    students.length > 0 && selected.length === students.length;
  const canReopenSelection =
    selected.length > 0 && selected.every((row) => row.status === "ENDED");

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: ["pc-activity-room-students", room.id],
    });
    queryClient.invalidateQueries({
      queryKey: ["pc-activity-room-eligible-students", room.id],
    });
    queryClient.invalidateQueries({ queryKey: ["pc-activity-rooms"] });
  }

  function toggleAll(checked) {
    setSelectedIds(
      checked ? new Set(students.map((row) => row.id)) : new Set(),
    );
  }
  function toggleOne(id, checked) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const bulkEndMutation = useMutation({
    mutationFn: (assignmentIds) =>
      pcActivityRoomsApi.bulkEndStudentAssignments(room.id, {
        assignment_ids: assignmentIds,
      }),
    onSuccess: (result) => {
      invalidate();
      setSelectedIds(new Set());
      if (result.success_count > 0)
        showSuccessToast(
          `${result.success_count} student assignment(s) ended.`,
        );
      if (result.failed_count > 0)
        showBulkFailureToast("assignment(s) failed to end", result);
    },
    onError: (error) => showErrorToast(error, "Could not end assignments."),
  });
  const bulkDropMutation = useMutation({
    mutationFn: (assignmentIds) =>
      pcActivityRoomsApi.bulkDropStudentAssignments(room.id, {
        assignment_ids: assignmentIds,
      }),
    onSuccess: (result) => {
      invalidate();
      setSelectedIds(new Set());
      if (result.success_count > 0)
        showSuccessToast(
          `${result.success_count} student assignment(s) dropped.`,
        );
      if (result.failed_count > 0)
        showBulkFailureToast("assignment(s) failed to drop", result);
    },
    onError: (error) => showErrorToast(error, "Could not drop assignments."),
  });
  const bulkReopenMutation = useMutation({
    mutationFn: (assignmentIds) =>
      pcActivityRoomsApi.bulkReopenStudentAssignments(room.id, {
        assignment_ids: assignmentIds,
      }),
    onSuccess: (result) => {
      invalidate();
      setSelectedIds(new Set());
      if (result.success_count > 0)
        showSuccessToast(
          `${result.success_count} student assignment(s) reopened.`,
        );
      if (result.failed_count > 0)
        showBulkFailureToast("assignment(s) failed to reopen", result);
    },
    onError: (error) => showErrorToast(error, "Could not reopen assignments."),
  });
  const bulkMoveMutation = useMutation({
    mutationFn: ({ assignmentIds, targetRoomId }) =>
      pcActivityRoomsApi.bulkMoveStudentAssignments(room.id, {
        assignment_ids: assignmentIds,
        target_room_id: targetRoomId,
      }),
    onSuccess: (result) => {
      invalidate();
      setSelectedIds(new Set());
      setBulkMoveOpen(false);
      setBulkPromoteOpen(false);
      if (result.success_count > 0)
        showSuccessToast(
          `${result.success_count} student assignment(s) moved.`,
        );
      if (result.failed_count > 0)
        showBulkFailureToast("assignment(s) failed to move", result);
    },
    onError: (error) => showErrorToast(error, "Could not move assignments."),
  });

  async function handleBulkEnd() {
    const confirmed = await confirm({
      title: "End student assignments",
      description: `End ${selected.length} student assignment(s)? The history remains and each same-day slot becomes available.`,
      confirmLabel: "End Assignments",
    });
    if (confirmed) bulkEndMutation.mutate(Array.from(selectedIds));
  }

  async function handleBulkDrop() {
    const confirmed = await confirm({
      title: "Drop student assignments",
      description: `Drop ${selected.length} student assignment(s) as a mistake? This soft-deletes the history rows.`,
      confirmLabel: "Drop",
      tone: "danger",
    });
    if (confirmed) bulkDropMutation.mutate(Array.from(selectedIds));
  }

  async function handleBulkReopen() {
    if (!canReopenSelection) return;
    const confirmed = await confirm({
      title: "Reopen student assignments",
      description: `Reopen ${selected.length} student assignment(s)?`,
      confirmLabel: "Reopen",
    });
    if (confirmed) bulkReopenMutation.mutate(Array.from(selectedIds));
  }

  const bulkPending =
    bulkEndMutation.isPending ||
    bulkDropMutation.isPending ||
    bulkReopenMutation.isPending ||
    bulkMoveMutation.isPending;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-(--mws-muted)">
          {room.student_count} active, {room.scheduled_count || 0} scheduled,{" "}
          {room.expired_count} expired
        </p>
        {canManage ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setAddOpen(true)}
          >
            <UserRoundPlus size={15} />
            Add Students
          </Button>
        ) : null}
      </div>

      {canManage ? (
        <BulkActionBar
          selectedCount={selected.length}
          onClear={() => setSelectedIds(new Set())}
        >
          <ActionsMenu label="Bulk Actions" disabled={bulkPending}>
            {(closeMenu) => (
              <>
                <ActionsMenuItem
                  onClick={() => {
                    closeMenu();
                    setBulkMoveOpen(true);
                  }}
                >
                  <span className="flex items-center gap-2">
                    <MoveRight size={15} />
                    Move selected
                  </span>
                </ActionsMenuItem>
                <ActionsMenuItem
                  onClick={() => {
                    closeMenu();
                    setBulkPromoteOpen(true);
                  }}
                >
                  <span className="flex items-center gap-2">
                    <MoveRight size={15} />
                    Promote to Next Year
                  </span>
                </ActionsMenuItem>
                <ActionsMenuItem
                  onClick={() => {
                    closeMenu();
                    handleBulkEnd();
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
                    handleBulkDrop();
                  }}
                >
                  <span className="flex items-center gap-2">
                    <Trash2 size={15} />
                    Drop selected
                  </span>
                </ActionsMenuItem>
              </>
            )}
          </ActionsMenu>
        </BulkActionBar>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-(--mws-line)">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-(--mws-soft) text-xs font-bold text-(--mws-muted)">
            <tr>
              {canManage ? (
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select All Students"
                    checked={allSelected}
                    onChange={(event) => toggleAll(event.target.checked)}
                    className="h-4 w-4 accent-(--mws-burgundy)"
                  />
                </th>
              ) : null}
              <th className="px-3 py-2">Student</th>
              <th className="px-3 py-2">Class</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Since</th>
              <th className="px-3 py-2">Expires</th>
            </tr>
          </thead>
          <tbody>
            {studentsQuery.isLoading ? (
              <tr>
                <td
                  className="px-3 py-6 text-center text-(--mws-muted)"
                  colSpan={6}
                >
                  Loading students...
                </td>
              </tr>
            ) : students.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-6 text-center text-(--mws-muted)"
                  colSpan={6}
                >
                  No students assigned yet.
                </td>
              </tr>
            ) : (
              students.map((row) => (
                <tr key={row.id} className="border-t border-(--mws-line)">
                  {canManage ? (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.student_name}`}
                        checked={selectedIds.has(row.id)}
                        onChange={(event) =>
                          toggleOne(row.id, event.target.checked)
                        }
                        className="h-4 w-4 accent-(--mws-burgundy)"
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    <Link
                      to={`/students/${row.student_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-(--mws-charcoal) hover:text-(--mws-burgundy) hover:underline"
                    >
                      {row.student_name}
                    </Link>
                    {row.nis ? (
                      <p className="mt-0.5 text-xs text-(--mws-muted)">
                        NIS {row.nis}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-(--mws-muted)">
                    {row.class_name || "-"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {row.deleted_at ? (
                        <StatusBadge tone="red">Removed</StatusBadge>
                      ) : row.status === "SCHEDULED" ? (
                        <StatusBadge tone="blue">Scheduled</StatusBadge>
                      ) : row.status === "EXPIRED" ? (
                        <StatusBadge tone="amber">Expired</StatusBadge>
                      ) : row.status === "ENDED" ? (
                        <StatusBadge tone="neutral">Ended</StatusBadge>
                      ) : (
                        <StatusBadge tone="green">Active</StatusBadge>
                      )}
                      {!row.still_eligible && !row.deleted_at ? (
                        <StatusBadge
                          tone="neutral"
                          title="This student is no longer in one of this room's grades/units."
                        >
                          Out of scope
                        </StatusBadge>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-(--mws-muted)">
                    {formatDate(row.start_date)}
                  </td>
                  <td className="px-3 py-2 text-(--mws-muted)">
                    {row.expires_at ? formatDate(row.expires_at) : "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {addOpen ? (
        <AddStudentsDialog
          room={room}
          existingCount={
            students.filter(
              (row) => row.status === "ACTIVE" || row.status === "SCHEDULED",
            ).length
          }
          onClose={() => setAddOpen(false)}
          onAdded={invalidate}
        />
      ) : null}
      {bulkMoveOpen ? (
        <BulkMoveRoomAssignmentsDialog
          room={room}
          count={selected.length}
          kind="student"
          mode="move"
          isSubmitting={bulkMoveMutation.isPending}
          onClose={() => setBulkMoveOpen(false)}
          onSubmit={(targetRoomId) =>
            bulkMoveMutation.mutate({
              assignmentIds: Array.from(selectedIds),
              targetRoomId,
            })
          }
        />
      ) : null}
      {bulkPromoteOpen ? (
        <BulkMoveRoomAssignmentsDialog
          room={room}
          count={selected.length}
          kind="student"
          mode="promote"
          isSubmitting={bulkMoveMutation.isPending}
          onClose={() => setBulkPromoteOpen(false)}
          onSubmit={(targetRoomId) =>
            bulkMoveMutation.mutate({
              assignmentIds: Array.from(selectedIds),
              targetRoomId,
            })
          }
        />
      ) : null}
    </div>
  );
}

function AddStudentsDialog({ room, existingCount = 0, onClose, onAdded }) {
  const confirm = useConfirm();
  const remainingSlots = Math.max(MAX_ROOM_STUDENTS - existingCount, 0);
  const atCap = remainingSlots === 0;
  const [search, setSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState([]);
  const eligibleQuery = useQuery({
    queryKey: ["pc-activity-room-eligible-students", room.id],
    queryFn: () => pcActivityRoomsApi.listEligibleStudents(room.id),
  });

  const selectable = useMemo(() => {
    const students = eligibleQuery.data || [];
    // Already-assigned-here and same-day-elsewhere students can't be added
    // from this dialog - leave them out entirely instead of listing them
    // disabled, so the list only shows who can actually be picked.
    return students.filter((student) => {
      const inThisRoom =
        student.other_activity == null && student.already_assigned;
      const sameDayElsewhere = student.other_activity?.same_day;
      return !inThisRoom && !sameDayElsewhere;
    });
  }, [eligibleQuery.data]);

  const gradeOptions = useMemo(
    () =>
      Array.from(
        new Set(selectable.map((s) => s.grade_name).filter(Boolean)),
      ).sort(),
    [selectable],
  );

  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return selectable.filter((student) => {
      if (gradeFilter && student.grade_name !== gradeFilter) return false;
      if (!normalized) return true;
      return (
        student.full_name.toLowerCase().includes(normalized) ||
        (student.nis || "").toLowerCase().includes(normalized)
      );
    });
  }, [selectable, search, gradeFilter]);

  const items = useMemo(
    () =>
      filtered.map((student) => ({
        id: student.student_id,
        label: student.full_name,
        sublabel: [student.nis, student.grade_name, student.class_name]
          .filter(Boolean)
          .join(" / "),
        extra: student.other_activity
          ? `Also in ${student.other_activity.activity_name} on ${formatStatus(student.other_activity.day)}`
          : null,
        href: `/students/${student.student_id}`,
      })),
    [filtered],
  );

  const selectedStudents = selectable.filter((student) =>
    selectedIds.includes(student.student_id),
  );

  function handleSearchChange(value) {
    setSearch(value);
    setPage(1);
  }

  const assignMutation = useMutation({
    mutationFn: () =>
      pcActivityRoomsApi.bulkAssignStudents(room.id, {
        student_ids: selectedIds,
      }),
    onSuccess: () => {
      onAdded();
      showSuccessToast(`${selectedIds.length} student(s) assigned.`);
      onClose();
    },
  });

  function toggle(studentId) {
    setSelectedIds((current) => {
      if (current.includes(studentId))
        return current.filter((id) => id !== studentId);
      if (current.length >= remainingSlots) {
        showErrorToast(
          `This room can hold at most ${MAX_ROOM_STUDENTS} students.`,
        );
        return current;
      }
      return [...current, studentId];
    });
  }

  function toggleAll(checked) {
    setSelectedIds((current) => {
      const filteredIds = new Set(items.map((item) => item.id));
      if (!checked) return current.filter((id) => !filteredIds.has(id));
      const merged = Array.from(new Set([...current, ...filteredIds]));
      if (merged.length > remainingSlots) {
        showErrorToast(
          `Only the first ${remainingSlots} were selected - this room can hold at most ${MAX_ROOM_STUDENTS} students.`,
        );
        return merged.slice(0, remainingSlots);
      }
      return merged;
    });
  }

  async function handleSubmit() {
    const confirmed = await confirm({
      title: `Add ${selectedStudents.length} student${selectedStudents.length === 1 ? "" : "s"} to ${room.display_name}?`,
      wide: true,
      description: (
        <div className="max-h-64 overflow-y-auto rounded-lg border border-(--mws-line)">
          <table className="w-full text-left text-xs">
            <thead className="bg-(--mws-soft) font-semibold text-(--mws-muted)">
              <tr>
                <th className="px-3 py-2">Student</th>
                <th className="px-3 py-2">NIS</th>
                <th className="px-3 py-2">Grade</th>
              </tr>
            </thead>
            <tbody>
              {selectedStudents.map((student) => (
                <tr
                  key={student.student_id}
                  className="border-t border-(--mws-line)"
                >
                  <td className="px-3 py-2">{student.full_name}</td>
                  <td className="px-3 py-2">{student.nis || "-"}</td>
                  <td className="px-3 py-2">{student.grade_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
      confirmLabel: "Add",
    });
    if (confirmed) assignMutation.mutate();
  }

  return (
    <CrudDialog
      title="Add Students"
      description="Only active students with a regular class are shown. Reassign booked students directly from their current rooms."
      onClose={onClose}
      panelClassName="max-w-xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              selectedIds.length === 0 || atCap
            }
            loading={assignMutation.isPending}
            onClick={handleSubmit}
          >
            Assign
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {atCap ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]">
            This room already has the maximum of {MAX_ROOM_STUDENTS} students.
            End or remove one first.
          </div>
        ) : (
          <p className="text-sm text-(--mws-muted)">
            Showing this room's eligible students only. Check the ones to add,
            then save once.
            {remainingSlots < MAX_ROOM_STUDENTS
              ? ` ${remainingSlots} slot${remainingSlots === 1 ? "" : "s"} left.`
              : ""}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <TextInput
              value={search}
              onChange={(event) => handleSearchChange(event.target.value)}
              disabled={eligibleQuery.isLoading}
              placeholder={
                eligibleQuery.isLoading
                  ? "Loading students..."
                  : "Search Name or NIS"
              }
            />
          </div>
          {gradeOptions.length > 1 ? (
            <SelectFilter
              value={gradeFilter}
              onChange={(value) => {
                setGradeFilter(value);
                setPage(1);
              }}
              options={[
                { value: "", label: "All Grades" },
                ...gradeOptions.map((name) => ({ value: name, label: name })),
              ]}
              placeholder="All Grades"
            />
          ) : null}
        </div>

        <ChecklistPicker
          items={items}
          selectedIds={selectedIds}
          onToggle={toggle}
          onToggleAll={toggleAll}
          isLoading={eligibleQuery.isLoading}
          loadingMessage="Loading students..."
          emptyMessage="No eligible students match."
          page={page}
          onPageChange={setPage}
          pageSize={pageSize}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          itemLabel="student"
        />
        <p className="text-xs font-semibold text-(--mws-muted)">
          {selectedIds.length} student{selectedIds.length === 1 ? "" : "s"}{" "}
          selected.
        </p>
      </div>
    </CrudDialog>
  );
}

export function RoomMentorsSection({ room, units, canManage }) {
  const [addOpen, setAddOpen] = useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkPromoteOpen, setBulkPromoteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const mentorsQuery = useQuery({
    queryKey: ["pc-activity-room-mentors", room.id],
    queryFn: () => pcActivityRoomsApi.listMentors(room.id),
  });
  const assignments = mentorsQuery.data || [];
  const selected = assignments.filter((row) => selectedIds.has(row.id));
  const allSelected =
    assignments.length > 0 && selected.length === assignments.length;
  const canMoveSelection =
    selected.length > 0 && selected.every((row) => row.status === "ACTIVE");
  const canReopenSelection =
    selected.length > 0 && selected.every((row) => row.status === "ENDED");

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: ["pc-activity-room-mentors", room.id],
    });
    queryClient.invalidateQueries({ queryKey: ["pc-activity-rooms"] });
  }

  function toggleAll(checked) {
    setSelectedIds(
      checked ? new Set(assignments.map((row) => row.id)) : new Set(),
    );
  }
  function toggleOne(id, checked) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const bulkEndMutation = useMutation({
    mutationFn: (assignmentIds) =>
      pcActivityRoomsApi.bulkEndMentorAssignments(room.id, {
        assignment_ids: assignmentIds,
      }),
    onSuccess: (result) => {
      invalidate();
      setSelectedIds(new Set());
      if (result.success_count > 0)
        showSuccessToast(`${result.success_count} mentor assignment(s) ended.`);
      if (result.failed_count > 0)
        showBulkFailureToast("assignment(s) failed to end", result);
    },
    onError: (error) => showErrorToast(error, "Could not end assignments."),
  });
  const bulkRemoveMutation = useMutation({
    mutationFn: (assignmentIds) =>
      pcActivityRoomsApi.bulkRemoveMentorAssignments(room.id, {
        assignment_ids: assignmentIds,
      }),
    onSuccess: (result) => {
      invalidate();
      setSelectedIds(new Set());
      if (result.success_count > 0)
        showSuccessToast(
          `${result.success_count} mentor assignment(s) removed.`,
        );
      if (result.failed_count > 0)
        showBulkFailureToast("assignment(s) failed to remove", result);
    },
    onError: (error) => showErrorToast(error, "Could not remove assignments."),
  });
  const bulkReopenMutation = useMutation({
    mutationFn: (assignmentIds) =>
      pcActivityRoomsApi.bulkReopenMentorAssignments(room.id, {
        assignment_ids: assignmentIds,
      }),
    onSuccess: (result) => {
      invalidate();
      setSelectedIds(new Set());
      if (result.success_count > 0)
        showSuccessToast(
          `${result.success_count} mentor assignment(s) reopened.`,
        );
      if (result.failed_count > 0)
        showBulkFailureToast("assignment(s) failed to reopen", result);
    },
    onError: (error) => showErrorToast(error, "Could not reopen assignments."),
  });
  const bulkMoveMutation = useMutation({
    mutationFn: ({ assignmentIds, targetRoomId }) =>
      pcActivityRoomsApi.bulkMoveMentorAssignments(room.id, {
        assignment_ids: assignmentIds,
        target_room_id: targetRoomId,
      }),
    onSuccess: (result) => {
      invalidate();
      setSelectedIds(new Set());
      setBulkMoveOpen(false);
      setBulkPromoteOpen(false);
      if (result.success_count > 0)
        showSuccessToast(`${result.success_count} mentor assignment(s) moved.`);
      if (result.failed_count > 0)
        showBulkFailureToast("assignment(s) failed to move", result);
    },
    onError: (error) => showErrorToast(error, "Could not move assignments."),
  });

  async function handleBulkEnd() {
    const confirmed = await confirm({
      title: "End mentor assignments",
      description: `End ${selected.length} mentor assignment(s)?`,
      confirmLabel: "End Assignments",
    });
    if (confirmed) bulkEndMutation.mutate(Array.from(selectedIds));
  }

  async function handleBulkRemove() {
    const confirmed = await confirm({
      title: "Remove mentor assignments",
      description: `Remove ${selected.length} mentor assignment(s)? Use this only to correct a mistake, not to close a finished mentorship. "End selected" does that instead.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (confirmed) bulkRemoveMutation.mutate(Array.from(selectedIds));
  }

  async function handleBulkReopen() {
    if (!canReopenSelection) return;
    const confirmed = await confirm({
      title: "Reopen mentor assignments",
      description: `Reopen ${selected.length} mentor assignment(s)?`,
      confirmLabel: "Reopen",
    });
    if (confirmed) bulkReopenMutation.mutate(Array.from(selectedIds));
  }

  const bulkPending =
    bulkEndMutation.isPending ||
    bulkRemoveMutation.isPending ||
    bulkReopenMutation.isPending ||
    bulkMoveMutation.isPending;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-(--mws-muted)">
          {assignments.length} mentor assignment(s)
        </p>
        {canManage ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setAddOpen(true)}
          >
            <Users size={15} />
            Add Mentor
          </Button>
        ) : null}
      </div>

      {canManage ? (
        <BulkActionBar
          selectedCount={selected.length}
          onClear={() => setSelectedIds(new Set())}
        >
          <ActionsMenu label="Bulk Actions" disabled={bulkPending}>
            {(closeMenu) => (
              <>
                <ActionsMenuItem
                  disabled={!canMoveSelection}
                  title={
                    canMoveSelection
                      ? undefined
                      : "Select only active assignments to move"
                  }
                  onClick={() => {
                    closeMenu();
                    setBulkMoveOpen(true);
                  }}
                >
                  <span className="flex items-center gap-2">
                    <MoveRight size={15} />
                    Move selected
                  </span>
                </ActionsMenuItem>
                <ActionsMenuItem
                  disabled={!canMoveSelection}
                  title={
                    canMoveSelection
                      ? undefined
                      : "Select only active assignments to promote"
                  }
                  onClick={() => {
                    closeMenu();
                    setBulkPromoteOpen(true);
                  }}
                >
                  <span className="flex items-center gap-2">
                    <MoveRight size={15} />
                    Promote to Next Year
                  </span>
                </ActionsMenuItem>
                <ActionsMenuItem
                  onClick={() => {
                    closeMenu();
                    handleBulkEnd();
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

      <div className="overflow-x-auto rounded-xl border border-(--mws-line)">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="bg-(--mws-soft) text-xs font-bold text-(--mws-muted)">
            <tr>
              {canManage ? (
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select All Mentors"
                    checked={allSelected}
                    onChange={(event) => toggleAll(event.target.checked)}
                    className="h-4 w-4 accent-(--mws-burgundy)"
                  />
                </th>
              ) : null}
              <th className="px-3 py-2">Mentor</th>
              <th className="px-3 py-2">Duration</th>
            </tr>
          </thead>
          <tbody>
            {mentorsQuery.isLoading ? (
              <tr>
                <td
                  className="px-3 py-6 text-center text-(--mws-muted)"
                  colSpan={3}
                >
                  Loading mentors...
                </td>
              </tr>
            ) : assignments.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-6 text-center text-(--mws-muted)"
                  colSpan={3}
                >
                  No mentors assigned yet.
                </td>
              </tr>
            ) : (
              assignments.map((assignment) => (
                <tr
                  key={assignment.id}
                  className="border-t border-(--mws-line)"
                >
                  {canManage ? (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${assignment.mentor_name}`}
                        checked={selectedIds.has(assignment.id)}
                        onChange={(event) =>
                          toggleOne(assignment.id, event.target.checked)
                        }
                        className="h-4 w-4 accent-(--mws-burgundy)"
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    <Link
                      to={
                        assignment.mentor_type === "INTERN"
                          ? `/interns/${assignment.mentor_id}`
                          : `/employees/${assignment.mentor_id}`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-(--mws-charcoal) hover:text-(--mws-burgundy) hover:underline"
                    >
                      {assignment.mentor_name}
                    </Link>
                    <p className="mt-0.5 text-xs text-(--mws-muted)">
                      {assignment.mentor_type === "INTERN"
                        ? "Intern"
                        : "Employee"}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-(--mws-muted)">
                    {assignment.status === "ENDED" ? (
                      <>
                        {formatDate(assignment.start_date)} -{" "}
                        {formatDate(assignment.end_date)}
                        <p className="mt-0.5">
                          <StatusBadge tone="neutral" variant="text">
                            Ended
                          </StatusBadge>
                        </p>
                      </>
                    ) : assignment.status === "SCHEDULED" ? (
                      <>
                        Starts {formatDate(assignment.start_date)}
                        <p className="mt-0.5">
                          <StatusBadge tone="blue" variant="text">
                            Scheduled
                          </StatusBadge>
                        </p>
                      </>
                    ) : (
                      <>
                        Since {formatDate(assignment.start_date)}
                        <p className="mt-0.5">
                          <StatusBadge tone="green" variant="text">
                            Active
                          </StatusBadge>
                        </p>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {addOpen ? (
        <AddMentorDialog
          room={room}
          units={units}
          existingMentorIds={
            new Set(
              assignments
                .filter((a) => a.status !== "ENDED")
                .map((a) => a.mentor_id),
            )
          }
          onClose={() => setAddOpen(false)}
          onAdded={invalidate}
        />
      ) : null}
      {bulkMoveOpen ? (
        <BulkMoveRoomAssignmentsDialog
          room={room}
          count={selected.length}
          kind="mentor"
          mode="move"
          isSubmitting={bulkMoveMutation.isPending}
          onClose={() => setBulkMoveOpen(false)}
          onSubmit={(targetRoomId) =>
            bulkMoveMutation.mutate({
              assignmentIds: Array.from(selectedIds),
              targetRoomId,
            })
          }
        />
      ) : null}
      {bulkPromoteOpen ? (
        <BulkMoveRoomAssignmentsDialog
          room={room}
          count={selected.length}
          kind="mentor"
          mode="promote"
          isSubmitting={bulkMoveMutation.isPending}
          onClose={() => setBulkPromoteOpen(false)}
          onSubmit={(targetRoomId) =>
            bulkMoveMutation.mutate({
              assignmentIds: Array.from(selectedIds),
              targetRoomId,
            })
          }
        />
      ) : null}
    </div>
  );
}

// Move (mode="move") targets other rooms in the same academic year, applied
// immediately. Promote (mode="promote") targets rooms in the immediately
// next academic year - the current assignment stays active/scheduled until
// the target room's own period starts. Kept as two separate actions so it's
// never ambiguous which one a click will do.
function BulkMoveRoomAssignmentsDialog({
  room,
  count,
  kind,
  mode,
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const [targetRoomId, setTargetRoomId] = useState("");
  const [now] = useState(() => new Date());
  const isPromote = mode === "promote";
  const yearsQuery = useQuery({
    queryKey: ["academic-years", "pc-activity-room-move"],
    queryFn: () => academicYearsApi.list({
      page: 1,
      size: 100,
      sort_by: "start_date",
      sort_order: "asc",
    }),
  });
  const academicYears = yearsQuery.data?.data || [];
  const currentAcademicYear = academicYears.find(
    (year) => year.id === room.academic_year_id,
  );
  const nextYearId = academicYears
    .filter(
      (year) =>
        new Date(year.start_date).getTime() >
        new Date(currentAcademicYear?.start_date || room.start_date).getTime(),
    )
    .sort(
      (left, right) =>
        new Date(left.start_date).getTime() - new Date(right.start_date).getTime(),
    )[0]?.id;
  const targetAcademicYearId = isPromote
    ? nextYearId
    : room.academic_year_id;
  const roomsQuery = useQuery({
    queryKey: ["pc-activity-rooms", "move-targets", room.id, targetAcademicYearId],
    queryFn: async () => {
      const response = await pcActivityRoomsApi.list({
        page: 1,
        size: 100,
        academic_year_id: targetAcademicYearId,
      });
      return response.data || [];
    },
    enabled: Boolean(targetAcademicYearId),
  });
  const allRooms = roomsQuery.data || [];
  const daysUntilEnd = currentAcademicYear?.end_date
    ? (new Date(currentAcademicYear.end_date).getTime() - now.getTime()) /
      (1000 * 60 * 60 * 24)
    : null;
  const promoteWindowBlocked =
    isPromote &&
    daysUntilEnd !== null &&
    daysUntilEnd > PROMOTE_WINDOW_DAYS;
  const targetRooms = allRooms.filter((candidate) => {
    if (candidate.id === room.id) return false;
    return candidate.academic_year_id === targetAcademicYearId;
  });

  function handleSubmit() {
    if (!targetRoomId || promoteWindowBlocked) return;
    onSubmit(targetRoomId);
  }

  const title = isPromote
    ? kind === "student"
      ? "Promote Students to Next Year"
      : "Promote Mentors to Next Year"
    : kind === "student"
      ? "Move Students"
      : "Move Mentors";
  const description = isPromote
    ? `${count} scheduled assignment(s) will be created in the next academic year. Current assignments remain active until the target room starts.`
    : `${count} assignment(s) will be moved to the selected room in this same academic year, effective immediately.`;

  return (
    <CrudDialog
      title={title}
      description={description}
      onClose={onClose}
      panelClassName="max-w-lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!targetRoomId || promoteWindowBlocked}
            loading={isSubmitting}
            onClick={handleSubmit}
          >
            {isPromote ? "Promote" : "Move"}
          </Button>
        </>
      }
    >
      {promoteWindowBlocked ? (
        <div className="mb-3 rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]">
          Too early to promote. {currentAcademicYear.name} doesn't end until{" "}
          {formatDate(currentAcademicYear.end_date)}. Opens in{" "}
          {Math.max(1, Math.ceil(daysUntilEnd - PROMOTE_WINDOW_DAYS))} day
          {Math.max(1, Math.ceil(daysUntilEnd - PROMOTE_WINDOW_DAYS)) === 1
            ? ""
            : "s"}.
        </div>
      ) : null}
      <Field
        label="Target Room"
        hint={
          isPromote
            ? "Only showing rooms in the next academic year."
            : "Only showing other rooms in this same academic year."
        }
      >
        <SearchableSelect
          value={targetRoomId}
          onChange={setTargetRoomId}
          options={targetRooms.map((candidate) => ({
            value: candidate.id,
            label: `${candidate.display_name} / ${candidate.academic_year_name} / ${formatStatus(candidate.day)}`,
          }))}
          placeholder="Select target room"
          searchPlaceholder="Search rooms"
          emptyLabel={
            isPromote
              ? "No next academic year rooms found."
              : "No other rooms found in this academic year."
          }
        />
      </Field>
    </CrudDialog>
  );
}

function AddMentorDialog({ room, existingMentorIds, onClose, onAdded }) {
  const confirm = useConfirm();
  const [targetValue, setTargetValue] = useState("");
  const mentorOptionsQuery = useMentorOptions(true);
  const roomUnitIds = room.units.map((unit) => unit.id);
  const eligibleForUnits =
    mentorOptionsQuery.data?.eligibleForUnits || (() => []);
  const candidates = eligibleForUnits(roomUnitIds).filter(
    (member) => !existingMentorIds.has(member.id),
  );
  const atCap = existingMentorIds.size >= MAX_ROOM_MENTORS;
  const selected = candidates.find(
    (member) =>
      workforceTargetValue(member.workforce_type || "EMPLOYEE", member.id) ===
      targetValue,
  );

  const assignMutation = useMutation({
    mutationFn: () => {
      const [type, id] = targetValue.split(":");
      return pcActivityRoomsApi.bulkAssignMentors(room.id, {
        targets: [type === "INTERN" ? { intern_id: id } : { employee_id: id }],
      });
    },
    onSuccess: (result) => {
      onAdded();
      if (result.success_count > 0) showSuccessToast("Mentor assigned.");
      if (result.failed_count > 0)
        showBulkFailureToast("mentor(s) failed to assign", result);
      onClose();
    },
    onError: (error) => showErrorToast(error, "Could not assign mentor."),
  });

  async function handleSubmit(event) {
    event.preventDefault();
    if (!selected) return;
    const confirmed = await confirm({
      title: "Confirm mentor assignment",
      description: `${selected.identity.full_name} (${selected.workforce_type === "INTERN" ? "Intern" : "Employee"}) will be assigned as a mentor for this room.`,
      confirmLabel: "Add mentor",
    });
    if (confirmed) assignMutation.mutate();
  }

  return (
    <CrudDialog
      title="Add Mentor"
      description="Only staff eligible for PC Activity mentoring in this room's unit(s) are shown."
      onClose={onClose}
      panelClassName="max-w-lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="add-mentor-form"
            type="submit"
            disabled={!targetValue || atCap}
            loading={assignMutation.isPending}
          >
            <Plus size={16} />
            Add assignment
          </Button>
        </>
      }
    >
      {atCap ? (
        <div className="mb-3 rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]">
          This room already has the maximum of {MAX_ROOM_MENTORS} mentors. End
          or remove one first.
        </div>
      ) : null}
      <form id="add-mentor-form" onSubmit={handleSubmit} noValidate>
        <Field label="Mentor">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <SearchableSelect
                value={targetValue}
                onChange={setTargetValue}
                disabled={atCap}
                options={candidates.map((member) => {
                  const value = workforceTargetValue(
                    member.workforce_type || "EMPLOYEE",
                    member.id,
                  );
                  return {
                    value,
                    label: `${member.identity.full_name}${member.workforce_type === "INTERN" ? " (Intern)" : ""}`,
                    description: member.employment.job_position,
                  };
                })}
                placeholder={
                  mentorOptionsQuery.isLoading
                    ? "Loading staff..."
                    : candidates.length === 0
                      ? "No eligible staff found for this room's units"
                      : "Select Employee or Intern"
                }
                searchPlaceholder="Search staff"
              />
            </div>
            {selected ? (
              <Link
                to={
                  selected.workforce_type === "INTERN"
                    ? `/interns/${selected.id}`
                    : `/employees/${selected.id}`
                }
                target="_blank"
                rel="noreferrer"
                title="Open detail in a new tab"
                className="shrink-0 rounded-lg border border-(--mws-line) p-2 text-(--mws-muted) hover:border-(--mws-burgundy) hover:text-(--mws-burgundy)"
              >
                <Eye size={16} />
              </Link>
            ) : null}
          </div>
        </Field>
      </form>
    </CrudDialog>
  );
}
