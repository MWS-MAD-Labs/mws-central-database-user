import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CalendarDays,
  Edit,
  Eye,
  GraduationCap,
  Layers3,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { BulkActionBar } from "../../../components/ui/BulkActionBar.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  CheckboxField,
  DebouncedSearchInput,
  Field,
  FilterSelect,
  SearchableSelect,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { SortableHeader } from "../../../components/ui/SortableHeader.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { employeesApi } from "../../employees/api/employeesApi.js";
import { jobLevelsApi, unitsApi } from "../../master-data/api/masterDataApi.js";
import { studentSensitiveApi } from "../../students/api/studentSensitiveApi.js";
import {
  academicYearStatuses,
  academicYearsApi,
  classesApi,
  classStatuses,
  enrollmentStatuses,
  enrollmentsApi,
  gradesApi,
} from "../api/academicApi.js";
import {
  cleanPayload,
  dateInputFromIso,
  isoFromDateInput,
  optionalNumber,
  trimmedOrUndefined,
} from "../../../lib/form.js";
import { formatDate, formatStatus, statusTone } from "../../../lib/format.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { ClassDialog } from "../components/ClassDialog.jsx";
import { EnrollmentDialog } from "../components/EnrollmentDialog.jsx";

const tabs = ["years", "grades", "classes", "enrollments"];

export function AcademicPage() {
  const [searchParams] = useSearchParams();
  const activeTab = tabs.includes(searchParams.get("tab"))
    ? searchParams.get("tab")
    : "years";

  return (
    <div className="min-w-0">
      <PageHeader
        title="Academic"
        description="Manage school years, grade levels, classes, homerooms, and student class history."
      />

      {activeTab === "years" ? <AcademicYearsPanel /> : null}
      {activeTab === "grades" ? <GradesPanel /> : null}
      {activeTab === "classes" ? <ClassesPanel /> : null}
      {activeTab === "enrollments" ? <EnrollmentsPanel /> : null}
    </div>
  );
}

