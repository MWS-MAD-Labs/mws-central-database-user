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
    academic_year: { id: string; name: string; start_date: Date; end_date: Date | null };
  };
  employee: {
    id: string;
    employee_id: string;
    unit: { name: string };
    job_position: { name: string };
    person: { full_name: string; email: string };
  } | null;
  intern: {
    id: string;
    full_name: string;
    email: string;
    unit: { name: string };
    job_position: { name: string };
  } | null;
};

export type ClassTeacherWorkforceMemberResponse = {
  type: "EMPLOYEE" | "INTERN";
  id: string;
  member_id: string;
  full_name: string;
  email: string;
  unit_name: string;
  job_position: string;
  employee_id: string | null;
};

// Minimal active class assignment data for external consumers.
export type ClassTeacherAssignmentResponse = {
  class_id: string;
  class_name: string;
  grade_name: string;
  // Include every grade taught by mixed-age classes.
  additional_grade_names: string[];
  unit_name: string | null;
  academic_year_id: string;
  academic_year: string;
  academic_year_start_date: string;
  academic_year_end_date: string | null;
  role: ClassTeacherRole;
  subject: string | null;
  workforce_member: ClassTeacherWorkforceMemberResponse;
  // Compatibility fields for existing employee-only consumers.
  employee_id: string | null;
  employee_email: string | null;
};

export function toClassTeacherAssignmentResponse(
  assignment: ClassTeacherAssignmentWithRelations,
): ClassTeacherAssignmentResponse {
  const workforceMember: ClassTeacherWorkforceMemberResponse = assignment.employee
    ? {
        type: "EMPLOYEE",
        id: assignment.employee.id,
        member_id: assignment.employee.id,
        full_name: assignment.employee.person.full_name,
        email: assignment.employee.person.email,
        unit_name: assignment.employee.unit.name,
        job_position: assignment.employee.job_position.name,
        employee_id: assignment.employee.employee_id,
      }
    : {
        type: "INTERN",
        id: assignment.intern!.id,
        member_id: assignment.intern!.id,
        full_name: assignment.intern!.full_name,
        email: assignment.intern!.email,
        unit_name: assignment.intern!.unit.name,
        job_position: assignment.intern!.job_position.name,
        employee_id: null,
      };

  return {
    class_id: assignment.class.id,
    class_name: assignment.class.name,
    grade_name: assignment.class.grade.name,
    additional_grade_names: assignment.class.additional_grades.map(
      (entry) => entry.grade.name,
    ),
    unit_name: assignment.class.grade.unit?.name ?? null,
    academic_year_id: assignment.class.academic_year.id,
    academic_year: assignment.class.academic_year.name,
    academic_year_start_date: new Date(assignment.class.academic_year.start_date).toISOString().slice(0, 10),
    academic_year_end_date: assignment.class.academic_year.end_date ? new Date(assignment.class.academic_year.end_date).toISOString().slice(0, 10) : null,
    role: assignment.role,
    subject: assignment.subject,
    workforce_member: workforceMember,
    employee_id: assignment.employee?.id ?? null,
    employee_email: assignment.employee?.person.email ?? null,
  };
}
