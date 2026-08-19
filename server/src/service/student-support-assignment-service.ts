import {
  AdminRole,
  AuditAction,
  AuditSource,
  EmployeeStatus,
  StudentSupportRole,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toEmployeeSupportAssignmentResponse,
  toStudentSupportAssignmentResponse,
  type AssignStudentSupportRequest,
  type EmployeeSupportAssignmentResponse,
  type EndStudentSupportAssignmentRequest,
  type GetActiveSupportStudentIdsRequest,
  type GetEmployeeSupportAssignmentsRequest,
  type GetStudentSupportAssignmentsRequest,
  type StudentSupportAssignmentResponse,
  type StudentSupportAssignmentWithEmployee,
  type StudentSupportAssignmentWithStudent,
  type SupportAssignmentCaseloadEntry,
} from "../model/student-support-assignment-model";
import { AuditService } from "./audit-service";
import { StudentSupportAssignmentValidation } from "../validation/student-support-assignment-validation";
import { Validation } from "../validation/validation";

async function assertStudentExists(studentId: string): Promise<void> {
  const student = await prismaClient.student.findFirst({
    where: { id: studentId, deleted_at: null },
  });
  if (!student) {
    throw new ResponseError(404, "Student not found");
  }
}

// Returns the employee's unit_id so assign() can cross-check it against the
// student's - an eligible-but-wrong-unit employee still needs to fail loudly
// rather than silently slip through here.
async function assertEmployeeIsEligible(employeeId: string): Promise<string> {
  const employee = await prismaClient.employee.findUnique({
    where: { id: employeeId },
    select: {
      status: true,
      deleted_at: true,
      unit_id: true,
      job_level: { select: { is_teaching_role: true } },
    },
  });
  if (
    !employee ||
    employee.deleted_at !== null ||
    employee.status !== EmployeeStatus.ACTIVE ||
    !employee.job_level.is_teaching_role
  ) {
    throw new ResponseError(
      400,
      "Invalid employee: does not exist, is not active, or does not hold a teaching-eligible job level",
    );
  }
  return employee.unit_id;
}

// A SMP-based SE teacher shouldn't end up supporting a Kindergarten/SD
// student, and vice versa - grades without a unit set (legacy/unassigned)
// skip this check since there's nothing to compare against.
async function assertSameUnit(
  employeeUnitId: string,
  studentId: string,
): Promise<void> {
  const student = await prismaClient.student.findUniqueOrThrow({
    where: { id: studentId },
    select: { current_grade: { select: { unit_id: true } } },
  });
  const studentUnitId = student.current_grade.unit_id;
  if (studentUnitId && studentUnitId !== employeeUnitId) {
    throw new ResponseError(
      400,
      "This employee's unit doesn't match the student's unit - a Special Education teacher can only support students in their own unit.",
    );
  }
}

export class StudentSupportAssignmentService {
  static async getList(
    admin: AdminUser,
    request: GetStudentSupportAssignmentsRequest,
  ): Promise<StudentSupportAssignmentResponse[]> {
    void admin;

    const getRequest = Validation.validate(
      StudentSupportAssignmentValidation.GET,
      request,
    );

    await assertStudentExists(getRequest.student_id);

    const assignments: StudentSupportAssignmentWithEmployee[] =
      await prismaClient.studentSupportAssignment.findMany({
        where: { student_id: getRequest.student_id },
        include: { employee: { include: { person: true } } },
        orderBy: { start_date: "desc" },
      });

    return assignments.map(toStudentSupportAssignmentResponse);
  }

  // The employee's own caseload - which students they support, past and
  // present. Mirrors ClassService.getEmployeeTeachingAssignments's shape
  // (no RBAC gate beyond "employee exists" - same as that read).
  static async getListByEmployee(
    admin: AdminUser,
    request: GetEmployeeSupportAssignmentsRequest,
  ): Promise<EmployeeSupportAssignmentResponse[]> {
    void admin;

    const getRequest = Validation.validate(
      StudentSupportAssignmentValidation.GET_BY_EMPLOYEE,
      request,
    );

    const employee = await prismaClient.employee.findFirst({
      where: { id: getRequest.employee_id, deleted_at: null },
    });
    if (!employee) {
      throw new ResponseError(404, "Employee not found");
    }

    const assignments: StudentSupportAssignmentWithStudent[] =
      await prismaClient.studentSupportAssignment.findMany({
        where: { employee_id: getRequest.employee_id },
        include: { student: { include: { person: true } } },
        orderBy: { start_date: "desc" },
      });

    return assignments.map(toEmployeeSupportAssignmentResponse);
  }