function AcademicYearsPanel() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    search: "",
    status: "",
    sort_by: "start_date",
    sort_order: "desc",
  });
  const [dialog, setDialog] = useState(null);

  const yearsQuery = useQuery({
    queryKey: ["academic-years", params],
    queryFn: () => academicYearsApi.list(params),
  });

  // Separate from the paginated table query above - this just needs every
  // year's name to compute the "next year" suggestion, regardless of what
  // page/sort the table is currently showing.
  const allYearsQuery = useQuery({
    queryKey: ["academic-years", "all-names"],
    queryFn: () => academicYearsApi.list({ page: 1, size: 100 }),
  });
  const suggestedStartYear = useMemo(
    () => nextAcademicYearStartYear(allYearsQuery.data?.data || []),
    [allYearsQuery.data?.data],
  );

  const createMutation = useMutation({
    mutationFn: academicYearsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
      setDialog(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => academicYearsApi.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
      setDialog(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: academicYearsApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
    },
  });

  const canWrite = user?.role === "SUPER_ADMIN";
  const paging = yearsQuery.data?.paging || defaultPaging(params);

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }));
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 });
  }

  function handleDelete(year) {
    if (window.confirm(`Delete academic year "${year.name}"?`)) {
      deleteMutation.mutate(year.id);
    }
  }

  return (
    <PanelFrame
      title="Academic Years"
      icon={CalendarDays}
      isFetching={yearsQuery.isFetching}
      action={
        <Button
          type="button"
          disabled={!canWrite}
          onClick={() => setDialog({ mode: "create" })}
        >
          <Plus size={16} />
          New Year
        </Button>
      }
      toolbar={
        <>
          <SearchBox
            value={params.search}
            placeholder="Search years"
            onChange={(value) => resetPageAndUpdate({ search: value })}
          />
          <FilterSelect
            label="Status"
            value={params.status}
            onChange={(value) => resetPageAndUpdate({ status: value })}
            options={[
              { value: "", label: "All statuses" },
              ...enumOptions(academicYearStatuses),
            ]}
          />
        </>
      }
      error={yearsQuery.error || deleteMutation.error}
    >
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
          <tr>
            <HeaderCell
              label="Name"
              column="name"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <HeaderCell
              label="Start"
              column="start_date"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <HeaderCell
              label="End"
              column="end_date"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <HeaderCell
              label="Status"
              column="status"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <LoadingRows
            isLoading={yearsQuery.isLoading}
            isEmpty={(yearsQuery.data?.data || []).length === 0}
            colSpan={5}
            label="academic years"
          />
          {!yearsQuery.isLoading
            ? (yearsQuery.data?.data || []).map((year) => (
                <tr
                  key={year.id}
                  className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                >
                  <td className="px-4 py-3 font-semibold text-[var(--mws-charcoal)]">
                    {year.name}
                  </td>
                  <td className="px-4 py-3">{formatDate(year.start_date)}</td>
                  <td className="px-4 py-3">{formatDate(year.end_date)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={statusTone(year.status)}>
                      {formatStatus(year.status)}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    <RowActions
                      disabled={!canWrite}
                      onEdit={() => setDialog({ mode: "edit", record: year })}
                      onDelete={() => handleDelete(year)}
                    />
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>

      <PaginationBar
        paging={paging}
        itemLabel="years"
        isLoading={yearsQuery.isLoading}
        onPrevious={() => updateParams({ page: params.page - 1 })}
        onNext={() => updateParams({ page: params.page + 1 })}
        onPageSizeChange={(size) => updateParams({ page: 1, size })}
      />

      {dialog ? (
        <AcademicYearDialog
          dialog={dialog}
          suggestedStartYear={suggestedStartYear}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => {
            if (dialog.mode === "create") createMutation.mutate(payload);
            else updateMutation.mutate({ id: dialog.record.id, payload });
          }}
        />
      ) : null}
    </PanelFrame>
  );
}

function GradesPanel() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    search: "",
    sort_by: "level",
    sort_order: "asc",
  });
  const [dialog, setDialog] = useState(null);

  const gradesQuery = useQuery({
    queryKey: ["grades", params],
    queryFn: () => gradesApi.list(params),
  });

  const unitsQuery = useQuery({
    queryKey: ["units-for-grade-form"],
    queryFn: () =>
      unitsApi.list({ page: 1, size: 100, sort_by: "name", sort_order: "asc" }),
  });

  const createMutation = useMutation({
    mutationFn: gradesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grades"] });
      queryClient.invalidateQueries({ queryKey: ["student-form-options"] });
      setDialog(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => gradesApi.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grades"] });
      queryClient.invalidateQueries({ queryKey: ["student-form-options"] });
      setDialog(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: gradesApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grades"] });
      queryClient.invalidateQueries({ queryKey: ["student-form-options"] });
    },
  });

  const canWrite = user?.role === "SUPER_ADMIN";
  const paging = gradesQuery.data?.paging || defaultPaging(params);

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }));
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 });
  }

  function handleDelete(grade) {
    if (window.confirm(`Delete grade "${grade.name}"?`)) {
      deleteMutation.mutate(grade.id);
    }
  }

  return (
    <PanelFrame
      title="Grades"
      icon={Layers3}
      isFetching={gradesQuery.isFetching}
      action={
        <Button
          type="button"
          disabled={!canWrite}
          onClick={() => setDialog({ mode: "create" })}
        >
          <Plus size={16} />
          New Grade
        </Button>
      }
      toolbar={
        <SearchBox
          value={params.search}
          placeholder="Search grades"
          onChange={(value) => resetPageAndUpdate({ search: value })}
        />
      }
      error={gradesQuery.error || deleteMutation.error}
    >
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
          <tr>
            <HeaderCell
              label="Name"
              column="name"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <HeaderCell
              label="Level"
              column="level"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <th className="px-4 py-3">Unit</th>
            <HeaderCell
              label="Created"
              column="created_at"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <LoadingRows
            isLoading={gradesQuery.isLoading}
            isEmpty={(gradesQuery.data?.data || []).length === 0}
            colSpan={5}
            label="grades"
          />
          {!gradesQuery.isLoading
            ? (gradesQuery.data?.data || []).map((grade) => (
                <tr
                  key={grade.id}
                  className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                >
                  <td className="px-4 py-3 font-semibold text-[var(--mws-charcoal)]">
                    {grade.name}
                  </td>
                  <td className="px-4 py-3">{grade.level}</td>
                  <td className="px-4 py-3">
                    {grade.unit_name || (
                      <span className="text-[var(--mws-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{formatDate(grade.created_at)}</td>
                  <td className="px-4 py-3">
                    <RowActions
                      disabled={!canWrite}
                      onEdit={() => setDialog({ mode: "edit", record: grade })}
                      onDelete={() => handleDelete(grade)}
                    />
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>

      <PaginationBar
        paging={paging}
        itemLabel="grades"
        isLoading={gradesQuery.isLoading}
        onPrevious={() => updateParams({ page: params.page - 1 })}
        onNext={() => updateParams({ page: params.page + 1 })}
        onPageSizeChange={(size) => updateParams({ page: 1, size })}
      />

      {dialog ? (
        <GradeDialog
          dialog={dialog}
          units={unitsQuery.data?.data || []}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => {
            if (dialog.mode === "create") createMutation.mutate(payload);
            else updateMutation.mutate({ id: dialog.record.id, payload });
          }}
        />
      ) : null}
    </PanelFrame>
  );
}

function ClassesPanel() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    search: "",
    grade_id: "",
    academic_year_id: "",
    status: "",
    sort_by: "created_at",
    sort_order: "desc",
  });
  const [dialog, setDialog] = useState(null);

  const classesQuery = useQuery({
    queryKey: ["classes", params],
    queryFn: () => classesApi.list(params),
  });
  const optionsQuery = useClassOptionsQuery();

  // Teacher assignment and enrollment now live on the class's own detail
  // page - this dialog only ever creates a class, then navigates there.
  const createMutation = useMutation({
    mutationFn: classesApi.create,
    onSuccess: (created) => {
      invalidateClassData(queryClient);
      setDialog(null);
      navigate(`/academic/classes/${created.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: classesApi.remove,
    onSuccess: () => invalidateClassData(queryClient),
  });

  const canWrite =
    user?.role === "SUPER_ADMIN" ||
    (user?.role === "DATABASE_ADMIN" && user?.can_write_data);
  const canDelete = user?.role === "SUPER_ADMIN";
  const paging = classesQuery.data?.paging || defaultPaging(params);

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }));
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 });
  }

  function handleDelete(klass) {
    if (window.confirm(`Delete class "${klass.name}"?`)) {
      deleteMutation.mutate(klass.id);
    }
  }

  return (
    <PanelFrame
      title="Classes"
      icon={BookOpen}
      isFetching={classesQuery.isFetching || optionsQuery.isFetching}
      action={
        <Button
          type="button"
          disabled={!canWrite || optionsQuery.isLoading}
          onClick={() => setDialog({ mode: "create" })}
        >
          <Plus size={16} />
          New Class
        </Button>
      }
      toolbar={
        <>
          <SearchBox
            value={params.search}
            placeholder="Search classes"
            onChange={(value) => resetPageAndUpdate({ search: value })}
          />
          <FilterSelect
            label="Academic year"
            value={params.academic_year_id}
            onChange={(value) =>
              resetPageAndUpdate({ academic_year_id: value })
            }
            options={[
              { value: "", label: "All years" },
              ...academicYearSelectOptions(
                optionsQuery.data?.academicYears || [],
              ),
            ]}
          />
          <FilterSelect
            label="Grade"
            value={params.grade_id}
            onChange={(value) => resetPageAndUpdate({ grade_id: value })}
            options={[
              { value: "", label: "All grades" },
              ...gradeSelectOptions(optionsQuery.data?.grades || []),
            ]}
          />
          <FilterSelect
            label="Status"
            value={params.status}
            onChange={(value) => resetPageAndUpdate({ status: value })}
            options={[
              { value: "", label: "All statuses" },
              ...enumOptions(classStatuses),
            ]}
          />
        </>
      }
      error={classesQuery.error || optionsQuery.error || deleteMutation.error}
    >
      <table className="w-full min-w-[920px] text-left text-sm">
        <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
          <tr>
            <HeaderCell
              label="Name"
              column="name"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <HeaderCell
              label="Grade"
              column="grade_level"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <th className="px-4 py-3">Academic Year</th>
            <th className="px-4 py-3">Homeroom</th>
            <HeaderCell
              label="Status"
              column="status"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <th className="px-4 py-3">Capacity</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <LoadingRows
            isLoading={classesQuery.isLoading}
            isEmpty={(classesQuery.data?.data || []).length === 0}
            colSpan={7}
            label="classes"
          />
          {!classesQuery.isLoading
            ? (classesQuery.data?.data || []).map((klass) => (
                <tr
                  key={klass.id}
                  className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                >
                  <td className="px-4 py-3 font-semibold text-[var(--mws-charcoal)]">
                    {klass.name}
                  </td>
                  <td className="px-4 py-3">{klass.grade.name}</td>
                  <td className="px-4 py-3">{klass.academic_year.name}</td>
                  <td className="px-4 py-3">
                    {klass.homeroom_teachers?.length
                      ? klass.homeroom_teachers
                          .map((t) => t.employee.full_name)
                          .join(", ")
                      : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={statusTone(klass.status)}>
                      {formatStatus(klass.status)}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    {klass.capacity ? (
                      <div>
                        <p className="font-semibold text-[var(--mws-charcoal)]">
                          {klass.active_enrollment_count ?? 0}/{klass.capacity}{" "}
                          students
                        </p>
                        <p className="text-xs text-[var(--mws-muted)]">
                          {Math.max(
                            klass.capacity -
                              (klass.active_enrollment_count ?? 0),
                            0,
                          )}{" "}
                          seats left
                        </p>
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <RowActions
                      disableDelete={!canDelete}
                      onView={() => navigate(`/academic/classes/${klass.id}`)}
                      onDelete={() => handleDelete(klass)}
                    />
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>

      <PaginationBar
        paging={paging}
        itemLabel="classes"
        isLoading={classesQuery.isLoading}
        onPrevious={() => updateParams({ page: params.page - 1 })}
        onNext={() => updateParams({ page: params.page + 1 })}
        onPageSizeChange={(size) => updateParams({ page: 1, size })}
      />

      {dialog ? (
        <ClassDialog
          dialog={dialog}
          options={optionsQuery.data}
          isSubmitting={createMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => createMutation.mutate(payload)}
          user={user}
        />
      ) : null}
    </PanelFrame>
  );
}

function EnrollmentsPanel() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    student_id: "",
    class_id: "",
    academic_year_id: "",
    status: "",
    is_deleted: "",
    sort_by: "created_at",
    sort_order: "desc",
  });
  const [dialog, setDialog] = useState(null);
  const [selectedEnrollmentIds, setSelectedEnrollmentIds] = useState(
    () => new Set(),
  );

  const enrollmentsQuery = useQuery({
    queryKey: ["enrollments", params],
    queryFn: () => enrollmentsApi.list(params),
  });
  const optionsQuery = useEnrollmentOptionsQuery();
  const enrollments = useMemo(
    () => enrollmentsQuery.data?.data || [],
    [enrollmentsQuery.data?.data],
  );

  const createMutation = useMutation({
    mutationFn: async ({
      studentId,
      studentIds,
      payload,
      specialEducationEmployeeId,
    }) => {
      if (studentIds?.length > 1) {
        const result = await enrollmentsApi.bulkCreate({
          student_ids: studentIds,
          ...payload,
        });

        if (specialEducationEmployeeId) {
          const successfulStudentIds = result.items
            .filter((item) => item.status === "SUCCESS")
            .map((item) => item.id);

          await Promise.allSettled(
            successfulStudentIds.map((id) =>
              studentSensitiveApi.createSupportAssignment(id, {
                employee_id: specialEducationEmployeeId,
                role: "SPECIAL_ED",
              }),
            ),
          );
        }

        return result;
      }

      const targetStudentId = studentId || studentIds?.[0];
      const enrollment = await enrollmentsApi.create(targetStudentId, payload);
      if (specialEducationEmployeeId) {
        await studentSensitiveApi.createSupportAssignment(targetStudentId, {
          employee_id: specialEducationEmployeeId,
          role: "SPECIAL_ED",
        });
      }
      return enrollment;
    },
    onSuccess: (data, { studentId, studentIds }) => {
      invalidateEnrollmentData(queryClient);
      const ids = studentIds || [studentId];
      ids.filter(Boolean).forEach((id) => {
        queryClient.invalidateQueries({
          queryKey: ["students", id, "support-assignments"],
        });
      });
      if (data?.success_count !== undefined) {
        if (data.success_count > 0) {
          showSuccessToast(`${data.success_count} student(s) enrolled.`);
        }
        if (data.failed_count > 0) {
          showErrorToast(`${data.failed_count} student(s) failed to enroll.`);
        }
      }
      setDialog(null);
    },
    onError: (error) => showErrorToast(error, 'Enrollment failed.'),
  });

  const transferMutation = useMutation({
    mutationFn: ({ enrollment, payload }) =>
      enrollmentsApi.transfer(enrollment.student.id, enrollment.id, payload),
    onSuccess: () => {
      invalidateEnrollmentData(queryClient);
      setDialog(null);
    },
  });

  const promoteMutation = useMutation({
    mutationFn: ({ enrollment, payload }) =>
      enrollmentsApi.promote(enrollment.student.id, enrollment.id, payload),
    onSuccess: () => {
      invalidateEnrollmentData(queryClient);
      setDialog(null);
    },
  });

  const bulkPromoteMutation = useMutation({
    mutationFn: ({ enrollments: selectedEnrollments, payload }) =>
      enrollmentsApi.bulkPromote({
        enrollment_ids: selectedEnrollments.map((enrollment) => enrollment.id),
        ...payload,
      }),
    onSuccess: (result) => {
      invalidateEnrollmentData(queryClient);
      setSelectedEnrollmentIds(new Set());
      setDialog(null);
      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} enrollment(s) promoted.`);
      }
      if (result.failed_count > 0) {
        showErrorToast(
          `${result.failed_count} enrollment(s) failed to promote.`,
        );
      }
    },
  });

  const closeMutation = useMutation({
    mutationFn: ({ enrollment, payload }) =>
      enrollmentsApi.close(enrollment.student.id, enrollment.id, payload),
    onSuccess: () => {
      invalidateEnrollmentData(queryClient);
      setDialog(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (enrollment) =>
      enrollmentsApi.remove(enrollment.student.id, enrollment.id),
    onSuccess: () => invalidateEnrollmentData(queryClient),
  });

  const restoreMutation = useMutation({
    mutationFn: (enrollment) =>
      enrollmentsApi.restore(enrollment.student.id, enrollment.id),
    onSuccess: () => invalidateEnrollmentData(queryClient),
  });

  const canWrite = user?.type === "admin" && user?.role !== "VIEWER";
  const canDelete = user?.role === "SUPER_ADMIN";
  const paging = enrollmentsQuery.data?.paging || defaultPaging(params);
  const isTrash = params.is_deleted === "true";
  const selectableEnrollments = useMemo(
    () =>
      enrollments.filter(
        (enrollment) =>
          !isTrash && enrollment.enrollment_status === "ACTIVE" && canWrite,
      ),
    [canWrite, enrollments, isTrash],
  );
  const selectedEnrollments = useMemo(
    () =>
      enrollments.filter((enrollment) =>
        selectedEnrollmentIds.has(enrollment.id),
      ),
    [enrollments, selectedEnrollmentIds],
  );
  const allPageSelected =
    selectableEnrollments.length > 0 &&
    selectableEnrollments.every((enrollment) =>
      selectedEnrollmentIds.has(enrollment.id),
    );

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }));
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 });
  }

  function handleDelete(enrollment) {
    if (
      window.confirm(
        `Move ${enrollment.student.full_name}'s enrollment to trash?`,
      )
    ) {
      deleteMutation.mutate(enrollment);
    }
  }

  function toggleEnrollment(enrollmentId, checked) {
    setSelectedEnrollmentIds((current) => {
      const next = new Set(current);
      if (checked) next.add(enrollmentId);
      else next.delete(enrollmentId);
      return next;
    });
  }

  function toggleCurrentPage(checked) {
    setSelectedEnrollmentIds((current) => {
      const next = new Set(current);
      selectableEnrollments.forEach((enrollment) => {
        if (checked) next.add(enrollment.id);
        else next.delete(enrollment.id);
      });
      return next;
    });
  }

  return (
    <PanelFrame
      title="Enrollments"
      icon={GraduationCap}
      isFetching={enrollmentsQuery.isFetching || optionsQuery.isFetching}
      action={
        <Button
          type="button"
          disabled={!canWrite || optionsQuery.isLoading}
          onClick={() => setDialog({ mode: "create" })}
        >
          <Plus size={16} />
          New Enrollment
        </Button>
      }
      toolbar={
        <>
          <FilterSelect
            label="Academic year"
            value={params.academic_year_id}
            onChange={(value) =>
              resetPageAndUpdate({ academic_year_id: value })
            }
            options={[
              { value: "", label: "All years" },
              ...academicYearSelectOptions(
                optionsQuery.data?.academicYears || [],
              ),
            ]}
          />
          <FilterSelect
            label="Class"
            value={params.class_id}
            onChange={(value) => resetPageAndUpdate({ class_id: value })}
            options={[
              { value: "", label: "All classes" },
              ...classSelectOptions(optionsQuery.data?.classes || []),
            ]}
          />
          <FilterSelect
            label="Status"
            value={params.status}
            onChange={(value) => resetPageAndUpdate({ status: value })}
            options={[
              { value: "", label: "All statuses" },
              ...enumOptions(enrollmentStatuses),
            ]}
          />
          <FilterSelect
            label="Records"
            value={params.is_deleted}
            onChange={(value) => resetPageAndUpdate({ is_deleted: value })}
            options={[
              { value: "", label: "Active records" },
              { value: "true", label: "Trash bin" },
            ]}
          />
        </>
      }
      error={
        enrollmentsQuery.error ||
        optionsQuery.error ||
        createMutation.error ||
        transferMutation.error ||
        promoteMutation.error ||
        bulkPromoteMutation.error ||
        closeMutation.error ||
        deleteMutation.error ||
        restoreMutation.error
      }
    >
      <BulkActionBar
        selectedCount={selectedEnrollments.length}
        onClear={() => setSelectedEnrollmentIds(new Set())}
      >
        <Button
          type="button"
          size="sm"
          disabled={!canWrite || selectedEnrollments.length === 0}
          onClick={() =>
            setDialog({ mode: "bulk-promote", records: selectedEnrollments })
          }
        >
          <GraduationCap size={15} />
          Promote selected
        </Button>
      </BulkActionBar>

      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
          <tr>
            <th className="w-12 px-4 py-3">
              <input
                type="checkbox"
                aria-label="Select all active enrollments on this page"
                checked={allPageSelected}
                disabled={selectableEnrollments.length === 0}
                onChange={(event) => toggleCurrentPage(event.target.checked)}
                className="h-4 w-4 accent-[var(--mws-burgundy)]"
              />
            </th>
            <th className="px-4 py-3">Student</th>
            <th className="px-4 py-3">Class</th>
            <th className="px-4 py-3">Academic Year</th>
            <th className="px-4 py-3">Grade Snapshot</th>
            <HeaderCell
              label="Start"
              column="start_date"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <th className="px-4 py-3">End</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <LoadingRows
            isLoading={enrollmentsQuery.isLoading}
            isEmpty={enrollments.length === 0}
            colSpan={9}
            label="enrollments"
          />
          {!enrollmentsQuery.isLoading
            ? enrollments.map((enrollment) => {
                const isSelectable =
                  !isTrash &&
                  canWrite &&
                  enrollment.enrollment_status === "ACTIVE";
                return (
                  <tr
                    key={enrollment.id}
                    className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${enrollment.student.full_name}`}
                        checked={selectedEnrollmentIds.has(enrollment.id)}
                        disabled={!isSelectable}
                        onChange={(event) =>
                          toggleEnrollment(enrollment.id, event.target.checked)
                        }
                        className="h-4 w-4 accent-[var(--mws-burgundy)] disabled:opacity-40"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[var(--mws-charcoal)]">
                        {enrollment.student.full_name}
                      </p>
                      <p className="text-xs text-[var(--mws-muted)]">
                        {enrollment.student.nis}
                      </p>
                    </td>
                    <td className="px-4 py-3">{enrollment.class.name}</td>
                    <td className="px-4 py-3">
                      {enrollment.academic_year.name}
                    </td>
                    <td className="px-4 py-3">
                      {enrollment.grade_level}
                      {enrollment.is_retention ? (
                        <span
                          className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                          title={enrollment.retention_reason || "Retention"}
                        >
                          Retention
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {formatDate(enrollment.start_date)}
                    </td>
                    <td className="px-4 py-3">
                      {formatDate(enrollment.end_date)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        tone={enrollmentStatusTone(enrollment.enrollment_status)}
                      >
                        {formatStatus(enrollment.enrollment_status)}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3">
                      <EnrollmentRowActions
                        enrollment={enrollment}
                        isTrash={isTrash}
                        canWrite={canWrite}
                        canDelete={canDelete}
                        restoringId={restoreMutation.variables?.id}
                        onTransfer={() =>
                          setDialog({ mode: "transfer", record: enrollment })
                        }
                        onPromote={() =>
                          setDialog({ mode: "promote", record: enrollment })
                        }
                        onClose={() =>
                          setDialog({ mode: "close", record: enrollment })
                        }
                        onDelete={() => handleDelete(enrollment)}
                        onRestore={() => restoreMutation.mutate(enrollment)}
                      />
                    </td>
                  </tr>
                );
              })
            : null}
        </tbody>
      </table>

      <PaginationBar
        paging={paging}
        itemLabel="enrollments"
        isLoading={enrollmentsQuery.isLoading}
        onPrevious={() => updateParams({ page: params.page - 1 })}
        onNext={() => updateParams({ page: params.page + 1 })}
        onPageSizeChange={(size) => updateParams({ page: 1, size })}
      />

      {dialog ? (
        <EnrollmentDialog
          dialog={dialog}
          options={optionsQuery.data}
          isSubmitting={
            createMutation.isPending ||
            transferMutation.isPending ||
            promoteMutation.isPending ||
            closeMutation.isPending ||
            bulkPromoteMutation.isPending
          }
          onClose={() => setDialog(null)}
          onSubmit={(payload) => {
            if (dialog.mode === "create") createMutation.mutate(payload);
            if (dialog.mode === "transfer") {
              transferMutation.mutate({ enrollment: dialog.record, payload });
            }
            if (dialog.mode === "promote") {
              promoteMutation.mutate({ enrollment: dialog.record, payload });
            }
            if (dialog.mode === "bulk-promote") {
              bulkPromoteMutation.mutate({
                enrollments: dialog.records,
                payload,
              });
            }
            if (dialog.mode === "close") {
              closeMutation.mutate({ enrollment: dialog.record, payload });
            }
          }}
        />
      ) : null}
    </PanelFrame>
  );
}

function AcademicYearDialog({
  dialog,
  suggestedStartYear,
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const existingStartYear = parseAcademicYearStartYear(dialog.record?.name);
  const [values, setValues] = useState(() => ({
    startYear:
      dialog.mode === "create"
        ? String(suggestedStartYear ?? new Date().getFullYear())
        : String(existingStartYear ?? new Date().getFullYear()),
    start_date: dateInputFromIso(dialog.record?.start_date),
    end_date: dateInputFromIso(dialog.record?.end_date),
    status: dialog.record?.status || "UPCOMING",
    activateClasses: false,
  }));

  const startYearNumber = optionalNumber(values.startYear);
  const computedName = startYearNumber
    ? `${startYearNumber}/${startYearNumber + 1}`
    : "";
  const isLegacyName = dialog.mode === "edit" && existingStartYear === null;

  const currentYear = new Date().getFullYear();
  const activeYearTooFar =
    values.status === "ACTIVE" &&
    startYearNumber &&
    Math.abs(currentYear - startYearNumber) > 1;

  const startDateYear = values.start_date
    ? Number(values.start_date.slice(0, 4))
    : null;
  const endDateYear = values.end_date
    ? Number(values.end_date.slice(0, 4))
    : null;
  const startDateMismatch =
    startYearNumber &&
    startDateYear !== null &&
    startDateYear !== startYearNumber;
  const endDateMismatch =
    startYearNumber &&
    endDateYear !== null &&
    endDateYear !== startYearNumber + 1;

  function submit(event) {
    event.preventDefault();
    onSubmit(
      cleanPayload({
        name: computedName || undefined,
        start_date: isoFromDateInput(values.start_date),
        end_date: isoFromDateInput(values.end_date),
        status: values.status,
        activate_classes:
          values.status === "ACTIVE" ? values.activateClasses : undefined,
      }),
    );
  }

  return (
    <CrudDialog
      title={
        dialog.mode === "create" ? "New Academic Year" : "Edit Academic Year"
      }
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="academic-year-form"
            type="submit"
            disabled={isSubmitting}
          >
            Save
          </Button>
        </>
      }
    >
      <form
        id="academic-year-form"
        onSubmit={submit}
        className="grid gap-4 md:grid-cols-2"
      >
        <Field
          label="Start year"
          className="md:col-span-2"
          hint={
            isLegacyName
              ? `Current name "${dialog.record?.name}" doesn't follow the YYYY/YYYY format - saving will rename it to ${computedName || "..."}.`
              : `Academic year name will be: ${computedName || "..."}`
          }
        >
          <TextInput
            required
            type="number"
            value={values.startYear}
            onChange={(event) =>
              setValues({ ...values, startYear: event.target.value })
            }
          />
        </Field>
        {activeYearTooFar ? (
          <p className="rounded-lg bg-[#fff0f1] px-3 py-2 text-xs font-semibold text-[#a43c41] md:col-span-2">
            {computedName} doesn't look like the current academic year (today is{" "}
            {currentYear}). Marking it ACTIVE will likely be rejected - use
            UPCOMING or COMPLETED instead.
          </p>
        ) : null}
        <Field
          label="Start date"
          hint={
            startDateMismatch
              ? `Should fall within ${startYearNumber} to match ${computedName}.`
              : undefined
          }
        >
          <TextInput
            required
            type="date"
            value={values.start_date}
            onChange={(event) =>
              setValues({ ...values, start_date: event.target.value })
            }
          />
        </Field>
        <Field
          label="End date"
          hint={
            endDateMismatch
              ? `Should fall within ${startYearNumber + 1} to match ${computedName}.`
              : undefined
          }
        >
          <TextInput
            type="date"
            value={values.end_date}
            onChange={(event) =>
              setValues({ ...values, end_date: event.target.value })
            }
          />
        </Field>
        <Field label="Status" className="md:col-span-2">
          <SearchableSelect
            value={values.status}
            onChange={(value) => setValues({ ...values, status: value })}
            options={enumOptions(academicYearStatuses)}
            placeholder="Select status"
            searchPlaceholder="Search status"
          />
        </Field>
        {values.status === "ACTIVE" ? (
          <CheckboxField
            className="md:col-span-2"
            label="Also activate this year's classes"
            description="Bulk-activates every currently Inactive class in this year. Classes you've deliberately left inactive elsewhere are untouched otherwise."
            checked={values.activateClasses}
            onChange={(event) =>
              setValues({ ...values, activateClasses: event.target.checked })
            }
          />
        ) : null}
      </form>
    </CrudDialog>
  );
}

function GradeDialog({ dialog, units, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    name: dialog.record?.name || "",
    level: dialog.record?.level ?? "",
    unit_id: dialog.record?.unit_id || "",
  }));

  function submit(event) {
    event.preventDefault();
    onSubmit(
      cleanPayload({
        name: trimmedOrUndefined(values.name),
        level: optionalNumber(values.level),
        unit_id: values.unit_id || null,
      }),
    );
  }

  return (
    <CrudDialog
      title={dialog.mode === "create" ? "New Grade" : "Edit Grade"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="grade-form" type="submit" disabled={isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="grade-form"
        onSubmit={submit}
        className="grid gap-4 md:grid-cols-2"
      >
        <Field label="Name">
          <TextInput
            required
            value={values.name}
            onChange={(event) =>
              setValues({ ...values, name: event.target.value })
            }
          />
        </Field>
        <Field label="Level">
          <TextInput
            required
            type="number"
            value={values.level}
            onChange={(event) =>
              setValues({ ...values, level: event.target.value })
            }
          />
        </Field>
        <Field label="Unit" className="md:col-span-2">
          <SearchableSelect
            value={values.unit_id}
            onChange={(value) => setValues({ ...values, unit_id: value })}
            options={[
              { value: "", label: "No unit" },
              ...academicUnitOptions(units || []),
            ]}
            placeholder="No unit"
            searchPlaceholder="Search unit"
          />
        </Field>
      </form>
    </CrudDialog>
  );
}

function PanelFrame({
  title,
  icon: Icon,
  action,
  toolbar,
  isFetching,
  children,
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--mws-line)] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
            <Icon size={18} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--mws-charcoal)]">
              {title}
            </h2>
            <StatusBadge tone={isFetching ? "amber" : "green"}>
              {isFetching ? "Syncing" : "Live"}
            </StatusBadge>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
          {action}
        </div>
      </div>
      {toolbar ? (
        <div className="flex min-w-0 flex-col gap-2 border-b border-[var(--mws-line)] p-4 lg:flex-row lg:flex-wrap lg:items-end">
          {toolbar}
        </div>
      ) : null}
      <div className="w-full min-w-0 overflow-x-auto">{children}</div>
    </section>
  );
}

