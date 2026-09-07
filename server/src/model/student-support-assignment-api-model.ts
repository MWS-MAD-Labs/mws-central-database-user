import type { StudentSupportRole } from "../generated/prisma/client";

export type StudentSupportAssignmentListRequest = {
  page: number;
  size: number;
};

export type StudentSupportAssignmentWithRelations = {
  id: string;
  role: StudentSupportRole;
  employee: { id: string; person: { email: string } };
  student: { id: string; person: { email: string } };
};

// Deliberately leaner than admin-facing support-assignment data - a
// consuming app (e.g. MTSS scoping an SE teacher's own roster) only needs
// enough to answer "which students' emails does this SE teacher's email
// map to", not notes/timeline details.
export type StudentSupportAssignmentResponse = {
  employee_id: string;
  employee_email: string;
  student_id: string;
  student_email: string;
  role: StudentSupportRole;
};

export function toStudentSupportAssignmentResponse(
  assignment: StudentSupportAssignmentWithRelations,
): StudentSupportAssignmentResponse {
  return {
    employee_id: assignment.employee.id,
    employee_email: assignment.employee.person.email,
    student_id: assignment.student.id,
    student_email: assignment.student.person.email,
    role: assignment.role,
  };
}
