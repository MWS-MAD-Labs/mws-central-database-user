import type { ClassTeacherRole } from "../generated/prisma/client";

export type ClassTeacherAssignmentListRequest = {
  page: number;
  size: number;
};

export type ClassTeacherAssignmentWithRelations = {
  id: string;
  role: ClassTeacherRole;
  subject: string | null;
  class: {
    id: string;
    name: string;
    grade: { name: string; unit: { name: string } | null };
  };
  employee: { id: string; person: { email: string } };
};

// Deliberately leaner than admin-facing class data - a consuming app only
// needs enough to answer "which real classes does this teacher's email
// belong to", not enrollment/capacity/status details.
export type ClassTeacherAssignmentResponse = {
  class_id: string;
  class_name: string;
  grade_name: string;
  unit_name: string | null;
  role: ClassTeacherRole;
  subject: string | null;
  employee_id: string;
  employee_email: string;
};

export function toClassTeacherAssignmentResponse(
  assignment: ClassTeacherAssignmentWithRelations,
): ClassTeacherAssignmentResponse {
  return {
    class_id: assignment.class.id,
    class_name: assignment.class.name,
    grade_name: assignment.class.grade.name,
    unit_name: assignment.class.grade.unit?.name ?? null,
    role: assignment.role,
    subject: assignment.subject,
    employee_id: assignment.employee.id,
    employee_email: assignment.employee.person.email,
  };
}