function SearchBox({ value, placeholder, onChange }) {
  return (
    <DebouncedSearchInput
      value={value}
      placeholder={placeholder}
      className="lg:max-w-lg"
      onChange={onChange}
    />
  );
}

function HeaderCell({ label, column, params, onSort }) {
  return (
    <th className="px-4 py-3">
      <SortableHeader
        label={label}
        column={column}
        sortBy={params.sort_by}
        sortOrder={params.sort_order}
        onSort={(nextColumn, nextOrder) =>
          onSort({ sort_by: nextColumn, sort_order: nextOrder })
        }
      />
    </th>
  );
}

function RowActions({
  disabled,
  disableEdit,
  disableDelete,
  onView,
  onEdit,
  onDelete,
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {onView ? (
        <Button type="button" variant="ghost" size="sm" onClick={onView}>
          <Eye size={15} />
          View
        </Button>
      ) : null}
      {onEdit ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disableEdit ?? disabled}
          onClick={onEdit}
        >
          <Edit size={15} />
          Edit
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disableDelete ?? disabled}
        onClick={onDelete}
      >
        <Trash2 size={15} />
        Delete
      </Button>
    </div>
  );
}

function EnrollmentRowActions({
  enrollment,
  isTrash,
  canWrite,
  canDelete,
  restoringId,
  onTransfer,
  onPromote,
  onClose,
  onDelete,
  onRestore,
}) {
  if (isTrash) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canDelete || restoringId === enrollment.id}
        onClick={onRestore}
      >
        <RotateCcw size={15} />
        Restore
      </Button>
    );
  }

  const isActive = enrollment.enrollment_status === "ACTIVE";

  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canWrite || !isActive}
        onClick={onTransfer}
      >
        Transfer
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canWrite || !isActive}
        onClick={onPromote}
      >
        Promote
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canWrite || !isActive}
        onClick={onClose}
      >
        Close
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canDelete}
        onClick={onDelete}
      >
        <Trash2 size={15} />
      </Button>
    </div>
  );
}

