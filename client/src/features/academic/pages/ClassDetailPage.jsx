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
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { ActionsMenu, ActionsMenuItem } from "../../../components/ui/ActionsMenu.jsx";
import { BulkActionBar } from "../../../components/ui/BulkActionBar.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { SortableHeader } from "../../../components/ui/SortableHeader.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { employeesApi } from "../../employees/api/employeesApi.js";
import { jobLevelsApi } from "../../master-data/api/masterDataApi.js";
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

export function ClassDetailPage() {
  const { classId } = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [bulkSeDialogOpen, setBulkSeDialogOpen] = useState(false);
  const [studentSort, setStudentSort] = useState({
    sort_by: "name",
    sort_order: "asc",
  });

  const classQuery = useQuery({
    queryKey: ["classes", classId],
    queryFn: () => classesApi.get(classId),
    enabled: Boolean(classId),
  });

  const teachersQuery = useQuery({
    queryKey: ["classes", classId, "teacher-assignments"],
    queryFn: () => classesApi.teacherAssignments(classId),
    enabled: Boolean(classId),
  });

  const enrollmentsQuery = useQuery({
    queryKey: ["enrollments", { class_id: classId }],
    queryFn: () =>
      enrollmentsApi.list({ class_id: classId, page: 1, size: 100 }),
    enabled: Boolean(classId),
  });

  // grades (for unit_name) + active teaching employees + classes/academic
  // years (for the bulk promote/transfer and enroll dialogs' pickers) +
  // Special Education teachers with their current caseload - same shapes
  // useClassOptionsQuery()/useEnrollmentOptionsQuery() build on AcademicPage,
  // combined here since this page needs all of it.
  const optionsQuery = useQuery({
    queryKey: ["class-detail-options"],
    queryFn: async () => {
      const [grades, employees, jobLevels, classes, academicYears, caseload] =
        await Promise.all([
          gradesApi.list({ page: 1, size: 100 }),
          employeesApi.list({
            page: 1,
            size: 100,
            status: "ACTIVE",
            sort_by: "full_name",
            sort_order: "asc",
          }),
          jobLevelsApi.list({ page: 1, size: 100 }),
          // No status filter - EnrollmentDialog's own picker excludes only
          // INACTIVE classes, since ACTIVE and UPCOMING are both valid
          // enroll/promote/transfer targets (UPCOMING classes are next
          // year's, prepared ahead of time).
          classesApi.list({ page: 1, size: 100 }),
          academicYearsApi.list({
            page: 1,
            size: 100,
            sort_by: "start_date",
            sort_order: "desc",
          }),
          studentSensitiveApi.getSupportAssignmentCaseload(),
        ]);
      const teachingLevelNames = new Set(
        (jobLevels.data || [])
          .filter((level) => level.is_teaching_role)
          .map((level) => level.name),
      );
      const unitIdByGradeId = new Map(
        (grades.data || []).map((grade) => [grade.id, grade.unit_id]),
      );
      const caseloadByEmployeeId = new Map(
        caseload.map((entry) => [
          entry.employee_id,
          entry.active_student_count,
        ]),
      );
      return {
        grades: grades.data || [],
        teachingEmployees: (employees.data || []).filter((employee) =>
          teachingLevelNames.has(employee.employment.job_level),
        ),
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

  const klass = classQuery.data;
  const teachers = teachersQuery.data || [];
  const students = enrollmentsQuery.data?.data || [];
  // Client-side only - this page always fetches the full roster (size:100,
  // no pagination), so there's no server round-trip to sort through.
  const sortedStudents = [...students].sort((a, b) => {
    const direction = studentSort.sort_order === "asc" ? 1 : -1;
    if (studentSort.sort_by === "nis") {
      return (a.student.nis || "").localeCompare(b.student.nis || "") * direction;
    }
    return a.student.full_name.localeCompare(b.student.full_name) * direction;
  });

  const classGrade = (optionsQuery.data?.grades || []).find(
    (grade) => grade.id === klass?.grade?.id,
  );
  const classUnitName = classGrade?.unit_name || null;

  // Mirrors class-service.ts's update()/assignTeacher() - can_write_data
  // plus the class's own grade unit matching the admin's own unit.
  const canWriteBase =
    user?.role === "SUPER_ADMIN" ||
    (user?.role === "DATABASE_ADMIN" && Boolean(user?.can_write_data));
  const canWrite =
    canWriteBase &&
    (user?.role === "SUPER_ADMIN" || classGrade?.unit_id === user?.unit_id);

  const unitMatchedTeachers = classUnitName
    ? (optionsQuery.data?.teachingEmployees || []).filter(
        (employee) => employee.employment.unit === classUnitName,
      )
    : optionsQuery.data?.teachingEmployees || [];

  // Cross-class lookup for the "one HOMEROOM/SUPPORTING_HOMEROOM per
  // employee per academic year" cap (class-service.ts's
  // ROLE_CAPPED_PER_TEACHER_PER_YEAR) - `optionsQuery.data.classes` only
  // covers ACTIVE classes, so this is a best-effort filter; the backend
  // still enforces the real check on submit.
  const otherClassesThisYear = (optionsQuery.data?.classes || []).filter(
    (otherClass) =>
      otherClass.id !== classId &&
      otherClass.academic_year.id === klass?.academic_year?.id,
  );
  const homeroomTakenEmployeeIds = new Set(
    otherClassesThisYear.flatMap((otherClass) =>
      (otherClass.homeroom_teachers || []).map((t) => t.employee.id),
    ),
  );
  const supportingHomeroomTakenEmployeeIds = new Set(
    otherClassesThisYear.flatMap((otherClass) =>
      (otherClass.supporting_homeroom_teachers || []).map((t) => t.employee.id),
    ),
  );

  const assignTeacherMutation = useMutation({
    mutationFn: (payload) => classesApi.assignTeacher(classId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["classes", classId, "teacher-assignments"],
      });
      queryClient.invalidateQueries({ queryKey: ["classes", classId] });
    },
  });

  const endTeacherAssignmentMutation = useMutation({
    mutationFn: (assignmentId) =>
      classesApi.endTeacherAssignment(classId, assignmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["classes", classId, "teacher-assignments"],
      });
    },
  });

  const removeTeacherAssignmentMutation = useMutation({
    mutationFn: (assignmentId) =>
      classesApi.removeTeacherAssignment(classId, assignmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["classes", classId, "teacher-assignments"],
      });
    },
  });

  const reopenTeacherAssignmentMutation = useMutation({
    mutationFn: (assignmentId) =>
      classesApi.reopenTeacherAssignment(classId, assignmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["classes", classId, "teacher-assignments"],
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload) => classesApi.update(classId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classes", classId] });
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      setEditDialogOpen(false);
    },
  });

  // Mirrors AcademicPage's EnrollmentsPanel createMutation - bulk-create
  // when multiple students are queued, single create otherwise, then attach
  // the picked Special Education teacher (if any) to whichever students
  // succeeded.
  const createEnrollMutation = useMutation({
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["enrollments", { class_id: classId }],
      });
      queryClient.invalidateQueries({ queryKey: ["classes", classId] });
      queryClient.invalidateQueries({
        queryKey: ["support-assignments", "active-student-ids"],
      });
      if (data?.success_count !== undefined) {
        if (data.success_count > 0) {
          showSuccessToast(`${data.success_count} student(s) enrolled.`);
        }
        if (data.failed_count > 0) {
          showBulkFailureToast("student(s) failed to enroll", data);
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
  }

  const bulkPromoteMutation = useMutation({
    mutationFn: ({ enrollments, payload }) =>
      enrollmentsApi.bulkPromote({
        enrollment_ids: enrollments.map((enrollment) => enrollment.id),
        ...payload,
      }),
    onSuccess: (result) => {
      invalidateEnrollmentData();
      setSelectedEnrollmentIds(new Set());
      setBulkDialog(null);
      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} student(s) promoted.`);
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

  // Undoes a mistaken close (e.g. graduated by accident) - flips the
  // enrollment back to ACTIVE instead of routing through the enroll picker,
  // which would just hit the "already has an enrollment record for this
  // academic year" conflict. Bulk-only: every row is selectable regardless
  // of status, so there's no per-row action needed for this.
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

  // Drops a student from this class - soft-deletes the enrollment. When it's
  // the result of a promote, the backend also reactivates the enrollment it
  // was promoted from in the same call, so this one action covers both
  // "undo a mistaken promote" and "remove a first enrollment" - they only
  // ever differed by that one condition, which promoted_from_enrollment_id
  // on the enrollment itself already tells us (see EnrollmentService.remove()).
  // Bulk-only, same reasoning as reactivate above.
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

  // Lets an admin assign a Special Education teacher right from this
  // roster instead of having to open the student's own detail page.
  // Bulk-only - same reasoning as reactivate/drop above.
  // Same assignment, applied to every selected student in one go - the
  // common case after mass-enrolling a batch of students who all need the
  // same Special Education teacher. Per-student failures (e.g. one of them
  // already has this exact teacher assigned) don't block the rest.
  const bulkCreateSupportAssignmentMutation = useMutation({
    mutationFn: async ({ studentIds, payload }) => {
      const results = await Promise.allSettled(
        studentIds.map((studentId) =>
          studentSensitiveApi.createSupportAssignment(studentId, payload),
        ),
      );
      return {
        successCount: results.filter((r) => r.status === "fulfilled").length,
        failedCount: results.filter((r) => r.status === "rejected").length,
        failureReasons: results
          .filter((r) => r.status === "rejected")
          .map((r) => r.reason?.message)
          .filter(Boolean),
      };
    },
    onSuccess: ({ successCount, failedCount, failureReasons }) => {
      queryClient.invalidateQueries({
        queryKey: ["support-assignments", "active-student-ids"],
      });
      setBulkSeDialogOpen(false);
      setSelectedEnrollmentIds(new Set());
      if (successCount > 0) {
        showSuccessToast(`SE teacher assigned to ${successCount} student(s).`);
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

  // Every row is selectable regardless of status now - Promote/Move/Close
  // only make sense for ACTIVE rows and Reactivate only for non-ACTIVE ones,
  // but the backend already reports mismatches as a per-item bulk failure
  // rather than blocking the whole batch, so there's no need to filter the
  // selection itself.
  const selectableEnrollments = students;
  const selectedEnrollments = selectableEnrollments.filter((enrollment) =>
    selectedEnrollmentIds.has(enrollment.id),
  );
  // Backend still reports a status mismatch as a per-item bulk failure
  // rather than rejecting the whole request, but showing an action that's
  // guaranteed to partially fail for a mixed selection is confusing - hide
  // it instead. Add SE teacher doesn't actually care about enrollment
  // status, but stays consistent with the others: hidden on a mixed
  // selection too, shown for either a uniform active or inactive one.
  const selectedAreAllActive =
    selectedEnrollments.length > 0 &&
    selectedEnrollments.every((e) => e.enrollment_status === "ACTIVE");
  const selectedAreAllInactive =
    selectedEnrollments.length > 0 &&
    selectedEnrollments.every((e) => e.enrollment_status !== "ACTIVE");
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
  // Only currently-ACTIVE roster entries block re-enrollment in the picker -
  // a student with a past (e.g. graduated/withdrawn) record in this same
  // class should still be selectable to re-enroll.
  const activeStudentIds = students
    .filter((enrollment) => enrollment.enrollment_status === "ACTIVE")
    .map((enrollment) => enrollment.student.id);

  // Which enrolled students already have an active SPECIAL_ED teacher - a
  // quick "does this student still need one" signal without leaving this
  // page, since the actual assign/end flow lives on the student's own page.
  const activeSupportQuery = useQuery({
    queryKey: ["support-assignments", "active-student-ids", studentIds],
    queryFn: () => studentSensitiveApi.getActiveSupportStudentIds(studentIds),
    enabled: studentIds.length > 0,
  });
  const activeSupportStudentIds = new Set(activeSupportQuery.data || []);

  return (
    <div className="min-w-0">
      <PageHeader
        title={klass?.name || "Class Detail"}
        description={
          klass
            ? `${klass.grade.name} / ${klass.academic_year.name}`
            : "Class roster: students and teachers."
        }
        actions={
          <>
            {canWrite && klass ? (
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
          <span className="text-sm text-[var(--mws-muted)]">
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
        <section className="rounded-2xl border border-[var(--mws-line)] bg-white p-5">
          <TeacherAssignmentsSection
            assignments={teachers}
            isLoading={teachersQuery.isLoading}
            error={teachersQuery.error}
            teachingEmployees={unitMatchedTeachers}
            unitWarning={
              !classUnitName
                ? `This class's grade ("${klass?.grade?.name ?? "unknown"}") has no unit configured - showing every teacher, but assigning one will be rejected until the grade's unit is set.`
                : null
            }
            canWrite={canWrite}
            isAssigning={assignTeacherMutation.isPending}
            isEnding={endTeacherAssignmentMutation.isPending}
            isRemoving={removeTeacherAssignmentMutation.isPending}
            isReopening={reopenTeacherAssignmentMutation.isPending}
            onAssign={(payload) => assignTeacherMutation.mutate(payload)}
            onEnd={(assignmentId) =>
              endTeacherAssignmentMutation.mutate(assignmentId)
            }
            onRemove={(assignmentId) =>
              removeTeacherAssignmentMutation.mutate(assignmentId)
            }
            onReopen={(assignmentId) =>
              reopenTeacherAssignmentMutation.mutate(assignmentId)
            }
            homeroomTakenEmployeeIds={homeroomTakenEmployeeIds}
            supportingHomeroomTakenEmployeeIds={supportingHomeroomTakenEmployeeIds}
          />
        </section>

        <section className="rounded-2xl border border-[var(--mws-line)] bg-white p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-[var(--mws-charcoal)]">
              <Users size={18} />
              Students
            </h2>
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
          {enrollmentsQuery.isLoading ? (
            <PanelMessage>Loading students…</PanelMessage>
          ) : students.length === 0 ? (
            <PanelMessage>No students enrolled in this class.</PanelMessage>
          ) : (
            <>
              {canWrite ? (
                <BulkActionBar
                  selectedCount={selectedEnrollments.length}
                  onClear={() => setSelectedEnrollmentIds(new Set())}
                >
                  <ActionsMenu label="Bulk actions">
                    {(closeMenu) => (
                      <>
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
                        {selectedAreAllActive || selectedAreAllInactive ? (
                          <ActionsMenuItem
                            onClick={() => {
                              closeMenu();
                              setBulkSeDialogOpen(true);
                            }}
                          >
                            <span className="flex items-center gap-2">
                              <HeartHandshake size={15} />
                              Add SE teacher
                            </span>
                          </ActionsMenuItem>
                        ) : null}
                        <ActionsMenuItem
                          tone="danger"
                          disabled={bulkDropMutation.isPending}
                          onClick={async () => {
                            closeMenu();
                            if (
                              await confirm({
                                title: "Drop students",
                                description: `Drop ${selectedEnrollments.length} student(s) from this class? Any that were promoted here will move back to their previous class - the rest will just be removed.`,
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
              <table className="w-full text-left text-sm">
                <thead className="text-xs font-bold text-[var(--mws-muted)]">
                  <tr>
                    {canWrite ? (
                      <th className="w-10 px-2 py-2">
                        <input
                          type="checkbox"
                          aria-label="Select all active enrollments"
                          checked={allSelected}
                          disabled={selectableEnrollments.length === 0}
                          onChange={(event) => toggleAll(event.target.checked)}
                          className="h-4 w-4 accent-[var(--mws-burgundy)]"
                        />
                      </th>
                    ) : null}
                    <th className="px-2 py-2">
                      <SortableHeader
                        label="Name"
                        column="name"
                        sortBy={studentSort.sort_by}
                        sortOrder={studentSort.sort_order}
                        onSort={(sort_by, sort_order) =>
                          setStudentSort({ sort_by, sort_order })
                        }
                      />
                    </th>
                    <th className="px-2 py-2">
                      <SortableHeader
                        label="NIS"
                        column="nis"
                        sortBy={studentSort.sort_by}
                        sortOrder={studentSort.sort_order}
                        onSort={(sort_by, sort_order) =>
                          setStudentSort({ sort_by, sort_order })
                        }
                      />
                    </th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">SE Teacher</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedStudents.map((enrollment) => (
                    <tr
                      key={enrollment.id}
                      className="border-t border-[var(--mws-line)]"
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
                            className="h-4 w-4 accent-[var(--mws-burgundy)]"
                          />
                        </td>
                      ) : null}
                      <td className="px-2 py-2 font-semibold text-[var(--mws-charcoal)]">
                        <Link
                          to={`/students/${enrollment.student.id}`}
                          className="hover:underline"
                        >
                          {enrollment.student.full_name}
                        </Link>
                      </td>
                      <td className="px-2 py-2">
                        {enrollment.student.nis || "—"}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusBadge tone={statusTone(enrollment.enrollment_status)}>
                            {formatStatus(enrollment.enrollment_status)}
                          </StatusBadge>
                          {/* Enrollment status only ever says whether this
                              class seat is occupied - it stays Active even
                              while the student themselves is Inactive (a
                              pause, not a withdrawal). Flag that split
                              rather than just showing "Active" and
                              implying the student is too. */}
                          {enrollment.enrollment_status === "ACTIVE" &&
                          enrollment.student.status === "INACTIVE" ? (
                            <StatusBadge tone="amber">
                              Student inactive
                            </StatusBadge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        {activeSupportQuery.isLoading ? (
                          <span className="text-[var(--mws-muted)]">…</span>
                        ) : (
                          <StatusBadge
                            tone={
                              activeSupportStudentIds.has(enrollment.student.id)
                                ? "green"
                                : "amber"
                            }
                          >
                            {activeSupportStudentIds.has(enrollment.student.id)
                              ? "Assigned"
                              : "Not assigned"}
                          </StatusBadge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
          options={optionsQuery.data}
          isSubmitting={createEnrollMutation.isPending}
          onClose={() => setEnrollDialogOpen(false)}
          onSubmit={(payload) => createEnrollMutation.mutate(payload)}
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
          options={optionsQuery.data}
          isSubmitting={
            bulkPromoteMutation.isPending ||
            bulkTransferMutation.isPending ||
            bulkCloseMutation.isPending
          }
          onClose={() => setBulkDialog(null)}
          onSubmit={(payload) => {
            if (bulkDialog.mode === "bulk-promote") {
              bulkPromoteMutation.mutate({
                enrollments: bulkDialog.records,
                payload,
              });
            }
            if (bulkDialog.mode === "bulk-transfer") {
              bulkTransferMutation.mutate({
                enrollments: bulkDialog.records,
                payload,
              });
            }
            if (bulkDialog.mode === "bulk-close") {
              bulkCloseMutation.mutate({
                enrollments: bulkDialog.records,
                payload,
              });
            }
          }}
        />
      ) : null}

      {bulkSeDialogOpen ? (
        <SupportAssignmentDialog
          employees={optionsQuery.data?.specialEducationTeachers || []}
          studentName={`${selectedEnrollments.length} selected student(s)`}
          isSubmitting={bulkCreateSupportAssignmentMutation.isPending}
          onClose={() => setBulkSeDialogOpen(false)}
          onSubmit={(payload) =>
            bulkCreateSupportAssignmentMutation.mutate({
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
