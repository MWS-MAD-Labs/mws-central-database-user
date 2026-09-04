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

// Mirrors UNKNOWN_LEGACY_CLASS_PREFIX in server/src/service/enrollment-service.ts.
const UNKNOWN_LEGACY_CLASS_PREFIX = "Unknown (Legacy Import)";
const STUDENT_PAGE_SIZE = 10;

export function ClassDetailPage() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [enrollFailureResult, setEnrollFailureResult] = useState(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  // { mode: 'add' } | { mode: 'change' } | null - which SE-teacher bulk
  // action opened the dialog, since "add" and "change" submit differently.
  const [bulkSeDialog, setBulkSeDialog] = useState(null);
  const [fixClassDialogOpen, setFixClassDialogOpen] = useState(false);
  const [studentSort, setStudentSort] = useState({
    sort_by: "name",
    sort_order: "asc",
  });
  // Only meaningful on a mixed-age class (see ClassAdditionalGrade), whose
  // roster spans more than one grade - narrows the table (and what "select
  // all" bulk-selects) down to one grade at a time, e.g. to promote just
  // the K1 half without hand-picking rows.
  const [studentGradeFilter, setStudentGradeFilter] = useState("");
  // Client-side paging over the roster - it's fetched whole (size:100) for
  // sorting/select-all to work without a server round-trip, but rendering
  // all of it in one long table was the actual problem. Selection itself
  // still spans every page (selectedEnrollmentIds isn't reset on page
  // change), same as the bulk-review lists elsewhere in this app.
  const [studentPage, setStudentPage] = useState(1);

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
  const gradeFilteredStudents = studentGradeFilter
    ? students.filter((enrollment) => enrollment.grade_level === studentGradeFilter)
    : students;
  // grade_level on an enrollment is just a name snapshot ("Grade 10"), which
  // sorts wrong alphabetically against "Grade 2" - this maps back to the
  // grade's real numeric level (already fetched for classGrade below) so
  // the "grade" sort_by case orders students by actual grade, not string.
  const gradeLevelByName = new Map(
    (optionsQuery.data?.grades || []).map((grade) => [grade.name, grade.level]),
  );
  // Client-side only - this page always fetches the full roster (size:100,
  // no pagination), so there's no server round-trip to sort through.
  const sortedStudents = [...gradeFilteredStudents].sort((a, b) => {
    const direction = studentSort.sort_order === "asc" ? 1 : -1;
    if (studentSort.sort_by === "nis") {
      return (a.student.nis || "").localeCompare(b.student.nis || "") * direction;
    }
    if (studentSort.sort_by === "grade") {
      const levelA = gradeLevelByName.get(a.grade_level) ?? 0;
      const levelB = gradeLevelByName.get(b.grade_level) ?? 0;
      return (levelA - levelB) * direction;
    }
    return a.student.full_name.localeCompare(b.student.full_name) * direction;
  });
  const studentTotalPages = Math.max(
    Math.ceil(sortedStudents.length / STUDENT_PAGE_SIZE),
    1,
  );
  const clampedStudentPage = Math.min(studentPage, studentTotalPages);
  const pagedStudents = sortedStudents.slice(
    (clampedStudentPage - 1) * STUDENT_PAGE_SIZE,
    clampedStudentPage * STUDENT_PAGE_SIZE,
  );

  const classGrade = (optionsQuery.data?.grades || []).find(
    (grade) => grade.id === klass?.grade?.id,
  );
  const classUnitName = classGrade?.unit_name || null;
  // Mixed-age class (see ClassAdditionalGrade) - the roster's own Grade
  // column only earns its keep here, since a normal single-grade class
  // already says its one grade in the page header.
  const isMixedClass = (klass?.additional_grades?.length || 0) > 0;
  // Primary + additional grades this class actually holds students at -
  // the only grades worth offering in the filter dropdown below.
  const mixedClassGradeOptions = isMixedClass
    ? [klass.grade, ...(klass.additional_grades || [])].filter(Boolean)
    : [];

  // Mirrors class-service.ts's assertDatabaseAdminCanWriteClass - Class CRUD
  // and student enrollment read as student-domain (can_write_student_data),
  // teacher assignment reads as employee-domain (can_write_employee_data).
  // Both still require the class's own grade unit to match the admin's unit.
  const unitMatches =
    user?.role === "SUPER_ADMIN" || classGrade?.unit_id === user?.unit_id;
  const canWrite =
    (user?.role === "SUPER_ADMIN" ||
      (user?.role === "DATABASE_ADMIN" &&
        Boolean(user?.can_write_student_data))) &&
    unitMatches;
  const canWriteTeacher =
    (user?.role === "SUPER_ADMIN" ||
      (user?.role === "DATABASE_ADMIN" &&
        Boolean(user?.can_write_employee_data))) &&
    unitMatches;

  const unitMatchedTeachers = classUnitName
    ? (optionsQuery.data?.teachingEmployees || []).filter(
        (employee) => employee.employment.unit === classUnitName,
      )
    : optionsQuery.data?.teachingEmployees || [];

  // Mirrors student-support-assignment-service.ts's assertSameUnit() - an
  // SE teacher's own unit has to match the class's, otherwise the backend
  // rejects the assignment anyway. Filtered here so the picker never offers
  // a choice that's guaranteed to 400.
  const unitMatchedSpecialEducationTeachers = classUnitName
    ? (optionsQuery.data?.specialEducationTeachers || []).filter(
        (employee) => employee.employment.unit === classUnitName,
      )
    : optionsQuery.data?.specialEducationTeachers || [];
  const classScopedOptions = optionsQuery.data
    ? {
        ...optionsQuery.data,
        specialEducationTeachers: unitMatchedSpecialEducationTeachers,
      }
    : optionsQuery.data;

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

  // Mirrors assertTeacherUnitMatchesClass in class-service.ts - a teacher
  // assignment moved to another class still has to land in a class whose
  // grade is in the teacher's (and this class's) own unit, so the "Move to
  // Class" picker only offers classes that wouldn't just get rejected.
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

  const endTeacherAssignmentMutation = useMutation({
    mutationFn: ({ assignmentId, endDate }) =>
      classesApi.endTeacherAssignment(classId, assignmentId, endDate),
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

  const updateMutation = useMutation({
    mutationFn: (payload) => classesApi.update(classId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classes", classId] });
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      // The Enroll dialog's own class/grade picker reads from this key -
      // without it, editing a class's grade or additional grades here
      // wouldn't show up there until a manual refresh.
      queryClient.invalidateQueries({ queryKey: ["class-detail-options"] });
      setEditDialogOpen(false);
    },
  });

  // Mirrors AcademicPage's EnrollmentsPanel createMutation - bulk-create
  // when multiple students are queued, single create otherwise, then attach
  // the picked Special Education teacher (if any) to whichever students
  // succeeded.
  const createEnrollMutation = useMutation({
    // Always bulkCreate, even for exactly one student - it accepts a
    // single-item array fine, and a lone failure gets the same
    // BulkResultDialog treatment as a bulk one instead of a bare toast
    // with no way to jump to the student and fix it.
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
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["enrollments", { class_id: classId }],
      });
      queryClient.invalidateQueries({ queryKey: ["classes", classId] });
      queryClient.invalidateQueries({
        queryKey: ["support-assignments", "active-student-ids"],
      });
      // Same reasoning as invalidateEnrollmentData below - a fresh
      // enrollment changes the student's own current_class/grade/status.
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
    // Promote/transfer/close all change the affected students' own
    // current_class/current_grade/status - without this, a student's own
    // detail page (or the class history there) keeps showing stale data
    // until a manual reload.
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
        // Jump straight to the class they were just promoted into - the
        // natural next stop for continuing a backfill/promote chain,
        // instead of leaving the admin on the class they just left.
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

  // Looks up a student's own currently-active assignment id - "Change" and
  // "Remove" need the specific row to end(), not just the student id.
  async function getActiveAssignmentId(studentId) {
    const assignments = await studentSensitiveApi.listSupportAssignments(studentId);
    return assignments.find((a) => !a.end_date)?.id;
  }

  // Lets an admin assign a Special Education teacher right from this
  // roster instead of having to open the student's own detail page.
  // Bulk-only - same reasoning as reactivate/drop above.
  // Same assignment, applied to every selected student in one go - the
  // common case after mass-enrolling a batch of students who all need the
  // same Special Education teacher. mode 'add' targets only students with
  // no active SE teacher yet (others are skipped, not sent to the backend -
  // it would just 400 on the duplicate-assignment check); mode 'change'
  // targets students who already have one, ending their current assignment
  // before creating the new one.
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

  // Ends every selected student's active SE assignment - no dialog needed,
  // just a confirm.
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

  // Every row is selectable regardless of status now - Promote/Move/Close
  // only make sense for ACTIVE rows and Reactivate only for non-ACTIVE ones,
  // but the backend already reports mismatches as a per-item bulk failure
  // rather than blocking the whole batch, so there's no need to filter the
  // selection itself.
  const selectableEnrollments = gradeFilteredStudents;
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
  // Fix Class only makes sense from a placeholder class's own detail page -
  // every enrollment here is already in it, any status. One at a time,
  // since fixPlaceholderClass() itself only ever takes a single record.
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
  // Keyed by student_id -> the SE teacher's employee info, not just a
  // boolean - lets the roster column below show who, not just whether.
  const activeSupportByStudentId = new Map(
    (activeSupportQuery.data || []).map((entry) => [
      entry.student_id,
      entry.employee,
    ]),
  );
  // Which single SE-teacher action makes sense for the current selection -
  // "Add" only if none of them have one yet, "Change"/"Remove" only if all
  // of them already do. A mixed selection hides all three rather than
  // guessing which one the admin means.
  const selectedNoneHaveSeTeacher =
    selectedEnrollments.length > 0 &&
    selectedEnrollments.every((e) => !activeSupportByStudentId.has(e.student.id));
  const selectedAllHaveSeTeacher =
    selectedEnrollments.length > 0 &&
    selectedEnrollments.every((e) => activeSupportByStudentId.has(e.student.id));
  // Changing SE teacher ends each selected student's current assignment and
  // creates a new one - offering one of their own current teachers back as
  // the replacement is a no-op for that student. Excludes the union across
  // every selected student, not just one, since a bulk change can span
  // several different current teachers at once.
  const currentSeTeacherIdsForSelection = new Set(
    selectedEnrollments
      .map((e) => activeSupportByStudentId.get(e.student.id)?.id)
      .filter(Boolean),
  );

  return (
    <div className="min-w-0">
      <PageHeader
        title={klass?.name || "Class Detail"}
        description={
          klass
            ? `${[klass.grade.name, ...(klass.additional_grades || []).map((grade) => grade.name)].join(" + ")} / ${klass.academic_year.name}`
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
                ? `This class's grade ("${klass?.grade?.name ?? "unknown"}") has no unit configured, so every teacher is shown here. Assigning one will still be rejected until the grade's unit is set.`
                : null
            }
            canWrite={canWriteTeacher}
            isAssigning={assignTeacherMutation.isPending}
            isEnding={endTeacherAssignmentMutation.isPending}
            isRemoving={removeTeacherAssignmentMutation.isPending}
            isReopening={reopenTeacherAssignmentMutation.isPending}
            onAssign={(payload) => assignTeacherMutation.mutate(payload)}
            onEnd={(assignmentId, endDate) =>
              endTeacherAssignmentMutation.mutate({ assignmentId, endDate })
            }
            onRemove={(assignmentId) =>
              removeTeacherAssignmentMutation.mutate(assignmentId)
            }
            onReopen={(assignmentId) =>
              reopenTeacherAssignmentMutation.mutate(assignmentId)
            }
            homeroomTakenEmployeeIds={homeroomTakenEmployeeIds}
            supportingHomeroomTakenEmployeeIds={supportingHomeroomTakenEmployeeIds}
            currentClassId={classId}
            moveTargetClassOptions={moveTargetClassOptions}
            isBulkMoving={bulkMoveTeacherAssignmentsMutation.isPending}
            onBulkMove={(assignmentIds, targetClassId) =>
              bulkMoveTeacherAssignmentsMutation.mutate({
                assignmentIds,
                targetClassId,
              })
            }
          />
        </section>

        <section className="rounded-2xl border border-[var(--mws-line)] bg-white p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-[var(--mws-charcoal)]">
              <Users size={18} />
              Students
            </h2>
            <div className="flex items-center gap-2">
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
          {enrollmentsQuery.isLoading ? (
            <PanelMessage>Loading students…</PanelMessage>
          ) : students.length > 0 && gradeFilteredStudents.length === 0 ? (
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
              {/* Below md: one card per student instead of a table row. */}
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
                  <thead className="text-xs font-bold text-[var(--mws-muted)]">
                    <tr>
                      {canWrite ? (
                        <th className="w-10 px-2 py-2">
                          <input
                            type="checkbox"
                            aria-label="Select All Active Enrollments"
                            checked={allSelected}
                            disabled={selectableEnrollments.length === 0}
                            onChange={(event) => toggleAll(event.target.checked)}
                            className="h-4 w-4 accent-[var(--mws-burgundy)]"
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
                              setStudentSort({ sort_by, sort_order })
                            }
                          />
                          {isMixedClass ? (
                            <SortableHeader
                              label="Grade"
                              column="grade"
                              sortBy={studentSort.sort_by}
                              sortOrder={studentSort.sort_order}
                              onSort={(sort_by, sort_order) =>
                                setStudentSort({ sort_by, sort_order })
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
                            setStudentSort({ sort_by, sort_order })
                          }
                        />
                      </th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">SE Teacher</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedStudents.map((enrollment) => (
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
                                : "text-[var(--mws-charcoal)]",
                            )}
                          >
                            {enrollment.student.full_name}
                          </Link>
                          {isMixedClass ? (
                            <span className="block text-xs font-normal text-[var(--mws-muted)]">
                              {enrollment.grade_level}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">
                          {enrollment.student.nis || "-"}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge
                              variant="text"
                              tone={statusTone(enrollment.enrollment_status)}
                            >
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
                              <StatusBadge variant="text" tone="amber">
                                · Student inactive
                              </StatusBadge>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          {activeSupportQuery.isLoading ? (
                            <span className="text-[var(--mws-muted)]">…</span>
                          ) : activeSupportByStudentId.has(enrollment.student.id) ? (
                            <Link
                              to={`/employees/${activeSupportByStudentId.get(enrollment.student.id).id}`}
                              className="text-[var(--mws-charcoal)] hover:underline"
                            >
                              {
                                activeSupportByStudentId.get(enrollment.student.id)
                                  .full_name
                              }
                            </Link>
                          ) : (
                            <span className="text-[var(--mws-muted)]">
                              Not assigned
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {sortedStudents.length > STUDENT_PAGE_SIZE ? (
                <PaginationBar
                  paging={{
                    current_page: clampedStudentPage,
                    total_page: studentTotalPages,
                    total_item: sortedStudents.length,
                    size: STUDENT_PAGE_SIZE,
                  }}
                  itemLabel="students"
                  onPrevious={() =>
                    setStudentPage((page) => Math.max(page - 1, 1))
                  }
                  onNext={() =>
                    setStudentPage((page) =>
                      Math.min(page + 1, studentTotalPages),
                    )
                  }
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
            // includedRecords reflects the dialog's own Exclude toggles, not
            // necessarily every record in bulkDialog.records - always use
            // what the dialog actually confirmed.
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
          employees={
            bulkSeDialog.mode === "change"
              ? unitMatchedSpecialEducationTeachers.filter(
                  (employee) => !currentSeTeacherIdsForSelection.has(employee.id),
                )
              : unitMatchedSpecialEducationTeachers
          }
          studentName={`${selectedEnrollments.length} selected student(s)`}
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

// Mobile (<md) stand-in for one <tr> of the Students table.
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
    <div className="rounded-xl border border-[var(--mws-line)] bg-white p-4">
      <div className="flex items-start gap-3">
        {canWrite ? (
          <input
            type="checkbox"
            aria-label={`Select ${enrollment.student.full_name}`}
            checked={isSelected}
            onChange={(event) => onToggle(event.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--mws-burgundy)]"
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
                : "text-[var(--mws-charcoal)]",
            )}
          >
            {enrollment.student.full_name}
          </Link>
          <p className="text-xs text-[var(--mws-muted)]">
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
            <span className="text-xs text-[var(--mws-muted)]">SE Teacher:</span>
            {activeSupportQuery.isLoading ? (
              <span className="text-xs text-[var(--mws-muted)]">…</span>
            ) : supportEmployee ? (
              <Link
                to={`/employees/${supportEmployee.id}`}
                className="text-xs font-semibold text-[var(--mws-charcoal)] hover:underline"
              >
                {supportEmployee.full_name}
              </Link>
            ) : (
              <span className="text-xs text-[var(--mws-muted)]">
                Not assigned
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