function LoadingRows({ isLoading, isEmpty, colSpan, label }) {
  if (isLoading) {
    return (
      <tr>
        <td
          className="px-4 py-10 text-center text-[var(--mws-muted)]"
          colSpan={colSpan}
        >
          Loading {label}...
        </td>
      </tr>
    );
  }

  if (isEmpty) {
    return (
      <tr>
        <td
          className="px-4 py-10 text-center text-[var(--mws-muted)]"
          colSpan={colSpan}
        >
          No {label} found.
        </td>
      </tr>
    );
  }

  return null;
}

function useClassOptionsQuery() {
  return useQuery({
    queryKey: ["class-form-options"],
    queryFn: async () => {
      const [grades, academicYears, employees, jobLevels] = await Promise.all([
        gradesApi.list({
          page: 1,
          size: 100,
          sort_by: "level",
          sort_order: "asc",
        }),
        academicYearsApi.list({
          page: 1,
          size: 100,
          sort_by: "start_date",
          sort_order: "desc",
        }),
        employeesApi.list({ page: 1, size: 100, status: "ACTIVE" }),
        jobLevelsApi.list({
          page: 1,
          size: 100,
          sort_by: "name",
          sort_order: "asc",
        }),
      ]);
      const teachingLevelNames = new Set(
        (jobLevels.data || [])
          .filter((level) => level.is_teaching_role)
          .map((level) => level.name),
      );
      const activeEmployees = employees.data || [];

      return {
        grades: grades.data || [],
        academicYears: academicYears.data || [],
        employees: activeEmployees,
        teachingEmployees: activeEmployees.filter((employee) =>
          teachingLevelNames.has(employee.employment.job_level),
        ),
      };
    },
  });
}

