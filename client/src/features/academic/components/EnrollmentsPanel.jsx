import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Plus, Repeat, LogOut, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { BulkActionBar } from "../../../components/ui/BulkActionBar.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { formatDate, formatStatus, statusTone } from "../../../lib/format.js";
import {
  showBulkFailureToast,
  showErrorToast,
  showSuccessToast,
} from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { employeesApi } from "../../employees/api/employeesApi.js";
import { HeaderCell } from "../../master-data/components/HeaderCell.jsx";
import { LoadingRows } from "../../master-data/components/LoadingRows.jsx";
import { PanelFrame } from "../../master-data/components/PanelFrame.jsx";
import { defaultPaging } from "../../master-data/utils/params.js";
import { studentSensitiveApi } from "../../students/api/studentSensitiveApi.js";
import {
  academicYearsApi,
  classesApi,
  enrollmentStatuses,
  enrollmentsApi,
  gradesApi,
} from "../api/academicApi.js";
import {
  academicYearSelectOptions,
  classSelectOptions,
} from "../utils/selectOptions.js";
import { EnrollmentDialog } from "./EnrollmentDialog.jsx";
import { SelectFilter } from "./SelectFilter.jsx";

export function EnrollmentsPanel() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const confirm = useConfirm();
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
          showBulkFailureToast("student(s) failed to enroll", data);
        }
      }
      setDialog(null);
    },
    onError: (error) => showErrorToast(error, "Enrollment failed."),
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
        showBulkFailureToast("enrollment(s) failed to promote", result);
      }
    },
  });

  const bulkTransferMutation = useMutation({
    mutationFn: ({ enrollments: selectedEnrollments, payload }) =>
      enrollmentsApi.bulkTransfer({
        enrollment_ids: selectedEnrollments.map((enrollment) => enrollment.id),
        ...payload,
      }),
    onSuccess: (result) => {
      invalidateEnrollmentData(queryClient);
      setSelectedEnrollmentIds(new Set());
      setDialog(null);
      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} enrollment(s) moved.`);
      }
      if (result.failed_count > 0) {
        showBulkFailureToast("enrollment(s) failed to move", result);
      }
    },
  });

  const bulkCloseMutation = useMutation({
    mutationFn: ({ enrollments: selectedEnrollments, payload }) =>
      enrollmentsApi.bulkClose({
        enrollment_ids: selectedEnrollments.map((enrollment) => enrollment.id),
        ...payload,
      }),
    onSuccess: (result) => {
      invalidateEnrollmentData(queryClient);
      setSelectedEnrollmentIds(new Set());
      setDialog(null);
      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} enrollment(s) closed.`);
      }
      if (result.failed_count > 0) {
        showBulkFailureToast("enrollment(s) failed to close", result);
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

  async function handleDelete(enrollment) {
    if (
      await confirm({
        title: "Move to trash",
        description: `Move ${enrollment.student.full_name}'s enrollment to trash?`,
        confirmLabel: "Move to trash",
        tone: "danger",
      })
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
            options={[
              { value: "", label: "All statuses" },
              ...enrollmentStatuses.map((status) => ({
                value: status,
                label: formatStatus(status),
              })),
            ]}
            placeholder="All statuses"
          />
          <SelectFilter
            value={params.is_deleted}
            onChange={(value) => resetPageAndUpdate({ is_deleted: value })}
            options={[
              { value: "", label: "Active records" },
              { value: "true", label: "Trash bin" },
            ]}
            placeholder="Active records"
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
        bulkTransferMutation.error ||
        bulkCloseMutation.error ||
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
          Promote
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!canWrite || selectedEnrollments.length === 0}
          onClick={() =>
            setDialog({ mode: "bulk-transfer", records: selectedEnrollments })
          }
        >
          <Repeat size={15} />
          Move
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!canWrite || selectedEnrollments.length === 0}
          onClick={() =>
            setDialog({ mode: "bulk-close", records: selectedEnrollments })
          }
        >
          <LogOut size={15} />
          Close
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
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge
                          tone={enrollmentStatusTone(enrollment.enrollment_status)}
                        >
                          {formatStatus(enrollment.enrollment_status)}
                        </StatusBadge>
                        {/* Enrollment status stays Active even while the
                            student themselves is Inactive (a pause, not a
                            withdrawal) - flag that split instead of just
                            showing "Active" and implying the student is too. */}
                        {enrollment.enrollment_status === "ACTIVE" &&
                        enrollment.student.status === "INACTIVE" ? (
                          <StatusBadge tone="amber">
                            Student inactive
                          </StatusBadge>
                        ) : null}
                      </div>
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
            bulkPromoteMutation.isPending ||
            bulkTransferMutation.isPending ||
            bulkCloseMutation.isPending ||
            closeMutation.isPending
          }
          onClose={() => setDialog(null)}
          onSubmit={(payload, includedRecords) => {
            // includedRecords reflects the dialog's own Exclude toggles, not
            // necessarily every record in dialog.records - always use what
            // the dialog actually confirmed.
            const enrollments = includedRecords ?? dialog.records;
            if (dialog.mode === "create") createMutation.mutate(payload);
            if (dialog.mode === "transfer") {
              transferMutation.mutate({ enrollment: dialog.record, payload });
            }
            if (dialog.mode === "promote") {
              promoteMutation.mutate({ enrollment: dialog.record, payload });
            }
            if (dialog.mode === "bulk-promote") {
              bulkPromoteMutation.mutate({ enrollments, payload });
            }
            if (dialog.mode === "bulk-transfer") {
              bulkTransferMutation.mutate({ enrollments, payload });
            }
            if (dialog.mode === "bulk-close") {
              bulkCloseMutation.mutate({ enrollments, payload });
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
        Move
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
      const [classes, grades, academicYears, employees, caseload] =
        await Promise.all([
          // No status filter - EnrollmentDialog's own picker excludes only
          // INACTIVE classes, since ACTIVE and UPCOMING are both valid
          // enroll/promote/transfer targets (UPCOMING classes are next
          // year's, prepared ahead of time).
          classesApi.list({ page: 1, size: 100 }),
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
        grades: grades.data || [],
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

function invalidateEnrollmentData(queryClient) {
  queryClient.invalidateQueries({ queryKey: ["enrollments"] });
  queryClient.invalidateQueries({ queryKey: ["students"] });
  queryClient.invalidateQueries({ queryKey: ["enrollment-form-options"] });
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
