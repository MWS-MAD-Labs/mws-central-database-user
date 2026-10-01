import type {
  Employee,
  Intern,
  Person,
  Student,
  StudentSupportAssignment,
  StudentSupportRole,
} from "../generated/prisma/client";

export type AssignStudentSupportRequest = {
  student_id: string;
  employee_id?: string;
  intern_id?: string;
  role: StudentSupportRole;
  notes?: string;
};

export type EndStudentSupportAssignmentRequest = {
  id: string;
  student_id: string;
};

export type RemoveStudentSupportAssignmentRequest = {
  id: string;
  student_id: string;
};

export type ReactivateStudentSupportAssignmentRequest = {
  id: string;
  student_id: string;
};

export type GetStudentSupportAssignmentsRequest = {
  student_id: string;
};

export type GetEmployeeSupportAssignmentsRequest = {
  employee_id: string;
};

export type GetInternSupportAssignmentsRequest = {
  intern_id: string;
};

export type SupportWorkforceMemberResponse = {
  id: string;
  type: "EMPLOYEE" | "INTERN";
  employee_id: string | null;
  full_name: string;
  email: string;
};

export type GetActiveSupportStudentIdsRequest = {
  student_ids: string[];
};

// Include the current assignee, not only assignment status.
export type ActiveSupportStudentEntry = {
  student_id: string;
  workforce_member: SupportWorkforceMemberResponse;
  employee: { id: string; full_name: string } | null;
};

// Active Special Education caseload per employee.
export type SupportAssignmentCaseloadEntry = {
  member_type: "EMPLOYEE" | "INTERN";
  member_id: string;
  employee_id: string | null;
  intern_id: string | null;
  active_student_count: number;
};

export type SearchSupportAssignmentCandidatesRequest = {
  page: number;
  size: number;
  search?: string;
  unit_id?: string;
};

export type SupportAssignmentCandidateResponse = SupportWorkforceMemberResponse & {
  unit_id: string;
  job_position: string;
  active_student_count: number;
};

export type StudentSupportAssignmentWithEmployee = StudentSupportAssignment & {
  employee: (Employee & { person: Person }) | null;
  intern: Intern | null;
};

export type StudentSupportAssignmentResponse = {
  id: string;
  employee: {
    id: string;
    employee_id: string;
    full_name: string;
  } | null;
  workforce_member: SupportWorkforceMemberResponse;
  role: StudentSupportRole;
  notes: string | null;
  start_date: string;
  end_date: string | null;
};

export function toStudentSupportAssignmentResponse(
  assignment: StudentSupportAssignmentWithEmployee,
): StudentSupportAssignmentResponse {
  const workforceMember: SupportWorkforceMemberResponse = assignment.employee
    ? {
        id: assignment.employee.id,
        type: "EMPLOYEE",
        employee_id: assignment.employee.employee_id,
        full_name: assignment.employee.person.full_name,
        email: assignment.employee.person.email,
      }
    : {
        id: assignment.intern!.id,
        type: "INTERN",
        employee_id: null,
        full_name: assignment.intern!.full_name,
        email: assignment.intern!.email,
      };

  return {
    id: assignment.id,
    employee: assignment.employee
      ? {
          id: assignment.employee.id,
          employee_id: assignment.employee.employee_id,
          full_name: assignment.employee.person.full_name,
        }
      : null,
    workforce_member: workforceMember,
    role: assignment.role,
    notes: assignment.notes,
    start_date: assignment.start_date.toISOString(),
    end_date: assignment.end_date ? assignment.end_date.toISOString() : null,
  };
}

export type StudentSupportAssignmentWithStudent = StudentSupportAssignment & {
  student: Student & { person: Person };
};

// Employee-side view of the Special Education caseload.
export type EmployeeSupportAssignmentResponse = {
  id: string;
  student: {
    id: string;
    nis: string | null;
    full_name: string;
  };
  role: StudentSupportRole;
  notes: string | null;
  start_date: string;
  end_date: string | null;
};

export function toEmployeeSupportAssignmentResponse(
  assignment: StudentSupportAssignmentWithStudent,
): EmployeeSupportAssignmentResponse {
  return {
    id: assignment.id,
    student: {
      id: assignment.student.id,
      nis: assignment.student.nis,
      full_name: assignment.student.person.full_name,
    },
    role: assignment.role,
    notes: assignment.notes,
    start_date: assignment.start_date.toISOString(),
    end_date: assignment.end_date ? assignment.end_date.toISOString() : null,
  };
}