function useEnrollmentOptionsQuery() {
  return useQuery({
    queryKey: ["enrollment-form-options"],
    queryFn: async () => {
      const [classes, grades, academicYears, employees, caseload] =
        await Promise.all([
          classesApi.list({ page: 1, size: 100, status: "ACTIVE" }),
          gradesApi.list({ page: 1, size: 100 }),
          academicYearsApi.list({
            page: 1,
            size: 100,
            sort_by: "start_date",
            sort_order: "desc",
          }),
          employeesApi.list({
            page: 1,
            size: 100,
            status: "ACTIVE",
            sort_by: "full_name",
            sort_order: "asc",
          }),
          studentSensitiveApi.getSupportAssignmentCaseload(),
        ]);
      const caseloadByEmployeeId = new Map(
        caseload.map((entry) => [
          entry.employee_id,
          entry.active_student_count,
        ]),
      );
      const unitIdByGradeId = new Map(
        (grades.data || []).map((grade) => [grade.id, grade.unit_id]),
      );

      return {
        classes: classes.data || [],
        unitIdByGradeId,
        academicYears: academicYears.data || [],
        specialEducationTeachers: (employees.data || [])
          .filter(
            (employee) =>
              employee.employment.job_level === "SE Teacher" &&
              employee.employment.job_position === "Special Education Teacher",
          )
          .map((employee) => ({
            ...employee,
            active_student_count: caseloadByEmployeeId.get(employee.id) || 0,
          })),
      };
    },
  });
}

