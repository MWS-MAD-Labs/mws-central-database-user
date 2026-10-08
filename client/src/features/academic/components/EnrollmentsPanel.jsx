import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  GraduationCap,
  Plus,
  Repeat,
  LogOut,
  RotateCcw,
  Trash2,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { StartDateDialog } from "./pc-activity-room/AssignmentDialogs.jsx";
import {
  ActionsMenu,
  ActionsMenuItem,
} from "../../../components/ui/ActionsMenu.jsx";
import { BulkActionBar } from "../../../components/ui/BulkActionBar.jsx";
import { BulkResultDialog } from "../../../components/ui/BulkResultDialog.jsx";
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
import { workforceTargetPayload } from "../utils/selectOptions.js";
import {
  academicYearSelectOptions,
  classSelectOptions,
  gradeSelectOptions,
} from "../utils/selectOptions.js";
import { EnrollmentDialog } from "./EnrollmentDialog.jsx";
import { FixPlaceholderClassDialog } from "./FixPlaceholderClassDialog.jsx";
import { SelectFilter } from "./SelectFilter.jsx";

const UNKNOWN_LEGACY_CLASS_PREFIX = "Unknown (Legacy Import)";

export function EnrollmentsPanel() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    student_id: "",
    class_id: "",
    grade_id: "",
    academic_year_id: "",
    status: "",
    is_deleted: "",
    sort_by: "created_at",
    sort_order: "desc",
  });
  const [dialog, setDialog] = useState(null);
  const [enrollFailureResult, setEnrollFailureResult] = useState(null);
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
      const targetStudentIds = studentIds?.length ? studentIds : [studentId];
      const result = await enrollmentsApi.bulkCreate({
        student_ids: targetStudentIds,
        ...payload,
      });

      const supportTarget = workforceTargetPayload(specialEducationEmployeeId);
      if (supportTarget) {
        const successfulStudentIds = result.items
          .filter((item) => item.status === "SUCCESS")
          .map((item) => item.id);

        await Promise.allSettled(
          successfulStudentIds.map((id) =>
            studentSensitiveApi.createSupportAssignment(id, {
              ...supportTarget,
              role: "SPECIAL_ED",
            }),
          ),
        );
      }

      return result;
    },
    onSuccess: (data, { studentId, studentIds, students }) => {
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
          setEnrollFailureResult({
            result: data,
            studentNameById: new Map(
              (students || []).map((student) => [
                student.id,
                student.full_name,
              ]),
            ),
          });
        }
      }
      setDialog(null);
    },
    onError: (error) => showErrorToast(error, "Enrollment failed."),
  });

  const transferMutation = useMutation({
    meta: { successMessage: "Student moved." },
    mutationFn: ({ enrollment, payload }) =>
      enrollmentsApi.transfer(enrollment.student.id, enrollment.id, payload),
    onSuccess: () => {
      invalidateEnrollmentData(queryClient);
      setDialog(null);
    },
  });

  const fixClassMutation = useMutation({
    mutationFn: ({ enrollment, payload }) =>
      enrollmentsApi.fixClass(enrollment.student.id, enrollment.id, payload),
    onSuccess: () => {
      invalidateEnrollmentData(queryClient);
      showSuccessToast("Placeholder class fixed.");
      setDialog(null);
    },
    onError: (error) => showErrorToast(error, "Couldn't fix the class."),
  });

  const promoteMutation = useMutation({
    meta: { successMessage: "Student promoted." },
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

  const [startDateRecords, setStartDateRecords] = useState(null);
  const bulkStartDateMutation = useMutation({
    mutationFn: ({ enrollments: selectedEnrollments, startDate }) =>
      enrollmentsApi.bulkUpdateStartDate({
        enrollment_ids: selectedEnrollments.map((enrollment) => enrollment.id),
        start_date: startDate,
      }),
    onSuccess: (result) => {
      invalidateEnrollmentData(queryClient);
      setSelectedEnrollmentIds(new Set());
      setStartDateRecords(null);
      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} start date(s) updated.`);
      }
      if (result.failed_count > 0) {
        showBulkFailureToast("start date(s) failed to update", result);
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
    meta: { successMessage: "Enrollment closed." },
    mutationFn: ({ enrollment, payload }) =>
      enrollmentsApi.close(enrollment.student.id, enrollment.id, payload),
    onSuccess: () => {
      invalidateEnrollmentData(queryClient);
      setDialog(null);
    },
  });

  const deleteMutation = useMutation({
    meta: { successMessage: "Enrollment deleted." },
    mutationFn: (enrollment) =>
      enrollmentsApi.remove(enrollment.student.id, enrollment.id),
    onSuccess: () => invalidateEnrollmentData(queryClient),
  });

  const restoreMutation = useMutation({
    meta: { successMessage: "Enrollment restored." },
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
              { value: "", label: "All Years" },
              ...academicYearSelectOptions(
                optionsQuery.data?.academicYears || [],
              ),
            ]}
            placeholder="All Years"
          />
          <SelectFilter
            value={params.class_id}
            onChange={(value) => resetPageAndUpdate({ class_id: value })}
            options={[
              { value: "", label: "All Classes" },
              ...classSelectOptions(optionsQuery.data?.classes || []),
            ]}
            placeholder="All Classes"
          />
          <SelectFilter
            value={params.grade_id}
            onChange={(value) => resetPageAndUpdate({ grade_id: value })}
            options={[
              { value: "", label: "All Grades" },
              ...gradeSelectOptions(optionsQuery.data?.grades || []),
            ]}
            placeholder="All Grades"
          />
          <SelectFilter
            value={params.status}
            onChange={(value) => resetPageAndUpdate({ status: value })}
            options={[
              { value: "", label: "All Statuses" },
              ...enrollmentStatuses.map((status) => ({
                value: status,
                label: formatStatus(status),
              })),
            ]}
            placeholder="All Statuses"
          />
          <SelectFilter
            value={params.is_deleted}
            onChange={(value) => resetPageAndUpdate({ is_deleted: value })}
            options={[
              { value: "", label: "Active Records" },
              { value: "true", label: "Trash Bin" },
            ]}
            placeholder="Active Records"
          />
        </>
      }
      error={
        enrollmentsQuery.error ||
        optionsQuery.error ||
        createMutation.error ||
        transferMutation.error ||
        fixClassMutation.error ||
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
          onClick={() => setStartDateRecords(selectedEnrollments)}
        >
          <CalendarDays size={15} />
          Edit date
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
        <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
          <tr>
            <th className="w-12 px-4 py-3">
              <input
                type="checkbox"
                aria-label="Select All Active Enrollments On This Page"
                checked={allPageSelected}
                disabled={selectableEnrollments.length === 0}
                onChange={(event) => toggleCurrentPage(event.target.checked)}
                className="h-4 w-4 accent-(--mws-burgundy)"
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
                    className="border-t border-(--mws-line) bg-white hover:bg-(--mws-soft)"
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
                        className="h-4 w-4 accent-(--mws-burgundy) disabled:opacity-40"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-(--mws-charcoal)">
                        {enrollment.student.full_name}
                      </p>
                      <p className="text-xs text-(--mws-muted)">
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
                          tone={enrollmentStatusTone(
                            enrollment.enrollment_status,
                          )}
                        >
                          {formatStatus(enrollment.enrollment_status)}
                        </StatusBadge>
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
                        restoringId={restoreMutation.isPending ? restoreMutation.variables?.id : undefined}
                        onTransfer={() =>
                          setDialog({ mode: "transfer", record: enrollment })
                        }
                        onFixClass={() =>
                          setDialog({ mode: "fix-class", record: enrollment })
                        }
                        onEditDate={() => setStartDateRecords([enrollment])}
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

      {dialog?.mode === "fix-class" ? (
        <FixPlaceholderClassDialog
          enrollment={dialog.record}
          isSubmitting={fixClassMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(payload) =>
            fixClassMutation.mutate({ enrollment: dialog.record, payload })
          }
        />
      ) : dialog ? (
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

      {startDateRecords ? (
        <StartDateDialog
          {...startDateBounds(
            startDateRecords,
            optionsQuery.data?.academicYears,
          )}
          title="Edit Enrollment Date"
          noun="enrollment"
          count={startDateRecords.length}
          initialDate={startDateRecords[0]?.start_date}
          isSubmitting={bulkStartDateMutation.isPending}
          onClose={() => setStartDateRecords(null)}
          onSubmit={(startDate) =>
            bulkStartDateMutation.mutate({
              enrollments: startDateRecords,
              startDate,
            })
          }
        />
      ) : null}

      <BulkResultDialog
        title="Enrollment Failures"
        result={enrollFailureResult?.result}
        getLabel={(id) => enrollFailureResult?.studentNameById.get(id)}
        getDetailHref={(id) => `/students/${id}`}
        onClose={() => setEnrollFailureResult(null)}
      />
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
  onFixClass,
  onPromote,
  onClose,
  onEditDate,
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
  const isPlaceholder = enrollment.class.name.startsWith(
    UNKNOWN_LEGACY_CLASS_PREFIX,
  );

  if (isPlaceholder) {
    return (
      <div className="flex flex-wrap justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canWrite}
          onClick={onFixClass}
        >
          <Wrench size={15} />
          Fix Class
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

  return (
    <div className="flex justify-end">
      <ActionsMenu label={`Actions for ${enrollment.student.full_name}`}>
        {(closeMenu) => (
          <>
            {canWrite && isActive ? (
              <>
                <ActionsMenuItem
                  onClick={() => {
                    closeMenu();
                    onEditDate();
                  }}
                >
                  Edit date
                </ActionsMenuItem>
                <ActionsMenuItem
                  onClick={() => {
                    closeMenu();
                    onTransfer();
                  }}
                >
                  Move
                </ActionsMenuItem>
                <ActionsMenuItem
                  onClick={() => {
                    closeMenu();
                    onPromote();
                  }}
                >
                  Promote
                </ActionsMenuItem>
                <ActionsMenuItem
                  onClick={() => {
                    closeMenu();
                    onClose();
                  }}
                >
                  Close
                </ActionsMenuItem>
              </>
            ) : null}
            <ActionsMenuItem
              tone="danger"
              disabled={!canDelete}
              onClick={() => {
                closeMenu();
                onDelete();
              }}
            >
              Delete
            </ActionsMenuItem>
          </>
        )}
      </ActionsMenu>
    </div>
  );
}

// Limits the date picker to the academic year when every record shares one.
function startDateBounds(records, academicYears = []) {
  const yearId = records[0]?.academic_year?.id;
  if (
    !yearId ||
    records.some((record) => record.academic_year?.id !== yearId)
  ) {
    return {};
  }
  const year = academicYears.find((item) => item.id === yearId);
  return {
    min: year?.start_date
      ? new Date(year.start_date).toISOString().slice(0, 10)
      : undefined,
    max: year?.end_date
      ? new Date(year.end_date).toISOString().slice(0, 10)
      : undefined,
  };
}

function useEnrollmentOptionsQuery() {
  return useQuery({
    queryKey: ["enrollment-form-options"],
    queryFn: async () => {
      const [classes, grades, academicYears] = await Promise.all([
        classesApi.list({ page: 1, size: 100 }),
        gradesApi.list({ page: 1, size: 100 }),
        academicYearsApi.list({
          page: 1,
          size: 100,
          sort_by: "start_date",
          sort_order: "desc",
        }),
      ]);
      const unitIdByGradeId = new Map(
        (grades.data || []).map((grade) => [grade.id, grade.unit_id]),
      );

      return {
        classes: classes.data || [],
        grades: grades.data || [],
        unitIdByGradeId,
        academicYears: academicYears.data || [],
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
