import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Edit,
  GraduationCap,
  LogOut,
  Plus,
  Repeat,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { BulkActionBar } from "../../../components/ui/BulkActionBar.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { employeesApi } from "../../employees/api/employeesApi.js";
import { jobLevelsApi } from "../../master-data/api/masterDataApi.js";
import { studentSensitiveApi } from "../../students/api/studentSensitiveApi.js";
import {
  academicYearsApi,
  classesApi,
  enrollmentsApi,
  gradesApi,
} from "../api/academicApi.js";
import { ClassDialog } from "../components/ClassDialog.jsx";
import { EnrollmentDialog } from "../components/EnrollmentDialog.jsx";
import { TeacherAssignmentsSection } from "../components/TeacherAssignmentsSection.jsx";
import { formatStatus, statusTone } from "../../../lib/format.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";

export function ClassDetailPage() {
  const { classId } = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

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
          classesApi.list({ page: 1, size: 100, status: "ACTIVE" }),
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
          showErrorToast(`${data.failed_count} student(s) failed to enroll.`);
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
        showErrorToast(`${result.failed_count} student(s) failed to promote.`);
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
        showSuccessToast(`${result.success_count} student(s) transferred.`);
      }
      if (result.failed_count > 0) {
        showErrorToast(
          `${result.failed_count} student(s) failed to transfer.`,
        );
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
        showErrorToast(`${result.failed_count} enrollment(s) failed to close.`);
      }
    },
  });

  const selectableEnrollments = students.filter(
    (enrollment) => enrollment.enrollment_status === "ACTIVE",
  );
  const selectedEnrollments = selectableEnrollments.filter((enrollment) =>
    selectedEnrollmentIds.has(enrollment.id),
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
            onAssign={(payload) => assignTeacherMutation.mutate(payload)}
            onEnd={(assignmentId) =>
              endTeacherAssignmentMutation.mutate(assignmentId)
            }
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
                variant="secondary"
                disabled={optionsQuery.isLoading}
                onClick={() => setEnrollDialogOpen(true)}
              >
                <Plus size={16} />
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
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      setBulkDialog({
                        mode: "bulk-promote",
                        records: selectedEnrollments,
                      })
                    }
                  >
                    <GraduationCap size={15} />
                    Promote
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      setBulkDialog({
                        mode: "bulk-transfer",
                        records: selectedEnrollments,
                      })
                    }
                  >
                    <Repeat size={15} />
                    Transfer
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      setBulkDialog({
                        mode: "bulk-close",
                        records: selectedEnrollments,
                      })
                    }
                  >
                    <LogOut size={15} />
                    Close
                  </Button>
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
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">NIS</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">SE Teacher</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((enrollment) => (
                    <tr
                      key={enrollment.id}
                      className="border-t border-[var(--mws-line)]"
                    >
                      {canWrite ? (
                        <td className="px-2 py-2">
                          {enrollment.enrollment_status === "ACTIVE" ? (
                            <input
                              type="checkbox"
                              aria-label={`Select ${enrollment.student.full_name}`}
                              checked={selectedEnrollmentIds.has(enrollment.id)}
                              onChange={(event) =>
                                toggleOne(enrollment.id, event.target.checked)
                              }
                              className="h-4 w-4 accent-[var(--mws-burgundy)]"
                            />
                          ) : null}
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
                        <StatusBadge tone={statusTone(enrollment.enrollment_status)}>
                          {formatStatus(enrollment.enrollment_status)}
                        </StatusBadge>
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
    </div>
  );
}
