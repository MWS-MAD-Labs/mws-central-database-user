import {
  ClassTeacherRole,
  type AcademicYear,
  type Class,
  type ClassAdditionalGrade,
  type ClassTeacherAssignment,
  type ClassStatus,
  type Employee,
  type Grade,
  type Person,
  type Intern,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

// Auto-backfill creates one placeholder class per academic year and grade.
export const UNKNOWN_LEGACY_CLASS_PREFIX = "Unknown (Legacy Import)";

export const CLASS_SORT_FIELDS = [
  "name",
  "status",
  "created_at",
  "grade_level",
] as const;

export type ClassSortField = (typeof CLASS_SORT_FIELDS)[number];

export type CreateClassRequest = {
  name: string;
  grade_id: string;
  academic_year_id: string;
  status?: ClassStatus;
  capacity?: number;
  // Additional grades are only for mixed-age classes.
  additional_grade_ids?: string[];
};

export type UpdateClassRequest = {
  id: string;
  name?: string;
  grade_id?: string;
  academic_year_id?: string;
  status?: ClassStatus;
  capacity?: number | null;
  // Omitted leaves the existing set untouched; an empty array clears it
  // back to a normal single-grade class.
  additional_grade_ids?: string[];
  // Overrides active roster checks, but never the date boundary.
  confirm_unresolved_occupants?: boolean;
};

export type GetClassRequest = {
  id: string;
};

export type DeleteClassRequest = {
  id: string;
};

export type SearchClassRequest = {
  page: number;
  size: number;
  search?: string;
  grade_id?: string;
  academic_year_id?: string;
  status?: ClassStatus;
  sort_by?: ClassSortField;
  sort_order?: "asc" | "desc";
};

export type ClassWithRelations = Class & {
  grade: Grade & { unit?: { name: string } | null };
  academic_year: AcademicYear;
  teacher_assignments: (ClassTeacherAssignment & {
    employee: (Employee & { person: Person }) | null;
    intern?: Intern | null;
  })[];
  additional_grades: (ClassAdditionalGrade & { grade: Grade })[];
};

// Historical roster totals are grouped by exit reason.
export type ClassEnrollmentHistoryCounts = {
  transferred: number;
  withdrawn: number;
  completed: number;
};

export type ClassResponse = {
  id: string;
  name: string;
  grade: {
    id: string;
    name: string;
    level: number;
  };
  // Extra grades this class also accepts, beyond the primary grade above -
  // empty for a normal single-grade class. See ClassAdditionalGrade.
  additional_grades: {
    id: string;
    name: string;
    level: number;
  }[];
  academic_year: {
    id: string;
    name: string;
    status: AcademicYear["status"];
    start_date: string;
    end_date: string | null;
  };
  homeroom_teachers: {
    id: string;
    workforce_member: WorkforceMemberResponse;
  }[];
  supporting_homeroom_teachers: {
    id: string;
    workforce_member: WorkforceMemberResponse;
  }[];
  // Subject teachers are not capped per class.
  subject_teachers: {
    id: string;
    subject: string | null;
    workforce_member: WorkforceMemberResponse;
  }[];
  status: ClassStatus;
  capacity: number | null;
  active_enrollment_count: number;
  enrollment_history_counts: ClassEnrollmentHistoryCounts;
  // Any current student or enrollment history blocks class deletion.
  has_dependents: boolean;
  created_at: string;
  updated_at: string;
};

export function toClassResponse(
  klass: ClassWithRelations,
  activeEnrollmentCount = 0,
  enrollmentHistoryCounts: ClassEnrollmentHistoryCounts = {
    transferred: 0,
    withdrawn: 0,
    completed: 0,
  },
  hasDependents = false,
): ClassResponse {
  const now = new Date();
  const currentAssignments = klass.teacher_assignments.filter(
    (assignment) => !assignment.end_date || assignment.end_date > now,
  );
  return {
    id: klass.id,
    name: klass.name,
    grade: {
      id: klass.grade.id,
      name: klass.grade.name,
      level: klass.grade.level,
    },
    additional_grades: klass.additional_grades.map((entry) => ({
      id: entry.grade.id,
      name: entry.grade.name,
      level: entry.grade.level,
    })),
    academic_year: {
      id: klass.academic_year.id,
      name: klass.academic_year.name,
      status: klass.academic_year.status,
      start_date: klass.academic_year.start_date.toISOString(),
      end_date: klass.academic_year.end_date?.toISOString() ?? null,
    },
    homeroom_teachers: currentAssignments
      .filter((assignment) => assignment.role === ClassTeacherRole.HOMEROOM)
      .map((assignment) => ({
        id: assignment.id,
        workforce_member: toWorkforceMemberResponse(assignment),
      })),
    supporting_homeroom_teachers: currentAssignments
      .filter(
        (assignment) => assignment.role === ClassTeacherRole.SUPPORTING_HOMEROOM,
      )
      .map((assignment) => ({
        id: assignment.id,
        workforce_member: toWorkforceMemberResponse(assignment),
      })),
    subject_teachers: currentAssignments
      .filter(
        (assignment) => assignment.role === ClassTeacherRole.SUBJECT_TEACHER,
      )
      .map((assignment) => ({
        id: assignment.id,
        subject: assignment.subject,
        workforce_member: toWorkforceMemberResponse(assignment),
      })),
    status: klass.status,
    capacity: klass.capacity,
    active_enrollment_count: activeEnrollmentCount,
    enrollment_history_counts: enrollmentHistoryCounts,
    has_dependents: hasDependents,
    created_at: klass.created_at.toISOString(),
    updated_at: klass.updated_at.toISOString(),
  };
}

export function toClassAuditSnapshot(klass: Class): AuditValue {
  return {
    name: klass.name,
    grade_id: klass.grade_id,
    academic_year_id: klass.academic_year_id,
    status: klass.status,
    capacity: klass.capacity,
  };
}

export type AssignClassTeacherRequest = {
  class_id: string;
  employee_id?: string;
  intern_id?: string;
  role: ClassTeacherRole;
  subject?: string;
  start_date?: string;
};

export type SearchClassTeacherCandidatesRequest = {
  class_id: string;
  page: number;
  size: number;
  search?: string;
  role: ClassTeacherRole;
};

export type ClassTeacherCandidateResponse = {
  id: string;
  type: "EMPLOYEE" | "INTERN";
  employee_id: string | null;
  full_name: string;
  email: string;
  unit_id: string;
  job_position: string;
};

export type UpdateClassTeacherAssignmentStartDateRequest = {
  id: string;
  class_id: string;
  start_date: string;
};

export type BulkUpdateClassTeacherAssignmentStartDateRequest = {
  class_id: string;
  assignment_ids: string[];
  start_date: string;
};

export type EndClassTeacherAssignmentRequest = {
  id: string;
  class_id: string;
  // Defaults to today but accepts a backdated assignment end.
  end_date?: string;
};

export type RemoveClassTeacherAssignmentRequest = {
  id: string;
  class_id: string;
};

export type ReopenClassTeacherAssignmentRequest = {
  id: string;
  class_id: string;
};

// Moving assignments revalidates each teacher against the target class.
export type BulkMoveClassTeacherAssignmentRequest = {
  class_id: string;
  assignment_ids: string[];
  target_class_id: string;
};

export type BulkEndClassTeacherAssignmentRequest = {
  class_id: string;
  assignment_ids: string[];
  // Same end date applied to every selected assignment; defaults to today.
  end_date?: string;
};

export type BulkRemoveClassTeacherAssignmentRequest = {
  class_id: string;
  assignment_ids: string[];
};

export type BulkReopenClassTeacherAssignmentRequest = {
  class_id: string;
  assignment_ids: string[];
};

export type ClassTeacherAssignmentWithEmployee = ClassTeacherAssignment & {
  employee:
    | (Employee & {
        person: Person;
        unit?: { name: string } | null;
        job_position?: { name: string } | null;
      })
    | null;
  intern?:
    | (Intern & {
        unit?: { name: string } | null;
        job_position?: { name: string } | null;
      })
    | null;
};

export type ClassTeacherAssignmentResponse = {
  id: string;
  workforce_member: {
    id: string;
    type: "EMPLOYEE" | "INTERN";
    employee_id?: string;
    full_name: string;
  };
  employee: {
    id: string;
    employee_id: string;
    full_name: string;
  };
  job_position_name: string | null;
  unit_name: string | null;
  role: ClassTeacherRole;
  subject: string | null;
  start_date: string;
  end_date: string | null;
};

export type WorkforceMemberResponse = {
  id: string;
  type: "EMPLOYEE" | "INTERN";
  employee_id?: string;
  full_name: string;
};

export function toClassTeacherAssignmentResponse(
  assignment: ClassTeacherAssignmentWithEmployee,
): ClassTeacherAssignmentResponse {
  return {
    id: assignment.id,
    workforce_member: assignment.employee
      ? {
          id: assignment.employee.id,
          type: "EMPLOYEE",
          employee_id: assignment.employee.employee_id,
          full_name: assignment.employee.person.full_name,
        }
      : {
          id: assignment.intern!.id,
          type: "INTERN",
          full_name: assignment.intern!.full_name,
        },
    employee: assignment.employee
      ? {
          id: assignment.employee.id,
          employee_id: assignment.employee.employee_id,
          full_name: assignment.employee.person.full_name,
        }
      : {
          id: assignment.intern!.id,
          employee_id: "",
          full_name: assignment.intern!.full_name,
        },
    job_position_name:
      assignment.employee?.job_position?.name ?? assignment.intern?.job_position?.name ?? null,
    unit_name: assignment.employee?.unit?.name ?? assignment.intern?.unit?.name ?? null,
    role: assignment.role,
    subject: assignment.subject,
    start_date: assignment.start_date.toISOString(),
    end_date: assignment.end_date ? assignment.end_date.toISOString() : null,
  };
}

function toWorkforceMemberResponse(
  assignment: ClassTeacherAssignmentWithEmployee,
): WorkforceMemberResponse {
  if (assignment.employee) {
    return { id: assignment.employee.id, type: "EMPLOYEE", employee_id: assignment.employee.employee_id, full_name: assignment.employee.person.full_name };
  }
  if (assignment.intern) {
    return { id: assignment.intern.id, type: "INTERN", full_name: assignment.intern.full_name };
  }
  throw new Error("Class teacher assignment has no workforce member");
}

// Reverse direction of ClassTeacherAssignmentResponse - "which classes has
// this employee taught", for the employee detail page's history panel.
export type ClassTeacherAssignmentWithClass = ClassTeacherAssignment & {
  class: Class & { grade: Grade; academic_year: AcademicYear };
};

export type EmployeeTeachingAssignmentResponse = {
  id: string;
  class: { id: string; name: string };
  academic_year: { id: string; name: string };
  grade: string;
  role: ClassTeacherRole;
  subject: string | null;
  start_date: string;
  end_date: string | null;
};

export function toEmployeeTeachingAssignmentResponse(
  assignment: ClassTeacherAssignmentWithClass,
): EmployeeTeachingAssignmentResponse {
  return {
    id: assignment.id,
    class: { id: assignment.class.id, name: assignment.class.name },
    academic_year: {
      id: assignment.class.academic_year.id,
      name: assignment.class.academic_year.name,
    },
    grade: assignment.class.grade.name,
    role: assignment.role,
    subject: assignment.subject,
    start_date: assignment.start_date.toISOString(),
    end_date: assignment.end_date ? assignment.end_date.toISOString() : null,
  };
}
