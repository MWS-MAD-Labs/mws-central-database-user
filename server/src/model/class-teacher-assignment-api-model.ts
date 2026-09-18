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
    additional_grades: { grade: { name: string } }[];
  };
  employee: { id: string; person: { email: string } };
};

// Minimal active class assignment data for external consumers.
export type ClassTeacherAssignmentResponse = {
  class_id: string;
  class_name: string;
  grade_name: string;
  // Include every grade taught by mixed-age classes.
  additional_grade_names: string[];
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
    additional_grade_names: assignment.class.additional_grades.map(
      (entry) => entry.grade.name,
    ),
    unit_name: assignment.class.grade.unit?.name ?? null,
    role: assignment.role,
    subject: assignment.subject,
    employee_id: assignment.employee.id,
    employee_email: assignment.employee.person.email,
  };
}
