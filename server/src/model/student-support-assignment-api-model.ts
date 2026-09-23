import type { StudentSupportRole } from "../generated/prisma/client";

export type StudentSupportAssignmentListRequest = {
  page: number;
  size: number;
};

export type StudentSupportAssignmentWithRelations = {
  id: string;
  role: StudentSupportRole;
  employee: { id: string; employee_id: string; person: { full_name: string; email: string } } | null;
  intern: { id: string; full_name: string; email: string } | null;
  student: { id: string; person: { email: string } };
};

// Minimal active support assignment data for external consumers.
export type StudentSupportAssignmentResponse = {
  workforce_member: {
    type: "EMPLOYEE" | "INTERN";
    id: string;
    member_id: string;
    full_name: string;
    email: string;
    employee_id: string | null;
  };
  employee_id: string | null;
  employee_email: string | null;
  student_id: string;
  student_email: string;
  role: StudentSupportRole;
};

export function toStudentSupportAssignmentResponse(
  assignment: StudentSupportAssignmentWithRelations,
): StudentSupportAssignmentResponse {
  const workforceMember = assignment.employee
    ? {
        type: "EMPLOYEE" as const,
        id: assignment.employee.id,
        member_id: assignment.employee.id,
        full_name: assignment.employee.person.full_name,
        email: assignment.employee.person.email,
        employee_id: assignment.employee.employee_id,
      }
    : {
        type: "INTERN" as const,
        id: assignment.intern!.id,
        member_id: assignment.intern!.id,
        full_name: assignment.intern!.full_name,
        email: assignment.intern!.email,
        employee_id: null,
      };
  return {
    workforce_member: workforceMember,
    employee_id: assignment.employee?.id ?? null,
    employee_email: assignment.employee?.person.email ?? null,
    student_id: assignment.student.id,
    student_email: assignment.student.person.email,
    role: assignment.role,
  };
}
