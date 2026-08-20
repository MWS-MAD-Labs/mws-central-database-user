import type {
  Employee,
  Person,
  Student,
  StudentSupportAssignment,
  StudentSupportRole,
} from "../generated/prisma/client";

export type AssignStudentSupportRequest = {
  student_id: string;
  employee_id: string;
  role: StudentSupportRole;
  notes?: string;
};

export type EndStudentSupportAssignmentRequest = {
  id: string;
  student_id: string;
};

export type GetStudentSupportAssignmentsRequest = {
  student_id: string;
};

export type GetEmployeeSupportAssignmentsRequest = {
  employee_id: string;
};

export type GetActiveSupportStudentIdsRequest = {
  student_ids: string[];
};

// Who's currently assigned, not just whether someone is - a roster view
// (Class Detail) can show the teacher's name directly instead of a plain
// "Assigned" yes/no that gives no way to tell who without another click.
export type ActiveSupportStudentEntry = {
  student_id: string;
  employee: { id: string; full_name: string };
};

// Active (not yet ended) SPECIAL_ED caseload per employee - lets the UI
// show "this teacher already has N students" so new assignments can be
// spread out instead of piling onto whoever's picked first in the list.
export type SupportAssignmentCaseloadEntry = {
  employee_id: string;
  active_student_count: number;
};

export type StudentSupportAssignmentWithEmployee = StudentSupportAssignment & {
  employee: Employee & { person: Person };
};

export type StudentSupportAssignmentResponse = {
  id: string;
  employee: {
    id: string;
    employee_id: string;
    full_name: string;
  };
  role: StudentSupportRole;
  notes: string | null;
  start_date: string;
  end_date: string | null;
};

export function toStudentSupportAssignmentResponse(
  assignment: StudentSupportAssignmentWithEmployee,
): StudentSupportAssignmentResponse {
  return {
    id: assignment.id,
    employee: {
      id: assignment.employee.id,
      employee_id: assignment.employee.employee_id,
      full_name: assignment.employee.person.full_name,
    },
    role: assignment.role,
    notes: assignment.notes,
    start_date: assignment.start_date.toISOString(),
    end_date: assignment.end_date ? assignment.end_date.toISOString() : null,
  };
}

export type StudentSupportAssignmentWithStudent = StudentSupportAssignment & {
  student: Student & { person: Person };
};

// Mirrors StudentSupportAssignmentResponse but from the employee's side -
// which students this SE teacher's caseload covers, not who supports a
// given student.
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
