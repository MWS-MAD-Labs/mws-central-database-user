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
  Users,
  X,
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
  SearchableSelect,
  SelectInput,
  TextAreaInput,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { SortableHeader } from "../../../components/ui/SortableHeader.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { employeesApi } from "../../employees/api/employeesApi.js";
import { jobLevelsApi } from "../../master-data/api/masterDataApi.js";
import { studentSensitiveApi } from "../../students/api/studentSensitiveApi.js";
import { studentsApi } from "../../students/api/studentsApi.js";
import {
  academicYearStatuses,
  academicYearsApi,
  classesApi,
  classStatuses,
  classTeacherRoles,
  enrollmentCloseStatuses,
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
          <SelectFilter
            value={params.status}
            onChange={(value) => resetPageAndUpdate({ status: value })}
          >
            <option value="">All statuses</option>
            {academicYearStatuses.map((status) => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </SelectFilter>
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
            colSpan={4}
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
  const teacherAssignmentsQuery = useQuery({
    queryKey: ["classes", dialog?.record?.id, "teacher-assignments"],
    queryFn: () => classesApi.teacherAssignments(dialog.record.id),
    enabled: Boolean(dialog?.record?.id),
  });

  const assignTeacherMutation = useMutation({
    mutationFn: ({ classId, payload }) =>
      classesApi.assignTeacher(classId, payload),
    onSuccess: () => {
      invalidateClassData(queryClient);
      queryClient.invalidateQueries({
        queryKey: ["classes", dialog?.record?.id, "teacher-assignments"],
      });
    },
  });

  const endTeacherAssignmentMutation = useMutation({
    mutationFn: ({ classId, assignmentId }) =>
      classesApi.endTeacherAssignment(classId, assignmentId),
    onSuccess: () => {
      invalidateClassData(queryClient);
      queryClient.invalidateQueries({
        queryKey: ["classes", dialog?.record?.id, "teacher-assignments"],
      });
    },
  });

  // On create success, flip the same dialog into edit mode with the new
  // class instead of closing - teacher assignment needs a class id, which
  // only exists after this point.
  const createMutation = useMutation({
    mutationFn: classesApi.create,
    onSuccess: (created) => {
      invalidateClassData(queryClient);
      setDialog({ mode: "edit", record: created });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => classesApi.update(id, payload),
    onSuccess: () => {
      invalidateClassData(queryClient);
      setDialog(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: classesApi.remove,
    onSuccess: () => invalidateClassData(queryClient),
  });

  const canWrite = user?.role === "SUPER_ADMIN";
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
          <SelectFilter
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
            placeholder="All years"
          />
          <SelectFilter
            value={params.grade_id}
            onChange={(value) => resetPageAndUpdate({ grade_id: value })}
            options={[
              { value: "", label: "All grades" },
              ...gradeSelectOptions(optionsQuery.data?.grades || []),
            ]}
            placeholder="All grades"
          />
          <SelectFilter
            value={params.status}
            onChange={(value) => resetPageAndUpdate({ status: value })}
          >
            <option value="">All statuses</option>
            {classStatuses.map((status) => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </SelectFilter>
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
                      disabled={!canWrite}
                      onView={() => navigate(`/academic/classes/${klass.id}`)}
                      onEdit={() => setDialog({ mode: "edit", record: klass })}
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
          isSubmitting={createMutation.isPending || updateMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => {
            if (dialog.mode === "create") createMutation.mutate(payload);
            else updateMutation.mutate({ id: dialog.record.id, payload });
          }}
          assignments={teacherAssignmentsQuery.data || []}
          isLoadingAssignments={teacherAssignmentsQuery.isLoading}
          assignmentsError={teacherAssignmentsQuery.error}
          teachingEmployees={optionsQuery.data?.teachingEmployees || []}
          canWrite={canWrite}
          isAssigning={assignTeacherMutation.isPending}
          isEnding={endTeacherAssignmentMutation.isPending}
          onAssign={(payload) =>
            assignTeacherMutation.mutate({ classId: dialog.record.id, payload })
          }
          onEnd={(assignmentId) =>
            endTeacherAssignmentMutation.mutate({
              classId: dialog.record.id,
              assignmentId,
            })
          }
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
          <SelectFilter
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
            placeholder="All years"
          />
          <SelectFilter
            value={params.class_id}
            onChange={(value) => resetPageAndUpdate({ class_id: value })}
            options={[
              { value: "", label: "All classes" },
              ...classSelectOptions(optionsQuery.data?.classes || []),
            ]}
            placeholder="All classes"
          />
          <SelectFilter
            value={params.status}
            onChange={(value) => resetPageAndUpdate({ status: value })}
          >
            <option value="">All statuses</option>
            {enrollmentStatuses.map((status) => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </SelectFilter>
          <SelectFilter
            value={params.is_deleted}
            onChange={(value) => resetPageAndUpdate({ is_deleted: value })}
          >
            <option value="">Active records</option>
            <option value="true">Trash bin</option>
          </SelectFilter>
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
          <SelectInput
            value={values.status}
            onChange={(event) =>
              setValues({ ...values, status: event.target.value })
            }
          >
            {academicYearStatuses.map((status) => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </SelectInput>
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

function GradeDialog({ dialog, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    name: dialog.record?.name || "",
    level: dialog.record?.level ?? "",
  }));

  function submit(event) {
    event.preventDefault();
    onSubmit(
      cleanPayload({
        name: trimmedOrUndefined(values.name),
        level: optionalNumber(values.level),
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
      </form>
    </CrudDialog>
  );
}

function ClassDialog({
  dialog,
  options,
  isSubmitting,
  onClose,
  onSubmit,
  assignments,
  isLoadingAssignments,
  assignmentsError,
  teachingEmployees,
  canWrite,
  isAssigning,
  isEnding,
  onAssign,
  onEnd,
}) {
  const record = dialog.record;
  const [values, setValues] = useState(() => ({
    name: record?.name || "",
    grade_id: record?.grade?.id || "",
    academic_year_id: record?.academic_year?.id || "",
    status: record?.status || "ACTIVE",
    capacity: record?.capacity ?? "",
  }));

  function submit(event) {
    event.preventDefault();
    onSubmit(
      cleanPayload({
        name: trimmedOrUndefined(values.name),
        grade_id: values.grade_id,
        academic_year_id: values.academic_year_id,
        status: values.status,
        capacity:
          values.capacity === "__clear__"
            ? null
            : optionalNumber(values.capacity),
      }),
    );
  }

  return (
    <CrudDialog
      title={dialog.mode === "create" ? "New Class" : "Edit Class"}
      description="Save the class, then manage its teachers below."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {record?.id ? "Close" : "Cancel"}
          </Button>
          <Button form="class-form" type="submit" disabled={isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="class-form"
        onSubmit={submit}
        className="grid gap-4 md:grid-cols-2"
      >
        <Field label="Name" className="md:col-span-2">
          <TextInput
            required
            value={values.name}
            onChange={(event) =>
              setValues({ ...values, name: event.target.value })
            }
          />
        </Field>
        <Field label="Grade">
          <SearchableSelect
            required
            value={values.grade_id}
            onChange={(value) => setValues({ ...values, grade_id: value })}
            options={gradeSelectOptions(options?.grades || [])}
            placeholder="Select grade"
            searchPlaceholder="Search grades"
          />
        </Field>
        <Field label="Academic year">
          <SearchableSelect
            required
            value={values.academic_year_id}
            onChange={(value) =>
              setValues({ ...values, academic_year_id: value })
            }
            options={academicYearSelectOptions(options?.academicYears || [])}
            placeholder="Select year"
            searchPlaceholder="Search years"
          />
        </Field>
        <Field label="Status">
          <SelectInput
            value={values.status}
            onChange={(event) =>
              setValues({ ...values, status: event.target.value })
            }
          >
            {classStatuses.map((status) => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Capacity">
          <TextInput
            type="number"
            min="1"
            value={values.capacity}
            onChange={(event) =>
              setValues({ ...values, capacity: event.target.value })
            }
          />
        </Field>
      </form>

      {record?.id ? (
        <TeacherAssignmentsSection
          assignments={assignments}
          isLoading={isLoadingAssignments}
          error={assignmentsError}
          teachingEmployees={teachingEmployees}
          canWrite={canWrite}
          isAssigning={isAssigning}
          isEnding={isEnding}
          onAssign={onAssign}
          onEnd={onEnd}
        />
      ) : (
        <p className="mt-6 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] px-4 py-8 text-center text-sm text-[var(--mws-muted)]">
          Save the class first to add homeroom, supporting, or subject teachers.
        </p>
      )}
    </CrudDialog>
  );
}

function EnrollmentDialog({
  dialog,
  options,
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const record = dialog.record;
  const isBulkPromote = dialog.mode === "bulk-promote";
  const [values, setValues] = useState(() => ({
    student_id: record?.student?.id || "",
    pending_student_id: "",
    class_id: record?.class?.id || "",
    start_date: "",
    effective_date: "",
    end_date: "",
    status: "TRANSFERRED",
    force: false,
    is_retention: false,
    retention_reason: "",
    special_education_employee_id: "",
  }));
  const [selectedStudentIds, setSelectedStudentIds] = useState(() =>
    record?.student?.id ? [record.student.id] : [],
  );

  const classOptions = options?.classes || [];

  const selectedClass = classOptions.find(
    (klass) => klass.id === values.class_id,
  );
  const classStudentOptionsQuery = useQuery({
    queryKey: ["enrollment-student-options", selectedClass?.grade?.id],
    enabled: dialog.mode === "create" && Boolean(selectedClass?.grade?.id),
    queryFn: async () => {
      const [registered, active] = await Promise.all([
        studentsApi.list({
          page: 1,
          size: 100,
          current_grade_id: selectedClass.grade.id,
          status: "REGISTERED",
        }),
        studentsApi.list({
          page: 1,
          size: 100,
          current_grade_id: selectedClass.grade.id,
          status: "ACTIVE",
        }),
      ]);
      return dedupeStudents([...(registered.data || []), ...(active.data || [])]);
    },
  });
  const selectedStudents = (classStudentOptionsQuery.data || []).filter(
    (student) => selectedStudentIds.includes(student.id),
  );
  const availableStudents = (classStudentOptionsQuery.data || []).filter(
    (student) => !selectedStudentIds.includes(student.id),
  );

  // Class options only carry {id, name, status} for academic_year (see
  // ClassResponse) - look up the full row from the separately-fetched
  // academicYears list to get its date range for the hints below.
  const selectedAcademicYear = (options?.academicYears || []).find(
    (year) => year.id === selectedClass?.academic_year?.id,
  );
  const recordAcademicYear = (options?.academicYears || []).find(
    (year) => year.id === record?.academic_year?.id,
  );

  // Start date / effective date default to the picked class's academic
  // year start - most enrollments/promotions land right at the year's
  // start, so this saves re-entering a date that's already known. Admins
  // can still edit it afterward for a mid-year admission.
  function handleClassChange(classId) {
    const klass = classOptions.find((item) => item.id === classId);
    const year = (options?.academicYears || []).find(
      (item) => item.id === klass?.academic_year?.id,
    );
    const yearStartDate = dateInputFromIso(year?.start_date);

    setValues((current) => ({
      ...current,
      class_id: classId,
      student_id: "",
      pending_student_id: "",
      ...(dialog.mode === "create" ? { start_date: yearStartDate } : {}),
      ...(dialog.mode === "promote" || isBulkPromote
        ? { effective_date: yearStartDate }
        : {}),
    }));
    if (dialog.mode === "create") {
      setSelectedStudentIds([]);
    }
  }

  function addPendingStudent() {
    if (!values.pending_student_id) return;
    setSelectedStudentIds((current) =>
      current.includes(values.pending_student_id)
        ? current
        : [...current, values.pending_student_id],
    );
    setValues((current) => ({ ...current, pending_student_id: "" }));
  }

  function removeQueuedStudent(studentId) {
    setSelectedStudentIds((current) =>
      current.filter((id) => id !== studentId),
    );
  }

  function submit(event) {
    event.preventDefault();
    if (dialog.mode === "create") {
      if (selectedStudentIds.length === 0) {
        showErrorToast("Select at least one student.");
        return;
      }
      onSubmit({
        studentId: selectedStudentIds[0],
        studentIds: selectedStudentIds,
        payload: cleanPayload({
          class_id: values.class_id,
          academic_year_id: selectedClass?.academic_year?.id,
          start_date: isoFromDateInput(values.start_date),
          force: values.force,
        }),
        specialEducationEmployeeId:
          values.special_education_employee_id || undefined,
      });
      return;
    }

    if (dialog.mode === "transfer") {
      onSubmit(
        cleanPayload({ class_id: values.class_id, force: values.force }),
      );
      return;
    }

    if (dialog.mode === "promote" || isBulkPromote) {
      onSubmit(
        cleanPayload({
          class_id: values.class_id,
          academic_year_id: selectedClass?.academic_year?.id,
          grade_id: selectedClass?.grade?.id,
          effective_date: isoFromDateInput(values.effective_date),
          force: values.force,
          is_retention: values.is_retention,
          retention_reason: values.is_retention
            ? trimmedOrUndefined(values.retention_reason)
            : undefined,
        }),
      );
      return;
    }

    onSubmit(
      cleanPayload({
        status: values.status,
        end_date: isoFromDateInput(values.end_date),
      }),
    );
  }

  return (
    <CrudDialog
      title={getEnrollmentDialogTitle(dialog.mode)}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="enrollment-form" type="submit" disabled={isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="enrollment-form"
        onSubmit={submit}
        className="grid gap-4 md:grid-cols-2"
      >
        {dialog.mode !== "close" ? (
          <Field
            label="Class"
            className="md:col-span-2"
            hint={
              dialog.mode === "create"
                ? "Choose the destination class first."
                : undefined
            }
          >
            <SearchableSelect
              required
              value={values.class_id}
              onChange={handleClassChange}
              options={classSelectOptions(classOptions)}
              placeholder="Select class"
              searchPlaceholder="Search classes"
            />
          </Field>
        ) : null}

        {dialog.mode === "create" ? (
          <div className="space-y-3 md:col-span-2">
            <Field
              label="Students"
              hint={
                selectedClass
                  ? `Showing ${selectedClass.grade?.name || "matching"} students only. Add students here, then save once.`
                  : "Select a class before adding students."
              }
            >
              <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
                <SearchableSelect
                  value={values.pending_student_id}
                  onChange={(value) =>
                    setValues({ ...values, pending_student_id: value })
                  }
                  options={studentSelectOptions(availableStudents)}
                  placeholder={
                    selectedClass
                      ? classStudentOptionsQuery.isLoading
                        ? "Loading students..."
                        : "Select student to add"
                      : "Select class first"
                  }
                  searchPlaceholder="Search name or NIS"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!values.pending_student_id}
                  onClick={addPendingStudent}
                >
                  <Plus size={15} />
                  Add
                </Button>
              </div>
            </Field>

            <div className="min-h-20 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-3">
              {selectedStudents.length === 0 ? (
                <p className="text-sm font-semibold text-[var(--mws-muted)]">
                  No students queued yet.
                </p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {selectedStudents.map((student) => (
                    <div
                      key={student.id}
                      className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--mws-line)] bg-white px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-display text-sm font-bold text-[var(--mws-charcoal)]">
                          {student.identity.full_name}
                        </p>
                        <p className="truncate text-xs text-[var(--mws-muted)]">
                          {[
                            student.academic.nis,
                            student.academic.current_grade,
                          ]
                            .filter(Boolean)
                            .join(" / ")}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeQueuedStudent(student.id)}
                      >
                        <X size={15} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {isBulkPromote ? (
          <div className="space-y-2 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-3 md:col-span-2">
            <p className="text-sm font-semibold text-[var(--mws-muted)]">
              {dialog.records?.length || 0} selected enrollment(s) will use
              this target class.
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {(dialog.records || []).map((enrollment) => (
                <div
                  key={enrollment.id}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--mws-line)] bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm font-bold text-[var(--mws-charcoal)]">
                      {enrollment.student.full_name}
                    </p>
                    <p className="truncate text-xs text-[var(--mws-muted)]">
                      {[enrollment.student.nis, enrollment.class.name]
                        .filter(Boolean)
                        .join(" / ")}
                    </p>
                  </div>
                  <StatusBadge
                    tone={enrollmentStatusTone(enrollment.enrollment_status)}
                  >
                    {formatStatus(enrollment.enrollment_status)}
                  </StatusBadge>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {dialog.mode === "create" ? (
          <Field
            label="Special Education teacher"
            className="md:col-span-2"
            hint="Student count shown is each teacher's current active caseload."
          >
            <SearchableSelect
              value={values.special_education_employee_id}
              onChange={(value) =>
                setValues({ ...values, special_education_employee_id: value })
              }
              options={specialEducationTeacherOptions(
                options?.specialEducationTeachers || [],
              )}
              placeholder="No Special Education teacher"
              searchPlaceholder="Search employee"
            />
          </Field>
        ) : null}

        {dialog.mode === "create" ? (
          <Field
            label="Start date"
            hint={academicYearRangeHint(selectedAcademicYear)}
          >
            <TextInput
              type="date"
              value={values.start_date}
              onChange={(event) =>
                setValues({ ...values, start_date: event.target.value })
              }
            />
          </Field>
        ) : null}

        {dialog.mode === "promote" || isBulkPromote ? (
          <Field
            label="Effective date"
            hint={academicYearRangeHint(selectedAcademicYear)}
          >
            <TextInput
              type="date"
              value={values.effective_date}
              onChange={(event) =>
                setValues({ ...values, effective_date: event.target.value })
              }
            />
          </Field>
        ) : null}

        {dialog.mode === "promote" || isBulkPromote ? (
          <>
            <CheckboxField
              className="md:col-span-2"
              label="Retention (repeat grade)"
              description="Check this if the student is repeating the same grade, or moving to a lower grade, instead of a normal promotion."
              checked={values.is_retention}
              onChange={(event) =>
                setValues({ ...values, is_retention: event.target.checked })
              }
            />
            {values.is_retention ? (
              <Field label="Retention reason" className="md:col-span-2">
                <TextAreaInput
                  required
                  value={values.retention_reason}
                  onChange={(event) =>
                    setValues({
                      ...values,
                      retention_reason: event.target.value,
                    })
                  }
                />
              </Field>
            ) : null}
          </>
        ) : null}

        {dialog.mode === "close" ? (
          <>
            <Field label="Close status">
              <SelectInput
                value={values.status}
                onChange={(event) =>
                  setValues({ ...values, status: event.target.value })
                }
              >
                {enrollmentCloseStatuses.map((status) => (
                  <option key={status} value={status}>
                    {formatStatus(status)}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field
              label="End date"
              hint={academicYearRangeHint(recordAcademicYear)}
            >
              <TextInput
                type="date"
                value={values.end_date}
                onChange={(event) =>
                  setValues({ ...values, end_date: event.target.value })
                }
              />
            </Field>
          </>
        ) : null}

        {dialog.mode === "create" ||
        dialog.mode === "transfer" ||
        dialog.mode === "promote" ||
        isBulkPromote ? (
          <CheckboxField
            className="md:col-span-2"
            label="Force capacity override"
            description="Only Super Admin can override a full class."
            checked={values.force}
            onChange={(event) =>
              setValues({ ...values, force: event.target.checked })
            }
          />
        ) : null}
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
        <div className="flex min-w-0 flex-col gap-2 border-b border-[var(--mws-line)] p-4 lg:flex-row lg:flex-wrap lg:items-center">
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

function SelectFilter({ value, onChange, options, placeholder, children }) {
  if (options) {
    return (
      <SearchableSelect
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        searchPlaceholder="Search"
        className="w-full min-w-0 lg:w-56"
      />
    );
  }

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-11 w-full min-w-0 rounded-xl border border-[var(--mws-line)] bg-white px-3 text-sm text-[var(--mws-charcoal)] outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A] lg:w-56"
    >
      {children}
    </select>
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

function RowActions({ disabled, onView, onEdit, onDelete }) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {onView ? (
        <Button type="button" variant="ghost" size="sm" onClick={onView}>
          <Eye size={15} />
          View
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={onEdit}
      >
        <Edit size={15} />
        Edit
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={onDelete}
      >
        <Trash2 size={15} />
        Delete
      </Button>
    </div>
  );
}

function TeacherAssignmentsSection({
  assignments,
  isLoading,
  error,
  teachingEmployees,
  canWrite,
  isAssigning,
  isEnding,
  onAssign,
  onEnd,
}) {
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
  const assignableEmployees =
    form.role === "SUBJECT_TEACHER"
      ? teachingEmployees.filter(
          (employee) =>
            !nonSubjectTeachingPositions.has(
              employee.employment.job_position?.trim().toLowerCase(),
            ),
        )
      : teachingEmployees;

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
  }

  return (
    <div className="mt-6 border-t border-[var(--mws-line)] pt-6">
      <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-bold text-[var(--mws-charcoal)]">
        <Users size={16} />
        Teachers
      </h3>

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

      {canWrite ? (
        <>
          <div className="mt-3 flex justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setForm({ employee_id: "", role: "HOMEROOM", subject: "" })
              }
            >
              <Plus size={16} />
              Add homeroom teacher
            </Button>
          </div>
          <form
            onSubmit={submitAssign}
            className="mt-3 grid gap-3 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-4 md:grid-cols-3"
          >
            <Field label="Teacher" className="md:col-span-1">
              <SearchableSelect
                value={form.employee_id}
                onChange={(value) => setForm({ ...form, employee_id: value })}
                options={employeeSelectOptions(assignableEmployees)}
                placeholder="Select teacher"
                searchPlaceholder="Search teachers"
              />
            </Field>
            <Field label="Role">
              <SelectInput
                value={form.role}
                onChange={(event) =>
                  setForm({
                    ...form,
                    role: event.target.value,
                    employee_id: "",
                  })
                }
              >
                {classTeacherRoles.map((role) => (
                  <option key={role} value={role}>
                    {formatStatus(role)}
                  </option>
                ))}
              </SelectInput>
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
            <div className="md:col-span-3">
              <Button type="submit" disabled={isAssigning || !form.employee_id}>
                <Plus size={16} />
                Add assignment
              </Button>
            </div>
          </form>
        </>
      ) : null}
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
      const [classes, academicYears, employees, caseload] =
        await Promise.all([
          classesApi.list({ page: 1, size: 100, status: "ACTIVE" }),
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

      return {
        classes: classes.data || [],
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

function employeeSelectOptions(employees) {
  return employees.map((employee) => ({
    value: employee.id,
    label: employee.identity.full_name,
    description: employee.employment.job_level,
    searchText: `${employee.identity.full_name} ${employee.employment.job_level}`,
  }));
}

// Surfaces each teacher's current active caseload as a badge so assignments
// can be spread out instead of piling onto whoever's first in the list.
function specialEducationTeacherOptions(employees) {
  return employees.map((employee) => {
    const count = employee.active_student_count || 0;
    return {
      value: employee.id,
      label: employee.identity.full_name,
      description: employee.identity.email,
      badge: `${count} student${count === 1 ? "" : "s"}`,
      tone: count > 0 ? "amber" : "green",
      searchText: employee.identity.full_name,
    };
  });
}

function studentSelectOptions(students) {
  return students.map((student) => ({
    value: student.id,
    label: student.identity.full_name,
    description: [
      student.academic.nis ? `NIS ${student.academic.nis}` : null,
      student.academic.current_grade
        ? `Grade ${student.academic.current_grade}`
        : null,
    ]
      .filter(Boolean)
      .join(" / "),
    badge: formatStatus(student.status),
    tone: statusTone(student.status),
    searchText: `${student.identity.full_name} ${student.academic.nis || ""} ${student.academic.current_grade || ""} ${student.status}`,
  }));
}

function dedupeStudents(students) {
  const byId = new Map()
  students.forEach((student) => {
    byId.set(student.id, student)
  })
  return Array.from(byId.values()).sort((left, right) =>
    left.identity.full_name.localeCompare(right.identity.full_name),
  )
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

// Mirrors assertDateWithinAcademicYear in enrollment-service.ts - years
// without dates set yet (nullable) skip the check server-side too.
function academicYearRangeHint(academicYear) {
  if (!academicYear?.start_date || !academicYear?.end_date) return undefined;
  return `Must fall within ${academicYear.name}: ${formatDate(academicYear.start_date)} - ${formatDate(academicYear.end_date)}`;
}

function getEnrollmentDialogTitle(mode) {
  switch (mode) {
    case "create":
      return "New Enrollment";
    case "transfer":
      return "Transfer Class";
    case "promote":
      return "Promote Student";
    case "bulk-promote":
      return "Promote Selected Students";
    case "close":
      return "Close Enrollment";
    default:
      return "Enrollment";
  }
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
