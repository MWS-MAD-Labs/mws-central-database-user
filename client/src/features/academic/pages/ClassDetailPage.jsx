import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
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
import { Field, SearchableSelect, TextInput } from "../../../components/ui/FormControls.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { employeesApi } from "../../employees/api/employeesApi.js";
import { jobLevelsApi } from "../../master-data/api/masterDataApi.js";
import { studentSensitiveApi } from "../../students/api/studentSensitiveApi.js";
import { studentsApi } from "../../students/api/studentsApi.js";
import {
  academicYearsApi,
  classesApi,
  enrollmentsApi,
  gradesApi,
} from "../api/academicApi.js";
import { EnrollmentDialog } from "../components/EnrollmentDialog.jsx";
import { TeacherAssignmentsSection } from "../components/TeacherAssignmentsSection.jsx";
import {
  cleanPayload,
  dateInputFromIso,
  isoFromDateInput,
} from "../../../lib/form.js";
import { formatStatus, statusTone } from "../../../lib/format.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";

export function ClassDetailPage() {
  const { classId } = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [enrollFormOpen, setEnrollFormOpen] = useState(false);
  const [enrollForm, setEnrollForm] = useState({
    student_id: "",
    start_date: "",
  });

  const classQuery = useQuery({
    queryKey: ["classes", classId],
    queryFn: () => classesApi.get(classId),
    enabled: Boolean(classId),
  });

  // ClassResponse.academic_year is intentionally minimal ({id, name,
  // status}, no start_date) - fetch the full year separately, same pattern
  // AcademicPage's EnrollmentDialog uses, to default the enroll form's
  // start date to the year's actual start.
  const academicYearQuery = useQuery({
    queryKey: ["academic-years", classQuery.data?.academic_year?.id],
    queryFn: () => academicYearsApi.get(classQuery.data.academic_year.id),
    enabled: Boolean(classQuery.data?.academic_year?.id),
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
  // years (for the bulk promote/transfer dialog's target-class picker) -
  // same shapes useClassOptionsQuery()/useEnrollmentOptionsQuery() build on
  // AcademicPage, combined here since this page needs both.
  const optionsQuery = useQuery({
    queryKey: ["class-detail-options"],
    queryFn: async () => {
      const [grades, employees, jobLevels, classes, academicYears] =
        await Promise.all([
          gradesApi.list({ page: 1, size: 100 }),
          employeesApi.list({ page: 1, size: 100, status: "ACTIVE" }),
          jobLevelsApi.list({ page: 1, size: 100 }),
          classesApi.list({ page: 1, size: 100, status: "ACTIVE" }),
          academicYearsApi.list({
            page: 1,
            size: 100,
            sort_by: "start_date",
            sort_order: "desc",
          }),
        ]);
      const teachingLevelNames = new Set(
        (jobLevels.data || [])
          .filter((level) => level.is_teaching_role)
          .map((level) => level.name),
      );
      const unitIdByGradeId = new Map(
        (grades.data || []).map((grade) => [grade.id, grade.unit_id]),
      );
      return {
        grades: grades.data || [],
        teachingEmployees: (employees.data || []).filter((employee) =>
          teachingLevelNames.has(employee.employment.job_level),
        ),
        classes: classes.data || [],
        unitIdByGradeId,
        academicYears: academicYears.data || [],
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

  // Same REGISTERED/ACTIVE-in-this-grade pool AcademicPage's Enrollment
  // "create" flow uses - only fetched once a grade is known.
  const eligibleStudentsQuery = useQuery({
    queryKey: ["class-detail-eligible-students", klass?.grade?.id],
    enabled: Boolean(klass?.grade?.id),
    queryFn: async () => {
      const [registered, active] = await Promise.all([
        studentsApi.list({
          page: 1,
          size: 100,
          current_grade_id: klass.grade.id,
          status: "REGISTERED",
        }),
        studentsApi.list({
          page: 1,
          size: 100,
          current_grade_id: klass.grade.id,
          status: "ACTIVE",
        }),
      ]);
      return dedupeStudents([
        ...(registered.data || []),
        ...(active.data || []),
      ]);
    },
  });

  const enrollMutation = useMutation({
    mutationFn: ({ studentId, payload }) =>
      enrollmentsApi.create(studentId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["enrollments", { class_id: classId }],
      });
      queryClient.invalidateQueries({ queryKey: ["classes", classId] });
      queryClient.invalidateQueries({
        queryKey: ["support-assignments", "active-student-ids"],
      });
      queryClient.invalidateQueries({
        queryKey: ["class-detail-eligible-students"],
      });
      setEnrollForm({ student_id: "", start_date: "" });
      setEnrollFormOpen(false);
    },
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

  function openEnrollForm() {
    setEnrollForm({
      student_id: "",
      start_date: dateInputFromIso(academicYearQuery.data?.start_date) || "",
    });
    setEnrollFormOpen(true);
  }

  function submitEnroll(event) {
    event.preventDefault();
    if (!enrollForm.student_id) return;
    enrollMutation.mutate({
      studentId: enrollForm.student_id,
      payload: cleanPayload({
        class_id: classId,
        academic_year_id: klass?.academic_year?.id,
        start_date: isoFromDateInput(enrollForm.start_date),
      }),
    });
  }

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
          <Button asChild variant="secondary">
            <Link to="/academic?tab=classes">
              <ArrowLeft size={16} />
              Back
            </Link>
          </Button>
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
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-[var(--mws-charcoal)]">
            <GraduationCap size={18} />
            Teachers
          </h2>
          <TeacherAssignmentsSection
            standalone
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
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-[var(--mws-charcoal)]">
            <Users size={18} />
            Students
          </h2>
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

          {canWrite ? (
            <div className="mt-6 border-t border-[var(--mws-line)] pt-6">
              <div className="flex justify-end">
                <Button type="button" variant="secondary" onClick={openEnrollForm}>
                  <Plus size={16} />
                  Enroll student
                </Button>
              </div>
              {enrollFormOpen ? (
                <form
                  onSubmit={submitEnroll}
                  className="mt-3 grid gap-3 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-4 md:grid-cols-2"
                >
                  <Field label="Student">
                    <SearchableSelect
                      required
                      value={enrollForm.student_id}
                      onChange={(value) =>
                        setEnrollForm({ ...enrollForm, student_id: value })
                      }
                      options={studentSelectOptions(
                        eligibleStudentsQuery.data || [],
                      )}
                      placeholder="Select student"
                      searchPlaceholder="Search students"
                    />
                  </Field>
                  <Field label="Start date">
                    <TextInput
                      required
                      type="date"
                      value={enrollForm.start_date}
                      onChange={(event) =>
                        setEnrollForm({
                          ...enrollForm,
                          start_date: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <div className="md:col-span-2">
                    <Button
                      type="submit"
                      disabled={
                        enrollMutation.isPending || !enrollForm.student_id
                      }
                    >
                      <Plus size={16} />
                      Enroll
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

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

function dedupeStudents(students) {
  const byId = new Map();
  students.forEach((student) => {
    byId.set(student.id, student);
  });
  return Array.from(byId.values()).sort((left, right) =>
    left.identity.full_name.localeCompare(right.identity.full_name),
  );
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
