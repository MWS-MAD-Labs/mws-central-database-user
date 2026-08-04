import type {
  AcademicYear,
  Class,
  ClassTeacherAssignment,
  ClassTeacherRole,
  ClassStatus,
  Employee,
  Grade,
  Person,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

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
  homeroom_teacher_id?: string;
  status?: ClassStatus;
  capacity?: number;
};

export type UpdateClassRequest = {
  id: string;
  name?: string;
  grade_id?: string;
  academic_year_id?: string;
  homeroom_teacher_id?: string | null;
  status?: ClassStatus;
  capacity?: number | null;
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
};

export type ClassResponse = {
  id: string;
  name: string;
  grade: {
    id: string;
    name: string;
    level: number;
  };
  academic_year: {
    id: string;
    name: string;
    status: AcademicYear["status"];
  };
  homeroom_teacher_id: string | null;
  status: ClassStatus;
  capacity: number | null;
  active_enrollment_count: number;
  created_at: string;
  updated_at: string;
};

export function toClassResponse(
  klass: ClassWithRelations,
  activeEnrollmentCount = 0,
): ClassResponse {
  return {
    id: klass.id,
    name: klass.name,
    grade: {
      id: klass.grade.id,
      name: klass.grade.name,
      level: klass.grade.level,
    },
    academic_year: {
      id: klass.academic_year.id,
      name: klass.academic_year.name,
      status: klass.academic_year.status,
    },
    homeroom_teacher_id: klass.homeroom_teacher_id,
    status: klass.status,
    capacity: klass.capacity,
    active_enrollment_count: activeEnrollmentCount,
    created_at: klass.created_at.toISOString(),
    updated_at: klass.updated_at.toISOString(),
  };
}

export function toClassAuditSnapshot(klass: Class): AuditValue {
  return {
    name: klass.name,
    grade_id: klass.grade_id,
    academic_year_id: klass.academic_year_id,
    homeroom_teacher_id: klass.homeroom_teacher_id,
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