  // Active caseload per employee, across all students - lets the assign UI
  // show "this teacher already has N students" so admins can spread new
  // assignments out instead of piling onto whoever's first in the list.
  static async getCaseload(
    admin: AdminUser,
  ): Promise<SupportAssignmentCaseloadEntry[]> {
    void admin;

    const grouped = await prismaClient.studentSupportAssignment.groupBy({
      by: ["employee_id"],
      where: { role: StudentSupportRole.SPECIAL_ED, end_date: null },
      _count: { _all: true },
    });

    return grouped.map((row) => ({
      employee_id: row.employee_id,
      active_student_count: row._count._all,
    }));
  }

  // Bulk "does this student currently have an active SPECIAL_ED assignment"
  // check - lets a roster view (e.g. Class Detail's student table) flag who
  // still needs one without an N+1 request per student.
  static async getActiveSupportStudentIds(
    admin: AdminUser,
    request: GetActiveSupportStudentIdsRequest,
  ): Promise<string[]> {
    void admin;

    const getRequest = Validation.validate(
      StudentSupportAssignmentValidation.GET_ACTIVE_STUDENT_IDS,
      request,
    );

    const assignments = await prismaClient.studentSupportAssignment.findMany({
      where: {
        student_id: { in: getRequest.student_ids },
        role: StudentSupportRole.SPECIAL_ED,
        end_date: null,
      },
      select: { student_id: true },
      distinct: ["student_id"],
    });

    return assignments.map((assignment) => assignment.student_id);
  }

  static async assign(
    admin: AdminUser,
    request: AssignStudentSupportRequest,
    context: AuditRequestContext = {},
  ): Promise<StudentSupportAssignmentResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can assign a student support teacher",
      );
    }

    const assignRequest = Validation.validate(
      StudentSupportAssignmentValidation.ASSIGN,
      request,
    );

    await assertStudentExists(assignRequest.student_id);
    const employeeUnitId = await assertEmployeeIsEligible(
      assignRequest.employee_id,
    );
    await assertSameUnit(employeeUnitId, assignRequest.student_id);

    const duplicate = await prismaClient.studentSupportAssignment.findFirst({
      where: {
        student_id: assignRequest.student_id,
        employee_id: assignRequest.employee_id,
        role: assignRequest.role,
        end_date: null,
      },
    });
    if (duplicate) {
      throw new ResponseError(
        400,
        "This employee already has an active assignment with this role for this student.",
      );
    }

    const createdId = await prismaClient.$transaction(async (tx) => {
      const created = await tx.studentSupportAssignment.create({
        data: {
          student_id: assignRequest.student_id,
          employee_id: assignRequest.employee_id,
          role: assignRequest.role,
          notes: assignRequest.notes,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.ASSIGN_STUDENT_SUPPORT,
          source: AuditSource.UI,
          entity_type: "StudentSupportAssignment",
          entity_id: created.id,
          admin_id: admin.id,
          new_values: {
            student_id: created.student_id,
            employee_id: created.employee_id,
            role: created.role,
            notes: created.notes,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return created.id;
    });

    const withEmployee =
      await prismaClient.studentSupportAssignment.findUniqueOrThrow({
        where: { id: createdId },
        include: { employee: { include: { person: true } } },
      });

    return toStudentSupportAssignmentResponse(withEmployee);
  }

  static async end(
    admin: AdminUser,
    request: EndStudentSupportAssignmentRequest,
    context: AuditRequestContext = {},
  ): Promise<StudentSupportAssignmentResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can end a student support assignment",
      );
    }

    const endRequest = Validation.validate(
      StudentSupportAssignmentValidation.END,
      request,
    );

    const existing = await prismaClient.studentSupportAssignment.findFirst({
      where: { id: endRequest.id, student_id: endRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Student support assignment not found");
    }
    if (existing.end_date !== null) {
      throw new ResponseError(400, "This assignment has already ended");
    }

    await prismaClient.$transaction(async (tx) => {
      const updated = await tx.studentSupportAssignment.update({
        where: { id: existing.id },
        data: { end_date: new Date() },
      });

      await AuditService.record(
        {
          action: AuditAction.END_STUDENT_SUPPORT_ASSIGNMENT,
          source: AuditSource.UI,
          entity_type: "StudentSupportAssignment",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: { end_date: null },
          new_values: { end_date: updated.end_date?.toISOString() ?? null },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const updated =
      await prismaClient.studentSupportAssignment.findUniqueOrThrow({
        where: { id: existing.id },
        include: { employee: { include: { person: true } } },
      });

    return toStudentSupportAssignmentResponse(updated);
  }
}
