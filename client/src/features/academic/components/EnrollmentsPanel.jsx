import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { BulkActionBar } from "../../../components/ui/BulkActionBar.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  CheckboxField,
  Field,
  SearchableSelect,
  SelectInput,
  TextAreaInput,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import {
  cleanPayload,
  dateInputFromIso,
  isoFromDateInput,
  trimmedOrUndefined,
} from "../../../lib/form.js";
import { formatDate, formatStatus, statusTone } from "../../../lib/format.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { employeesApi } from "../../employees/api/employeesApi.js";
import { HeaderCell } from "../../master-data/components/HeaderCell.jsx";
import { LoadingRows } from "../../master-data/components/LoadingRows.jsx";
import { PanelFrame } from "../../master-data/components/PanelFrame.jsx";
import { defaultPaging } from "../../master-data/utils/params.js";
import { studentSensitiveApi } from "../../students/api/studentSensitiveApi.js";
import { studentsApi } from "../../students/api/studentsApi.js";
import {
  academicYearsApi,
  classesApi,
  enrollmentCloseStatuses,
  enrollmentStatuses,
  enrollmentsApi,
} from "../api/academicApi.js";
import {
  academicYearSelectOptions,
  classSelectOptions,
  dedupeStudents,
  specialEducationTeacherOptions,
  studentSelectOptions,
} from "../utils/selectOptions.js";
import { SelectFilter } from "./SelectFilter.jsx";

export function EnrollmentsPanel() {
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

function invalidateEnrollmentData(queryClient) {
  queryClient.invalidateQueries({ queryKey: ["enrollments"] });
  queryClient.invalidateQueries({ queryKey: ["students"] });
  queryClient.invalidateQueries({ queryKey: ["enrollment-form-options"] });
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
    case "ACTIVE":
      return "green";
    case "COMPLETED":
      return "neutral";
    case "TRANSFERRED":
      return "amber";
    case "WITHDRAWN":
      return "red";
    default:
      return statusTone(status);
  }
}