function invalidateClassData(queryClient) {
  queryClient.invalidateQueries({ queryKey: ["classes"] });
  queryClient.invalidateQueries({ queryKey: ["class-form-options"] });
  queryClient.invalidateQueries({ queryKey: ["student-form-options"] });
  queryClient.invalidateQueries({ queryKey: ["enrollment-form-options"] });
}

function invalidateEnrollmentData(queryClient) {
  queryClient.invalidateQueries({ queryKey: ["enrollments"] });
  queryClient.invalidateQueries({ queryKey: ["students"] });
  queryClient.invalidateQueries({ queryKey: ["enrollment-form-options"] });
}

const ACADEMIC_YEAR_NAME_PATTERN = /^(\d{4})\/(\d{4})$/;

// Academic year names are now normalized server-side to "YYYY/YYYY+1" -
// this parses that back out for a specific record (returns null for a
// pre-existing name that doesn't follow the pattern, e.g. legacy data).
function parseAcademicYearStartYear(name) {
  const match = name?.match(ACADEMIC_YEAR_NAME_PATTERN);
  return match ? Number(match[1]) : null;
}

// Suggests one year past the latest existing academic year. Names that
// don't follow the pattern (legacy data predating the normalization) are
// ignored; if none match, defaults to the current calendar year.
function nextAcademicYearStartYear(years) {
  const startYears = years
    .map((year) => parseAcademicYearStartYear(year.name))
    .filter((year) => year !== null);

  if (startYears.length === 0) return new Date().getFullYear();

  return Math.max(...startYears) + 1;
}

