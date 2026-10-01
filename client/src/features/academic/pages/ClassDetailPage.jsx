import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Edit,
  GraduationCap,
  HeartHandshake,
  LogOut,
  Plus,
  Repeat,
  RotateCcw,
  Undo2,
  Users,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { cn } from "../../../lib/cn.js";
import { ActionsMenu, ActionsMenuItem } from "../../../components/ui/ActionsMenu.jsx";
import { BulkActionBar } from "../../../components/ui/BulkActionBar.jsx";
import { BulkResultDialog } from "../../../components/ui/BulkResultDialog.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { SortableHeader } from "../../../components/ui/SortableHeader.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { studentSensitiveApi } from "../../students/api/studentSensitiveApi.js";
import { SupportAssignmentDialog } from "../../students/components/StudentSensitivePanels.jsx";
import {
  academicYearsApi,
  classesApi,
  enrollmentsApi,
  gradesApi,
} from "../api/academicApi.js";
import { ClassDialog } from "../components/ClassDialog.jsx";
import { EnrollmentDialog } from "../components/EnrollmentDialog.jsx";
import { FixPlaceholderClassDialog } from "../components/FixPlaceholderClassDialog.jsx";
import { SelectFilter } from "../components/SelectFilter.jsx";
import { TeacherAssignmentsSection } from "../components/TeacherAssignmentsSection.jsx";
import {
  formatEnrollmentHistoryCounts,
  formatStatus,
  statusTone,
  sumEnrollmentHistoryCounts,
} from "../../../lib/format.js";
import {
  showBulkFailureToast,
  showErrorToast,
  showSuccessToast,
} from "../../../lib/toast.js";
import { workforceTargetPayload } from "../utils/selectOptions.js";
import {
  canManageEnrollments,
  canManageTeacherAssignments,
  canViewStudents,
  canViewWorkforce,
} from "../../../lib/capabilities.js";

const UNKNOWN_LEGACY_CLASS_PREFIX = "Unknown (Legacy Import)";
const STUDENT_PAGE_SIZE = 10;

