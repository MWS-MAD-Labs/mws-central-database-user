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
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

// A "Class not on file" placeholder, scoped per (academic year, grade) -
// created on demand by EnrollmentService's PSB auto-backfill chain (see
// resolveUnknownLegacyClass in enrollment-service.ts) for a year/grade pair
// nothing recorded a real class for. Lives here (not in enrollment-service.ts)
// so student-service.ts can also check for it without a circular import -
// enrollment-service.ts itself imports from student-service.ts.
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
  // Extra grades this class also accepts on top of grade_id - only for a
  // genuinely mixed-age class (e.g. a Kindergarten section teaching
  // Pre-K/K1/K2 together). Omit for a normal single-grade class.
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
  // Overrides the soft block on leaving ACTIVE while students/teachers are
  // still actively enrolled/assigned (see ClassService.update). Has no
  // effect on the separate hard date block, which never accepts an override.
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
  grade: Grade;
  academic_year: AcademicYear;
  teacher_assignments: (ClassTeacherAssignment & {
    employee: Employee & { person: Person };
  })[];
  additional_grades: (ClassAdditionalGrade & { grade: Grade })[];
};

// Everyone who has left this class's active roster, broken out by why -
// shown alongside active_enrollment_count so a class showing few/no active
// students doesn't read as if it never had any (see ClassesPanel.jsx).
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
  };
  homeroom_teachers: {
    id: string;
    employee: { id: string; employee_id: string; full_name: string };
  }[];
  supporting_homeroom_teachers: {
    id: string;
    employee: { id: string; employee_id: string; full_name: string };
  }[];
  // Not capped per class (unlike homeroom/supporting-homeroom) - a class
  // can have several. ClassesPanel.jsx shows these as a count badge with a
  // tooltip rather than listing every name inline, to keep the row height
  // predictable regardless of how many get assigned.
  subject_teachers: {
    id: string;
    subject: string | null;
    employee: { id: string; employee_id: string; full_name: string };
  }[];
  status: ClassStatus;
  capacity: number | null;
  active_enrollment_count: number;
  enrollment_history_counts: ClassEnrollmentHistoryCounts;
  // True when deleting this class would be rejected server-side (see
  // ClassService.remove) - a student currently assigned or any enrollment
  // row (including soft-deleted ones, which still hold the FK) referencing
  // it. Lets ClassesPanel.jsx disable the delete button up front instead of
  // sending a request that's guaranteed to 400.
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
    },
    homeroom_teachers: klass.teacher_assignments
      .filter((assignment) => assignment.role === ClassTeacherRole.HOMEROOM)
      .map((assignment) => ({
        id: assignment.id,
        employee: {
          id: assignment.employee.id,
          employee_id: assignment.employee.employee_id,
          full_name: assignment.employee.person.full_name,
        },
      })),
    supporting_homeroom_teachers: klass.teacher_assignments
      .filter(
        (assignment) => assignment.role === ClassTeacherRole.SUPPORTING_HOMEROOM,
      )
      .map((assignment) => ({
        id: assignment.id,
        employee: {
          id: assignment.employee.id,
          employee_id: assignment.employee.employee_id,
          full_name: assignment.employee.person.full_name,
        },
      })),
    subject_teachers: klass.teacher_assignments
      .filter(
        (assignment) => assignment.role === ClassTeacherRole.SUBJECT_TEACHER,
      )
      .map((assignment) => ({
        id: assignment.id,
        subject: assignment.subject,
        employee: {
          id: assignment.employee.id,
          employee_id: assignment.employee.employee_id,
          full_name: assignment.employee.person.full_name,
        },
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
  employee_id: string;
  role: ClassTeacherRole;
  subject?: string;
};

export type EndClassTeacherAssignmentRequest = {
  id: string;
  class_id: string;
  // Defaults to today when omitted - lets an admin backdate ending an
  // assignment when they're recording it after the fact, not on the actual
  // day it happened.
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

// Moves a set of this class's teacher assignments to another class (e.g.
// "same grade, next academic year") - each one is ended here and
// re-created fresh on target_class_id with the same role/subject, going
// through the exact same checks as a normal single assign (unit match,
// Homeroom Teacher position, capacity, etc.), so an assignment that
// wouldn't be allowed to start fresh on the target class doesn't get a
// free pass just because it's a "move".
export type BulkMoveClassTeacherAssignmentRequest = {
  class_id: string;
  assignment_ids: string[];
  target_class_id: string;
};

export type ClassTeacherAssignmentWithEmployee = ClassTeacherAssignment & {
  employee: Employee & { person: Person };
};

export type ClassTeacherAssignmentResponse = {
  id: string;
  employee: {
    id: string;
    employee_id: string;
    full_name: string;
  };
  role: ClassTeacherRole;
  subject: string | null;
  start_date: string;
  end_date: string | null;
};

export function toClassTeacherAssignmentResponse(
  assignment: ClassTeacherAssignmentWithEmployee,
): ClassTeacherAssignmentResponse {
  return {
    id: assignment.id,
    employee: {
      id: assignment.employee.id,
      employee_id: assignment.employee.employee_id,
      full_name: assignment.employee.person.full_name,
    },
    role: assignment.role,
    subject: assignment.subject,
    start_date: assignment.start_date.toISOString(),
    end_date: assignment.end_date ? assignment.end_date.toISOString() : null,
  };
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