function enumOptions(values) {
  return values.map((value) => ({ value, label: formatStatus(value) }));
}

// Only these 3 units ever have grades under them - mirrors
// ACADEMIC_UNIT_NAMES in server/src/service/grade-service.ts, which
// enforces the same restriction server-side.
const ACADEMIC_UNIT_NAMES = ["Kindergarten", "Elementary", "Junior High"];

function academicUnitOptions(units) {
  return units
    .filter((unit) => ACADEMIC_UNIT_NAMES.includes(unit.name))
    .map((unit) => ({ value: unit.id, label: unit.name }));
}

function academicYearSelectOptions(years) {
  return years.map((year) => ({
    value: year.id,
    label: year.name,
    badge: formatStatus(year.status),
    tone: statusTone(year.status),
    searchText: `${year.name} ${formatStatus(year.status)}`,
  }));
}

function gradeSelectOptions(grades) {
  return grades.map((grade) => ({
    value: grade.id,
    label: grade.name,
    searchText: `${grade.name} ${grade.level ?? ""}`,
  }));
}


function classSelectOptions(classes) {
  return classes.map((klass) => {
    const capacity = getClassCapacityLabel(klass);
    return {
      value: klass.id,
      label: klass.name,
      description: [
        klass.grade?.name,
        klass.academic_year?.name,
        capacity.description,
      ]
        .filter(Boolean)
        .join(" / "),
      badge: capacity.badge,
      tone: capacity.tone,
      searchText: `${klass.name} ${klass.grade?.name || ""} ${klass.academic_year?.name || ""} ${capacity.description}`,
    };
  });
}

function getClassCapacityLabel(klass) {
  if (klass.capacity === null || klass.capacity === undefined) {
    return { description: "No capacity limit", badge: null, tone: "neutral" };
  }

  const activeCount = klass.active_enrollment_count ?? 0;
  const remaining = Math.max(klass.capacity - activeCount, 0);
  if (remaining === 0) {
    return {
      description: `${activeCount}/${klass.capacity} students`,
      badge: "Full",
      tone: "red",
    };
  }

  return {
    description: `${activeCount}/${klass.capacity} students, ${remaining} seats left`,
    badge: `${remaining} seats`,
    tone: remaining <= 3 ? "amber" : "green",
  };
}

function defaultPaging(params) {
  return {
    current_page: params.page,
    total_page: 1,
    total_item: 0,
    size: params.size,
  };
}


function enrollmentStatusTone(status) {
  switch (status) {
    case 'ACTIVE':
      return 'green'
    case 'COMPLETED':
      return 'neutral'
    case 'TRANSFERRED':
      return 'amber'
    case 'WITHDRAWN':
      return 'red'
    default:
      return statusTone(status)
  }
}