export function ClassDetailPage() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const hasStudentAccess = canViewStudents(user);
  const hasWorkforceAccess = canViewWorkforce(user);
  const confirm = useConfirm();
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [enrollFailureResult, setEnrollFailureResult] = useState(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [bulkSeDialog, setBulkSeDialog] = useState(null);
  const [fixClassDialogOpen, setFixClassDialogOpen] = useState(false);
  const [studentSort, setStudentSort] = useState({
    sort_by: "name",
    sort_order: "asc",
  });
  const [studentGradeFilter, setStudentGradeFilter] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [studentPage, setStudentPage] = useState(1);
  const [studentPageSize, setStudentPageSize] = useState(STUDENT_PAGE_SIZE);

  const classQuery = useQuery({
    queryKey: ["classes", classId],
    queryFn: () => classesApi.get(classId),
    enabled: Boolean(classId),
  });

  const teachersQuery = useQuery({
    queryKey: ["classes", classId, "teacher-assignments"],
    queryFn: () => classesApi.teacherAssignments(classId),
    enabled: Boolean(classId) && hasWorkforceAccess,
  });

  const enrollmentsQuery = useQuery({
    queryKey: ["enrollments", { class_id: classId, studentPage, studentPageSize, studentSearch, studentSort, studentGradeFilter }],
    queryFn: () =>
      enrollmentsApi.list({
        class_id: classId,
        page: studentPage,
        size: studentPageSize,
        search: studentSearch || undefined,
        grade: studentGradeFilter || undefined,
        sort_by: studentSort.sort_by,
        sort_order: studentSort.sort_order,
      }),
    enabled: Boolean(classId) && hasStudentAccess,
  });

  const optionsQuery = useQuery({
    queryKey: ["class-detail-options"],
    queryFn: async () => {
       const [grades, classes, academicYears] =
          await Promise.all([
            gradesApi.list({ page: 1, size: 100 }),
            classesApi.list({ page: 1, size: 100 }),
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
         grades: grades.data || [],
         classes: classes.data || [],
        unitIdByGradeId,
        academicYears: academicYears.data || [],
       };
    },
  });

  const klass = classQuery.data;
  const teachers = teachersQuery.data || [];
  const students = enrollmentsQuery.data?.data || [];
  const studentPaging = enrollmentsQuery.data?.paging || {
    current_page: studentPage,
    total_page: 1,
    total_item: students.length,
    size: studentPageSize,
  };
  const pagedStudents = students;

  const classGrade = (optionsQuery.data?.grades || []).find(
    (grade) => grade.id === klass?.grade?.id,
  );
  const classUnitId = klass?.grade?.unit_id || classGrade?.unit_id || null;
  const isMixedClass = (klass?.additional_grades?.length || 0) > 0;
  const mixedClassGradeOptions = isMixedClass
    ? [klass.grade, ...(klass.additional_grades || [])].filter(Boolean)
    : [];

  const unitMatches =
    user?.role === "SUPER_ADMIN" || classUnitId === user?.unit_id;
  const canWrite = canManageEnrollments(user) && unitMatches;
  const canWriteTeacher = canManageTeacherAssignments(user) && unitMatches;
  const canEditClass =
    (user?.role === "SUPER_ADMIN" ||
      (user?.role === "DATABASE_ADMIN" &&
        Boolean(user?.can_write_student_data))) &&
    unitMatches;
  const classScopedOptions = optionsQuery.data;

  const moveTargetClassOptions = classGrade
    ? (optionsQuery.data?.classes || []).filter(
        (otherClass) =>
          optionsQuery.data?.unitIdByGradeId?.get(otherClass.grade.id) ===
          classGrade.unit_id,
      )
    : [];

  const assignTeacherMutation = useMutation({
    mutationFn: (payload) => classesApi.assignTeacher(classId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["classes", classId, "teacher-assignments"],
      });
      queryClient.invalidateQueries({ queryKey: ["classes", classId] });
    },
  });

  const bulkMoveTeacherAssignmentsMutation = useMutation({
    mutationFn: ({ assignmentIds, targetClassId }) =>
      classesApi.bulkMoveTeacherAssignments(classId, {
        assignment_ids: assignmentIds,
        target_class_id: targetClassId,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["classes", classId, "teacher-assignments"],
      });
      if (result.success_count > 0) {
        showSuccessToast(
          `${result.success_count} teacher assignment(s) moved.`,
        );
      }
      if (result.failed_count > 0) {
        showBulkFailureToast("assignment(s) failed to move", result);
      }
    },
    onError: (error) => showErrorToast(error, "Could not move assignments."),
  });

  const bulkEndTeacherAssignmentsMutation = useMutation({
    mutationFn: ({ assignmentIds, endDate }) =>
      classesApi.bulkEndTeacherAssignments(classId, {
        assignment_ids: assignmentIds,
        end_date: endDate,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["classes", classId, "teacher-assignments"],
      });
      if (result.success_count > 0) {
        showSuccessToast(
          `${result.success_count} teacher assignment(s) ended.`,
        );
      }
      if (result.failed_count > 0) {
        showBulkFailureToast("assignment(s) failed to end", result);
      }
    },
    onError: (error) => showErrorToast(error, "Could not end assignments."),
  });

  const bulkRemoveTeacherAssignmentsMutation = useMutation({
    mutationFn: (assignmentIds) =>
      classesApi.bulkRemoveTeacherAssignments(classId, {
        assignment_ids: assignmentIds,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["classes", classId, "teacher-assignments"],
      });
      if (result.success_count > 0) {
        showSuccessToast(
          `${result.success_count} teacher assignment(s) removed.`,
        );
      }
      if (result.failed_count > 0) {
        showBulkFailureToast("assignment(s) failed to remove", result);
      }
    },
    onError: (error) => showErrorToast(error, "Could not remove assignments."),
  });

  const bulkReopenTeacherAssignmentsMutation = useMutation({
    mutationFn: (assignmentIds) =>
      classesApi.bulkReopenTeacherAssignments(classId, {
        assignment_ids: assignmentIds,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["classes", classId, "teacher-assignments"],
      });
      if (result.success_count > 0) {
        showSuccessToast(
          `${result.success_count} teacher assignment(s) reopened.`,
        );
      }
      if (result.failed_count > 0) {
        showBulkFailureToast("assignment(s) failed to reopen", result);
      }
    },
    onError: (error) => showErrorToast(error, "Could not reopen assignments."),
  });

  const updateTeacherStartDateMutation = useMutation({
    mutationFn: ({ assignmentId, startDate }) =>
      classesApi.updateTeacherAssignmentStartDate(classId, assignmentId, startDate),
    onSuccess: () => queryClient.invalidateQueries({
      queryKey: ["classes", classId, "teacher-assignments"],
    }),
    onError: (error) => showErrorToast(error, "Could not update start date."),
  });

  const bulkUpdateTeacherStartDateMutation = useMutation({
    mutationFn: ({ assignmentIds, startDate }) =>
      classesApi.bulkUpdateTeacherAssignmentStartDate(classId, {
        assignment_ids: assignmentIds,
        start_date: startDate,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["classes", classId, "teacher-assignments"],
      });
      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} start date(s) updated.`);
      }
      if (result.failed_count > 0) {
        showBulkFailureToast("start date(s) failed to update", result);
      }
    },
    onError: (error) => showErrorToast(error, "Could not update start dates."),
  });

  const endTeacherAssignmentMutation = useMutation({
    mutationFn: (assignment) =>
      classesApi.endTeacherAssignment(classId, assignment.id),
    onSuccess: () => queryClient.invalidateQueries({
      queryKey: ["classes", classId, "teacher-assignments"],
    }),
  });

  const removeTeacherAssignmentMutation = useMutation({
    mutationFn: (assignment) =>
      classesApi.removeTeacherAssignment(classId, assignment.id),
    onSuccess: () => queryClient.invalidateQueries({
      queryKey: ["classes", classId, "teacher-assignments"],
    }),
  });

  const reopenTeacherAssignmentMutation = useMutation({
    mutationFn: (assignment) =>
      classesApi.reopenTeacherAssignment(classId, assignment.id),
    onSuccess: () => queryClient.invalidateQueries({
      queryKey: ["classes", classId, "teacher-assignments"],
    }),
  });

  const updateMutation = useMutation({
    mutationFn: (payload) => classesApi.update(classId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classes", classId] });
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      queryClient.invalidateQueries({ queryKey: ["class-detail-options"] });
      setEditDialogOpen(false);
    },
  });

  const createEnrollMutation = useMutation({
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
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["enrollments", { class_id: classId }],
      });
      queryClient.invalidateQueries({ queryKey: ["classes", classId] });
      queryClient.invalidateQueries({
        queryKey: ["support-assignments", "active-student-ids"],
      });
      queryClient.invalidateQueries({ queryKey: ["students"] });
      if (data?.success_count !== undefined) {
        if (data.success_count > 0) {
          showSuccessToast(`${data.success_count} student(s) enrolled.`);
        }
        if (data.failed_count > 0) {
          setEnrollFailureResult({
            result: data,
            studentNameById: new Map(
              (variables?.students || []).map((student) => [
                student.id,
                student.full_name,
              ]),
            ),
          });
        }
      }
      setEnrollDialogOpen(false);
    },
    onError: (error) => showErrorToast(error, "Enrollment failed."),
  });

  const [selectedEnrollmentIds, setSelectedEnrollmentIds] = useState(
    () => new Set(),
  );
  const [bulkDialog, setBulkDialog] = useState(null);

  function invalidateEnrollmentData() {
    queryClient.invalidateQueries({
      queryKey: ["enrollments", { class_id: classId }],
    });
    queryClient.invalidateQueries({ queryKey: ["classes", classId] });
    queryClient.invalidateQueries({
      queryKey: ["support-assignments", "active-student-ids"],
    });
    queryClient.invalidateQueries({ queryKey: ["students"] });
  }

  const bulkPromoteMutation = useMutation({
    mutationFn: ({ enrollments, payload }) =>
      enrollmentsApi.bulkPromote({
        enrollment_ids: enrollments.map((enrollment) => enrollment.id),
        ...payload,
      }),
    onSuccess: (result, { payload }) => {
      invalidateEnrollmentData();
      setSelectedEnrollmentIds(new Set());
      setBulkDialog(null);
      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} student(s) promoted.`);
        if (payload?.class_id) {
          navigate(`/academic/classes/${payload.class_id}`);
        }
      }
      if (result.failed_count > 0) {
        showBulkFailureToast("student(s) failed to promote", result);
      }
    },
  });

  const bulkTransferMutation = useMutation({
    mutationFn: ({ enrollments, payload }) =>
      enrollmentsApi.bulkTransfer({
        enrollment_ids: enrollments.map((enrollment) => enrollment.id),
        ...payload,
      }),
    onSuccess: (result) => {
      invalidateEnrollmentData();
      setSelectedEnrollmentIds(new Set());
      setBulkDialog(null);
      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} student(s) moved.`);
      }
      if (result.failed_count > 0) {
        showBulkFailureToast("student(s) failed to move", result);
      }
    },
  });

  const fixClassMutation = useMutation({
    mutationFn: ({ enrollment, payload }) =>
      enrollmentsApi.fixClass(enrollment.student.id, enrollment.id, payload),
    onSuccess: () => {
      invalidateEnrollmentData();
      setSelectedEnrollmentIds(new Set());
      setFixClassDialogOpen(false);
      showSuccessToast("Placeholder class fixed.");
    },
    onError: (error) => showErrorToast(error, "Couldn't fix the class."),
  });

  const bulkCloseMutation = useMutation({
    mutationFn: ({ enrollments, payload }) =>
      enrollmentsApi.bulkClose({
        enrollment_ids: enrollments.map((enrollment) => enrollment.id),
        ...payload,
      }),
    onSuccess: (result) => {
      invalidateEnrollmentData();
      setSelectedEnrollmentIds(new Set());
      setBulkDialog(null);
      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} enrollment(s) closed.`);
      }
      if (result.failed_count > 0) {
        showBulkFailureToast("enrollment(s) failed to close", result);
      }
    },
  });

  const bulkReactivateMutation = useMutation({
    mutationFn: (enrollments) =>
      enrollmentsApi.bulkReactivate({
        enrollment_ids: enrollments.map((enrollment) => enrollment.id),
      }),
    onSuccess: (result) => {
      invalidateEnrollmentData();
      setSelectedEnrollmentIds(new Set());
      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} enrollment(s) reactivated.`);
      }
      if (result.failed_count > 0) {
        showBulkFailureToast("reactivation(s) failed", result);
      }
    },
  });

  const bulkDropMutation = useMutation({
    mutationFn: (enrollments) =>
      enrollmentsApi.bulkRemove({
        enrollment_ids: enrollments.map((enrollment) => enrollment.id),
      }),
    onSuccess: (result) => {
      invalidateEnrollmentData();
      setSelectedEnrollmentIds(new Set());
      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} student(s) dropped.`);
      }
      if (result.failed_count > 0) {
        showBulkFailureToast("drop(s) failed", result);
      }
    },
  });

  async function getActiveAssignmentId(studentId) {
    const assignments = await studentSensitiveApi.listSupportAssignments(studentId);
    return assignments.find((a) => !a.end_date)?.id;
  }

  const bulkCreateSupportAssignmentMutation = useMutation({
    mutationFn: async ({ mode, studentIds, payload }) => {
      const targetStudentIds =
        mode === "change"
          ? studentIds.filter((studentId) => activeSupportByStudentId.has(studentId))
          : studentIds.filter((studentId) => !activeSupportByStudentId.has(studentId));
      const skippedCount = studentIds.length - targetStudentIds.length;

      const results = await Promise.allSettled(
        targetStudentIds.map(async (studentId) => {
          if (mode === "change") {
            const activeAssignmentId = await getActiveAssignmentId(studentId);
            if (activeAssignmentId) {
              await studentSensitiveApi.endSupportAssignment(studentId, activeAssignmentId);
            }
          }
          return studentSensitiveApi.createSupportAssignment(studentId, payload);
        }),
      );
      return {
        successCount: results.filter((r) => r.status === "fulfilled").length,
        failedCount: results.filter((r) => r.status === "rejected").length,
        skippedCount,
        failureReasons: results
          .filter((r) => r.status === "rejected")
          .map((r) => r.reason?.message)
          .filter(Boolean),
      };
    },
    onSuccess: ({ successCount, failedCount, skippedCount, failureReasons }) => {
      queryClient.invalidateQueries({
        queryKey: ["support-assignments", "active-student-ids"],
      });
      setBulkSeDialog(null);
      setSelectedEnrollmentIds(new Set());
      if (successCount > 0) {
        showSuccessToast(`SE teacher assigned to ${successCount} student(s).`);
      }
      if (skippedCount > 0) {
        showErrorToast(
          `${skippedCount} student(s) were skipped (already had, or didn't have, an SE teacher, depending on the action).`,
        );
      }
      if (failedCount > 0) {
        showErrorToast(
          failureReasons.length > 0
            ? `${failedCount} assignment(s) failed: ${failureReasons.join("; ")}`
            : `${failedCount} assignment(s) failed.`,
        );
      }
    },
  });

  const bulkRemoveSupportAssignmentMutation = useMutation({
    mutationFn: async (studentIds) => {
      const results = await Promise.allSettled(
        studentIds.map(async (studentId) => {
          const activeAssignmentId = await getActiveAssignmentId(studentId);
          if (!activeAssignmentId) throw new Error("No active SE assignment");
          return studentSensitiveApi.endSupportAssignment(studentId, activeAssignmentId);
        }),
      );
      return {
        successCount: results.filter((r) => r.status === "fulfilled").length,
        failedCount: results.filter((r) => r.status === "rejected").length,
      };
    },
    onSuccess: ({ successCount, failedCount }) => {
      queryClient.invalidateQueries({
        queryKey: ["support-assignments", "active-student-ids"],
      });
      setSelectedEnrollmentIds(new Set());
      if (successCount > 0) {
        showSuccessToast(`SE teacher removed from ${successCount} student(s).`);
      }
      if (failedCount > 0) {
        showErrorToast(`${failedCount} removal(s) failed.`);
      }
    },
  });

  async function handleBulkRemoveSe(studentIds) {
    if (
      await confirm({
        title: "Remove SE teacher",
        description: `End the active Special Education Teacher assignment for ${studentIds.length} student(s)?`,
        confirmLabel: "Remove",
        tone: "danger",
      })
    ) {
      bulkRemoveSupportAssignmentMutation.mutate(studentIds);
    }
  }

  const selectableEnrollments = students;
  const selectedEnrollments = selectableEnrollments.filter((enrollment) =>
    selectedEnrollmentIds.has(enrollment.id),
  );
  const selectedAreAllActive =
    selectedEnrollments.length > 0 &&
    selectedEnrollments.every((e) => e.enrollment_status === "ACTIVE");
  const selectedAreAllInactive =
    selectedEnrollments.length > 0 &&
    selectedEnrollments.every((e) => e.enrollment_status !== "ACTIVE");
  const isClassPlaceholder = Boolean(
    klass?.name?.startsWith(UNKNOWN_LEGACY_CLASS_PREFIX),
  );
  const allSelected =
    selectableEnrollments.length > 0 &&
    selectedEnrollments.length === selectableEnrollments.length;

  function toggleAll(checked) {
    setSelectedEnrollmentIds(
      checked ? new Set(selectableEnrollments.map((e) => e.id)) : new Set(),
    );
  }

  function toggleOne(enrollmentId, checked) {
    setSelectedEnrollmentIds((current) => {
      const next = new Set(current);
      if (checked) next.add(enrollmentId);
      else next.delete(enrollmentId);
      return next;
    });
  }

  const studentIds = students.map((enrollment) => enrollment.student.id);
  const activeStudentIds = students
    .filter((enrollment) => enrollment.enrollment_status === "ACTIVE")
    .map((enrollment) => enrollment.student.id);

  const activeSupportQuery = useQuery({
    queryKey: ["support-assignments", "active-student-ids", studentIds],
    queryFn: () => studentSensitiveApi.getActiveSupportStudentIds(studentIds),
    enabled: hasStudentAccess && hasWorkforceAccess && studentIds.length > 0,
  });
  const activeSupportByStudentId = new Map(
    (activeSupportQuery.data || []).map((entry) => [
      entry.student_id,
      entry.workforce_member,
    ]),
  );
  const selectedNoneHaveSeTeacher =
    selectedEnrollments.length > 0 &&
    selectedEnrollments.every((e) => !activeSupportByStudentId.has(e.student.id));
  const selectedAllHaveSeTeacher =
    selectedEnrollments.length > 0 &&
    selectedEnrollments.every((e) => activeSupportByStudentId.has(e.student.id));
  const currentSeTeacherIdsForSelection = new Set(
    selectedEnrollments
      .map((e) => activeSupportByStudentId.get(e.student.id)?.id)
      .filter(Boolean),
  );

  return (
    <div className="relative min-w-0">
      <PageHeader
        title={klass?.name || "Class Detail"}
        description={
          klass
            ? `${[klass.grade.name, ...(klass.additional_grades || []).map((grade) => grade.name)].join(" + ")} / ${klass.academic_year.name}`
            : "Class roster: students and teachers."
        }
        actions={
          <>
            {canEditClass && klass ? (
              <Button
                type="button"
                variant="secondary"
                disabled={optionsQuery.isLoading}
                onClick={() => setEditDialogOpen(true)}
              >
                <Edit size={16} />
                Edit class
              </Button>
            ) : null}
            <Button asChild variant="secondary">
              <Link to="/academic?tab=classes">
                <ArrowLeft size={16} />
                Back
              </Link>
            </Button>
          </>
        }
      />

      {klass ? (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <StatusBadge tone={statusTone(klass.status)}>
            {formatStatus(klass.status)}
          </StatusBadge>
          <span className="text-sm text-(--mws-muted)">
            {klass.active_enrollment_count} active student
            {klass.active_enrollment_count === 1 ? "" : "s"}
            {klass.capacity ? ` / ${klass.capacity} capacity` : ""}
            {formatEnrollmentHistoryCounts(klass.enrollment_history_counts) ? (
              <span
                className="ml-1 cursor-pointer underline decoration-dotted underline-offset-2"
                title={formatEnrollmentHistoryCounts(
                  klass.enrollment_history_counts,
                )}
              >
                (+{sumEnrollmentHistoryCounts(klass.enrollment_history_counts)})
              </span>
            ) : null}
          </span>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-(--mws-line) bg-white p-5">
          {hasWorkforceAccess ? <TeacherAssignmentsSection
            assignments={teachers}
            isLoading={teachersQuery.isLoading}
            error={teachersQuery.error}
            unitWarning={
              klass && !classQuery.isLoading && !classUnitId
                ? `This class's grade ("${klass?.grade?.name ?? "unknown"}") has no unit configured, so every teacher is shown here. Assigning one will still be rejected until the grade's unit is set.`
                : null
            }
            canWrite={canWriteTeacher}
            isAssigning={assignTeacherMutation.isPending}
            onAssign={(payload) => assignTeacherMutation.mutate(payload)}
            currentClassId={classId}
            academicYearStartDate={klass?.academic_year?.start_date}
            moveTargetClassOptions={moveTargetClassOptions}
            academicYears={optionsQuery.data?.academicYears || []}
            isBulkMoving={bulkMoveTeacherAssignmentsMutation.isPending}
            onBulkMove={(assignmentIds, targetClassId) =>
              bulkMoveTeacherAssignmentsMutation.mutate({
                assignmentIds,
                targetClassId,
              })
            }
            isBulkEnding={bulkEndTeacherAssignmentsMutation.isPending}
            onBulkEnd={(assignmentIds, endDate) =>
              bulkEndTeacherAssignmentsMutation.mutate({
                assignmentIds,
                endDate,
              })
            }
            isBulkRemoving={bulkRemoveTeacherAssignmentsMutation.isPending}
            onBulkRemove={(assignmentIds) =>
              bulkRemoveTeacherAssignmentsMutation.mutate(assignmentIds)
            }
            isBulkReopening={bulkReopenTeacherAssignmentsMutation.isPending}
            onBulkReopen={(assignmentIds) =>
              bulkReopenTeacherAssignmentsMutation.mutate(assignmentIds)
            }
            isUpdatingStartDate={updateTeacherStartDateMutation.isPending}
            onUpdateStartDate={(assignmentId, startDate) =>
              updateTeacherStartDateMutation.mutate({ assignmentId, startDate })
            }
            isBulkUpdatingStartDate={bulkUpdateTeacherStartDateMutation.isPending}
            onBulkUpdateStartDate={(assignmentIds, startDate) =>
              bulkUpdateTeacherStartDateMutation.mutate({ assignmentIds, startDate })
            }
            onEnd={(assignment) => endTeacherAssignmentMutation.mutate(assignment)}
            onRemove={(assignment) => removeTeacherAssignmentMutation.mutate(assignment)}
            onReopen={(assignment) => reopenTeacherAssignmentMutation.mutate(assignment)}
          /> : (
            <>
              <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-(--mws-charcoal)">
                <GraduationCap size={18} /> Teachers
              </h2>
              <PanelMessage>
                Teacher identities are hidden because your account does not have Employee & Intern access.
              </PanelMessage>
            </>
          )}
        </section>

        <section className="rounded-2xl border border-(--mws-line) bg-white p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-(--mws-charcoal)">
              <Users size={18} />
              Students
            </h2>
            <div className="flex items-center gap-2">
              <input
                type="search"
                value={studentSearch}
                onChange={(event) => {
                  setStudentSearch(event.target.value);
                  setStudentPage(1);
                }}
                placeholder="Search students"
                aria-label="Search students"
                className="h-9 min-w-0 rounded-full border border-(--mws-line) px-3 text-sm outline-none focus:border-(--mws-burgundy)"
              />
              {isMixedClass ? (
                <SelectFilter
                  value={studentGradeFilter}
                  onChange={(value) => {
                    setStudentGradeFilter(value);
                    setStudentPage(1);
                  }}
                  options={[
                    { value: "", label: "All Grades" },
                    ...mixedClassGradeOptions.map((grade) => ({
                      value: grade.name,
                      label: grade.name,
                    })),
                  ]}
                  placeholder="All Grades"
                />
              ) : null}
              {canWrite ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={optionsQuery.isLoading}
                  onClick={() => setEnrollDialogOpen(true)}
                >
                  <Plus size={14} />
                  Enroll student
                </Button>
              ) : null}
            </div>
          </div>
          {!hasStudentAccess ? (
            <PanelMessage>
              {klass?.active_enrollment_count || 0} active student{klass?.active_enrollment_count === 1 ? "" : "s"} are enrolled. Student identities require Student access.
            </PanelMessage>
          ) : enrollmentsQuery.isLoading ? (
            <PanelMessage>Loading students…</PanelMessage>
          ) : students.length === 0 && studentGradeFilter ? (
            <PanelMessage>No students at this grade.</PanelMessage>
          ) : students.length === 0 ? (
            <PanelMessage>No students enrolled in this class.</PanelMessage>
          ) : (
            <>
              {canWrite ? (
                <BulkActionBar
                  selectedCount={selectedEnrollments.length}
                  onClear={() => setSelectedEnrollmentIds(new Set())}
                >
                  <ActionsMenu label="Bulk Actions">
                    {(closeMenu) => (
                      <>
                        {isClassPlaceholder && selectedEnrollments.length === 1 ? (
                          <ActionsMenuItem
                            onClick={() => {
                              closeMenu();
                              setFixClassDialogOpen(true);
                            }}
                          >
                            <span className="flex items-center gap-2">
                              <Wrench size={15} />
                              Fix Class
                            </span>
                          </ActionsMenuItem>
                        ) : null}
                        {selectedAreAllActive ? (
                          <ActionsMenuItem
                            onClick={() => {
                              closeMenu();
                              setBulkDialog({
                                mode: "bulk-promote",
                                records: selectedEnrollments,
                              });
                            }}
                          >
                            <span className="flex items-center gap-2">
                              <GraduationCap size={15} />
                              Promote
                            </span>
                          </ActionsMenuItem>
                        ) : null}
                        {selectedAreAllActive ? (
                          <ActionsMenuItem
                            onClick={() => {
                              closeMenu();
                              setBulkDialog({
                                mode: "bulk-transfer",
                                records: selectedEnrollments,
                              });
                            }}
                          >
                            <span className="flex items-center gap-2">
                              <Repeat size={15} />
                              Move
                            </span>
                          </ActionsMenuItem>
                        ) : null}
                        {selectedAreAllActive ? (
                          <ActionsMenuItem
                            onClick={() => {
                              closeMenu();
                              setBulkDialog({
                                mode: "bulk-close",
                                records: selectedEnrollments,
                              });
                            }}
                          >
                            <span className="flex items-center gap-2">
                              <LogOut size={15} />
                              Close
                            </span>
                          </ActionsMenuItem>
                        ) : null}
                        {selectedAreAllInactive ? (
                          <ActionsMenuItem
                            disabled={bulkReactivateMutation.isPending}
                            onClick={async () => {
                              closeMenu();
                              if (
                                await confirm({
                                  title: "Reactivate enrollments",
                                  description: `Reactivate ${selectedEnrollments.length} enrollment(s)?`,
                                  confirmLabel: "Reactivate",
                                })
                              ) {
                                bulkReactivateMutation.mutate(selectedEnrollments);
                              }
                            }}
                          >
                            <span className="flex items-center gap-2">
                              <RotateCcw size={15} />
                              Reactivate
                            </span>
                          </ActionsMenuItem>
                        ) : null}
                        {(selectedAreAllActive || selectedAreAllInactive) &&
                        selectedNoneHaveSeTeacher ? (
                          <ActionsMenuItem
                            onClick={() => {
                              closeMenu();
                              setBulkSeDialog({ mode: "add" });
                            }}
                          >
                            <span className="flex items-center gap-2">
                              <HeartHandshake size={15} />
                              Add SE teacher
                            </span>
                          </ActionsMenuItem>
                        ) : null}
                        {(selectedAreAllActive || selectedAreAllInactive) &&
                        selectedAllHaveSeTeacher ? (
                          <>
                            <ActionsMenuItem
                              onClick={() => {
                                closeMenu();
                                setBulkSeDialog({ mode: "change" });
                              }}
                            >
                              <span className="flex items-center gap-2">
                                <HeartHandshake size={15} />
                                Change SE teacher
                              </span>
                            </ActionsMenuItem>
                            <ActionsMenuItem
                              tone="danger"
                              disabled={bulkRemoveSupportAssignmentMutation.isPending}
                              onClick={async () => {
                                closeMenu();
                                await handleBulkRemoveSe(
                                  selectedEnrollments.map((e) => e.student.id),
                                );
                              }}
                            >
                              <span className="flex items-center gap-2">
                                <Undo2 size={15} />
                                Remove SE teacher
                              </span>
                            </ActionsMenuItem>
                          </>
                        ) : null}
                        <ActionsMenuItem
                          tone="danger"
                          disabled={bulkDropMutation.isPending}
                          onClick={async () => {
                            closeMenu();
                            if (
                              await confirm({
                                title: "Drop students",
                                description: `Drop ${selectedEnrollments.length} student(s) from this class? Any that were promoted here will move back to their previous class. The rest will just be removed.`,
                                confirmLabel: "Drop",
                                tone: "danger",
                              })
                            ) {
                              bulkDropMutation.mutate(selectedEnrollments);
                            }
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <Undo2 size={15} />
                            Drop
                          </span>
                        </ActionsMenuItem>
                      </>
                    )}
                  </ActionsMenu>
                </BulkActionBar>
              ) : null}
              <div className="space-y-3 md:hidden">
                {pagedStudents.map((enrollment) => (
                  <StudentEnrollmentCard
                    key={enrollment.id}
                    enrollment={enrollment}
                    canWrite={canWrite}
                    isSelected={selectedEnrollmentIds.has(enrollment.id)}
                    onToggle={(checked) => toggleOne(enrollment.id, checked)}
                    activeSupportQuery={activeSupportQuery}
                    activeSupportByStudentId={activeSupportByStudentId}
                    isMixedClass={isMixedClass}
                    isClassPlaceholder={isClassPlaceholder}
                  />
                ))}
              </div>

              <div className="hidden w-full overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs font-bold text-(--mws-muted)">
                    <tr>
                      {canWrite ? (
                        <th className="w-10 px-2 py-2">
                          <input
                            type="checkbox"
                            aria-label="Select All Active Enrollments"
                            checked={allSelected}
                            disabled={selectableEnrollments.length === 0}
                            onChange={(event) => toggleAll(event.target.checked)}
                            className="h-4 w-4 accent-(--mws-burgundy)"
                          />
                        </th>
                      ) : null}
                      <th className="px-2 py-2">
                        <div className="flex flex-col items-start gap-0.5">
                          <SortableHeader
                            label="Name"
                            column="name"
                            sortBy={studentSort.sort_by}
                            sortOrder={studentSort.sort_order}
                             onSort={(sort_by, sort_order) =>
                               {
                                 setStudentSort({ sort_by, sort_order });
                                 setStudentPage(1);
                               }
                             }
                          />
                          {isMixedClass ? (
                            <SortableHeader
                              label="Grade"
                              column="grade"
                              sortBy={studentSort.sort_by}
                              sortOrder={studentSort.sort_order}
                               onSort={(sort_by, sort_order) =>
                                 {
                                   setStudentSort({ sort_by, sort_order });
                                   setStudentPage(1);
                                 }
                               }
                            />
                          ) : null}
                        </div>
                      </th>
                      <th className="px-2 py-2">
                        <SortableHeader
                          label="NIS"
                          column="nis"
                          sortBy={studentSort.sort_by}
                          sortOrder={studentSort.sort_order}
                           onSort={(sort_by, sort_order) =>
                             {
                               setStudentSort({ sort_by, sort_order });
                               setStudentPage(1);
                             }
                           }
                        />
                      </th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">SE Teacher</th>
                      {canWrite ? <th className="w-10 px-2 py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedStudents.map((enrollment) => (
                      <tr
                        key={enrollment.id}
                        className="border-t border-(--mws-line)"
                      >
                        {canWrite ? (
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              aria-label={`Select ${enrollment.student.full_name}`}
                              checked={selectedEnrollmentIds.has(enrollment.id)}
                              onChange={(event) =>
                                toggleOne(enrollment.id, event.target.checked)
                              }
                              className="h-4 w-4 accent-(--mws-burgundy)"
                            />
                          </td>
                        ) : null}
                        <td className="px-2 py-2 font-semibold">
                          <Link
                            to={`/students/${enrollment.student.id}`}
                            title={
                              !isClassPlaceholder &&
                              enrollment.student.has_unresolved_placeholder_class
                                ? "This student has an unfixed placeholder class somewhere in their history. Check Class History on their profile."
                                : undefined
                            }
                            className={cn(
                              "hover:underline",
                              !isClassPlaceholder &&
                                enrollment.student.has_unresolved_placeholder_class
                                ? "text-[#b45309]"
                                : "text-(--mws-charcoal)",
                            )}
                          >
                            {enrollment.student.full_name}
                          </Link>
                          {isMixedClass ? (
                            <span className="block text-xs font-normal text-(--mws-muted)">
                              {enrollment.grade_level}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">
                          {enrollment.student.nis || "-"}
                        </td>
                        {canWrite ? (
                          <td className="px-2 py-2 text-right">
                            <StudentEnrollmentActions
                              enrollment={enrollment}
                              isPlaceholder={isClassPlaceholder}
                              onPromote={() => setBulkDialog({ mode: "bulk-promote", records: [enrollment] })}
                              onTransfer={() => setBulkDialog({ mode: "bulk-transfer", records: [enrollment] })}
                              onClose={() => setBulkDialog({ mode: "bulk-close", records: [enrollment] })}
                              onFixClass={() => {
                                setSelectedEnrollmentIds(new Set([enrollment.id]));
                                setFixClassDialogOpen(true);
                              }}
                            />
                          </td>
                        ) : null}
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge
                              variant="text"
                              tone={statusTone(enrollment.enrollment_status)}
                            >
                              {formatStatus(enrollment.enrollment_status)}
                            </StatusBadge>
                            {enrollment.enrollment_status === "ACTIVE" &&
                            enrollment.student.status === "INACTIVE" ? (
                              <StatusBadge variant="text" tone="amber">
                                · Student inactive
                              </StatusBadge>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          {activeSupportQuery.isLoading ? (
                            <span className="text-(--mws-muted)">…</span>
                          ) : activeSupportByStudentId.has(enrollment.student.id) ? (
                            <Link
                              to={activeSupportByStudentId.get(enrollment.student.id).type === "INTERN" ? `/interns/${activeSupportByStudentId.get(enrollment.student.id).id}` : `/employees/${activeSupportByStudentId.get(enrollment.student.id).id}`}
                              className="text-(--mws-charcoal) hover:underline"
                            >
                              {
                                activeSupportByStudentId.get(enrollment.student.id)
                                  .full_name
                              }
                            </Link>
                          ) : (
                            <span className="text-(--mws-muted)">
                              Not assigned
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {studentPaging.total_item > 0 ? (
                <PaginationBar
                  paging={studentPaging}
                  itemLabel="students"
                  isLoading={enrollmentsQuery.isFetching}
                  onPrevious={() => setStudentPage((page) => Math.max(page - 1, 1))}
                  onNext={() => setStudentPage((page) => page + 1)}
                  onPageSizeChange={(size) => {
                    setStudentPageSize(size);
                    setStudentPage(1);
                  }}
                />
              ) : null}
            </>
          )}
        </section>
      </div>

      {enrollDialogOpen ? (
        <EnrollmentDialog
          dialog={{ mode: "create" }}
          presetClassId={classId}
          presetClassStatus={klass?.status}
          excludeStudentIds={activeStudentIds}
          options={classScopedOptions}
          isSubmitting={createEnrollMutation.isPending}
          onClose={() => setEnrollDialogOpen(false)}
          onSubmit={(payload) => createEnrollMutation.mutate(payload)}
        />
      ) : null}

      <BulkResultDialog
        title="Enrollment Failures"
        result={enrollFailureResult?.result}
        getLabel={(id) => enrollFailureResult?.studentNameById.get(id)}
        getDetailHref={(id) => `/students/${id}`}
        onClose={() => setEnrollFailureResult(null)}
      />

      {fixClassDialogOpen && selectedEnrollments.length === 1 ? (
        <FixPlaceholderClassDialog
          enrollment={selectedEnrollments[0]}
          isSubmitting={fixClassMutation.isPending}
          onClose={() => setFixClassDialogOpen(false)}
          onSubmit={(payload) =>
            fixClassMutation.mutate({
              enrollment: selectedEnrollments[0],
              payload,
            })
          }
        />
      ) : null}

      {editDialogOpen ? (
        <ClassDialog
          dialog={{ mode: "edit", record: klass }}
          options={optionsQuery.data}
          isSubmitting={updateMutation.isPending}
          onClose={() => setEditDialogOpen(false)}
          onSubmit={(payload) => updateMutation.mutate(payload)}
          user={user}
        />
      ) : null}

      {bulkDialog ? (
        <EnrollmentDialog
          dialog={bulkDialog}
          options={classScopedOptions}
          isSubmitting={
            bulkPromoteMutation.isPending ||
            bulkTransferMutation.isPending ||
            bulkCloseMutation.isPending
          }
          onClose={() => setBulkDialog(null)}
          onSubmit={(payload, includedRecords) => {
            const enrollments = includedRecords ?? bulkDialog.records;
            if (bulkDialog.mode === "bulk-promote") {
              bulkPromoteMutation.mutate({ enrollments, payload });
            }
            if (bulkDialog.mode === "bulk-transfer") {
              bulkTransferMutation.mutate({ enrollments, payload });
            }
            if (bulkDialog.mode === "bulk-close") {
              bulkCloseMutation.mutate({ enrollments, payload });
            }
          }}
        />
      ) : null}

      {bulkSeDialog ? (
          <SupportAssignmentDialog
          title={
            bulkSeDialog.mode === "change" ? "Change Special Education Teacher" : undefined
          }
          excludeWorkforceMemberIds={
            bulkSeDialog.mode === "change"
              ? Array.from(currentSeTeacherIdsForSelection)
              : []
          }
          unitId={classUnitId}
          studentName={`${selectedEnrollments.length} selected student(s)`}
          mode={bulkSeDialog.mode}
          isSubmitting={bulkCreateSupportAssignmentMutation.isPending}
          onClose={() => setBulkSeDialog(null)}
          onSubmit={(payload) =>
            bulkCreateSupportAssignmentMutation.mutate({
              mode: bulkSeDialog.mode,
              studentIds: selectedEnrollments.map(
                (enrollment) => enrollment.student.id,
              ),
              payload,
            })
          }
        />
      ) : null}
    </div>
  );
}

function StudentEnrollmentCard({
  enrollment,
  canWrite,
  isSelected,
  onToggle,
  activeSupportQuery,
  activeSupportByStudentId,
  isMixedClass,
  isClassPlaceholder,
}) {
  const supportEmployee = activeSupportByStudentId.get(enrollment.student.id);

  return (
    <div className="rounded-xl border border-(--mws-line) bg-white p-4">
      <div className="flex items-start gap-3">
        {canWrite ? (
          <input
            type="checkbox"
            aria-label={`Select ${enrollment.student.full_name}`}
            checked={isSelected}
            onChange={(event) => onToggle(event.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-(--mws-burgundy)"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <Link
            to={`/students/${enrollment.student.id}`}
            title={
              !isClassPlaceholder &&
              enrollment.student.has_unresolved_placeholder_class
                ? "This student has an unfixed placeholder class somewhere in their history. Check Class History on their profile."
                : undefined
            }
            className={cn(
              "font-semibold hover:underline",
              !isClassPlaceholder &&
                enrollment.student.has_unresolved_placeholder_class
                ? "text-[#b45309]"
                : "text-(--mws-charcoal)",
            )}
          >
            {enrollment.student.full_name}
          </Link>
          <p className="text-xs text-(--mws-muted)">
            {enrollment.student.nis || "No NIS yet"}
            {isMixedClass ? ` · ${enrollment.grade_level}` : ""}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge
              variant="text"
              tone={statusTone(enrollment.enrollment_status)}
            >
              {formatStatus(enrollment.enrollment_status)}
            </StatusBadge>
            {enrollment.enrollment_status === "ACTIVE" &&
            enrollment.student.status === "INACTIVE" ? (
              <StatusBadge variant="text" tone="amber">
                · Student inactive
              </StatusBadge>
            ) : null}
          </div>

          <div className="mt-2 flex items-center gap-1">
            <span className="text-xs text-(--mws-muted)">SE Teacher:</span>
            {activeSupportQuery.isLoading ? (
              <span className="text-xs text-(--mws-muted)">…</span>
            ) : supportEmployee ? (
              <Link
                to={supportEmployee.type === "INTERN" ? `/interns/${supportEmployee.id}` : `/employees/${supportEmployee.id}`}
                className="text-xs font-semibold text-(--mws-charcoal) hover:underline"
              >
                {supportEmployee.full_name}
              </Link>
            ) : (
              <span className="text-xs text-(--mws-muted)">
                Not assigned
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StudentEnrollmentActions({
  enrollment,
  isPlaceholder,
  onPromote,
  onTransfer,
  onClose,
  onFixClass,
}) {
  const isActive = enrollment.enrollment_status === "ACTIVE";
  return (
    <ActionsMenu label={`Actions for ${enrollment.student.full_name}`}>
      {(closeMenu) => (
        <>
          {isPlaceholder ? (
            <ActionsMenuItem onClick={() => { closeMenu(); onFixClass(); }}>
              Fix Class
            </ActionsMenuItem>
          ) : null}
          {isActive ? (
            <>
              <ActionsMenuItem onClick={() => { closeMenu(); onPromote(); }}>
                Promote
              </ActionsMenuItem>
              <ActionsMenuItem onClick={() => { closeMenu(); onTransfer(); }}>
                Move
              </ActionsMenuItem>
              <ActionsMenuItem onClick={() => { closeMenu(); onClose(); }}>
                Close
              </ActionsMenuItem>
            </>
          ) : null}
        </>
      )}
    </ActionsMenu>
  );
}
