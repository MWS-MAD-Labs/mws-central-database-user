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
  type ActiveSupportStudentEntry,
  type AssignStudentSupportRequest,
  type EmployeeSupportAssignmentResponse,
  type EndStudentSupportAssignmentRequest,
  type GetActiveSupportStudentIdsRequest,
  type GetEmployeeSupportAssignmentsRequest,
  type GetStudentSupportAssignmentsRequest,
  type ReactivateStudentSupportAssignmentRequest,
  type RemoveStudentSupportAssignmentRequest,
  type StudentSupportAssignmentResponse,
  type StudentSupportAssignmentWithEmployee,
  type StudentSupportAssignmentWithStudent,
  type SupportAssignmentCaseloadEntry,
} from "../model/student-support-assignment-model";
import { AuditService } from "./audit-service";
import { StudentSupportAssignmentValidation } from "../validation/student-support-assignment-validation";
import { Validation } from "../validation/validation";
import { assertCanWriteNow } from "../utils/office-hours";

async function assertStudentExists(studentId: string): Promise<void> {
  const student = await prismaClient.student.findFirst({
    where: { id: studentId, deleted_at: null },
  });
  if (!student) {
    throw new ResponseError(404, "Student not found");
  }
}

// Return the employee unit for the assignment unit check.
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

// Teacher and student units must match when both are known.
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

// Support assignments use the student-domain write gate and unit scope.
async function assertCanWriteSupportAssignment(
  admin: AdminUser,
  gradeUnitId: string | null,
  action: string,
  now: Date,
  context: AuditRequestContext,
): Promise<void> {
  if (admin.role === AdminRole.VIEWER) {
    throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_student_data) {
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to write student data",
      );
    }
    await assertCanWriteNow(admin, context, now);
    if (gradeUnitId !== admin.unit_id) {
      throw new ResponseError(
        403,
        `Forbidden: You can only ${action} within your unit scope`,
      );
    }
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
        where: { student_id: getRequest.student_id, deleted_at: null },
        include: { employee: { include: { person: true } } },
        orderBy: { start_date: "desc" },
      });

    return assignments.map(toStudentSupportAssignmentResponse);
  }

  // Return the employee's current and past caseload.
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
        where: { employee_id: getRequest.employee_id, deleted_at: null },
        include: { student: { include: { person: true } } },
        orderBy: { start_date: "desc" },
      });

    return assignments.map(toEmployeeSupportAssignmentResponse);
  }

  // Count active caseloads for assignment balancing.
  static async getCaseload(
    admin: AdminUser,
  ): Promise<SupportAssignmentCaseloadEntry[]> {
    void admin;

    const grouped = await prismaClient.studentSupportAssignment.groupBy({
      by: ["employee_id"],
      where: {
        role: StudentSupportRole.SPECIAL_ED,
        end_date: null,
        deleted_at: null,
      },
      _count: { _all: true },
    });

    return grouped.map((row) => ({
      employee_id: row.employee_id,
      active_student_count: row._count._all,
    }));
  }

  // Batch active Special Education assignment checks.
  static async getActiveSupportStudentIds(
    admin: AdminUser,
    request: GetActiveSupportStudentIdsRequest,
  ): Promise<ActiveSupportStudentEntry[]> {
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
        deleted_at: null,
      },
      select: {
        student_id: true,
        employee: { select: { id: true, person: { select: { full_name: true } } } },
      },
      distinct: ["student_id"],
    });

    return assignments.map((assignment) => ({
      student_id: assignment.student_id,
      employee: {
        id: assignment.employee.id,
        full_name: assignment.employee.person.full_name,
      },
    }));
  }

  static async assign(
    admin: AdminUser,
    request: AssignStudentSupportRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<StudentSupportAssignmentResponse> {
    const assignRequest = Validation.validate(
      StudentSupportAssignmentValidation.ASSIGN,
      request,
    );

    const student = await prismaClient.student.findFirst({
      where: { id: assignRequest.student_id, deleted_at: null },
      select: { current_grade: { select: { unit_id: true } } },
    });
    if (!student) {
      throw new ResponseError(404, "Student not found");
    }
    await assertCanWriteSupportAssignment(
      admin,
      student.current_grade.unit_id,
      "assign a student support teacher",
      now,
      context,
    );

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
        deleted_at: null,
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
    now: Date = new Date(),
  ): Promise<StudentSupportAssignmentResponse> {
    const endRequest = Validation.validate(
      StudentSupportAssignmentValidation.END,
      request,
    );

    const existing = await prismaClient.studentSupportAssignment.findFirst({
      where: {
        id: endRequest.id,
        student_id: endRequest.student_id,
        deleted_at: null,
      },
      include: { student: { select: { current_grade: { select: { unit_id: true } } } } },
    });
    if (!existing) {
      throw new ResponseError(404, "Student support assignment not found");
    }
    if (existing.end_date !== null) {
      throw new ResponseError(400, "This assignment has already ended");
    }
    await assertCanWriteSupportAssignment(
      admin,
      existing.student.current_grade.unit_id,
      "end a student support assignment",
      now,
      context,
    );

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

  // Reopen the same row to preserve its start date and history.
  static async reactivate(
    admin: AdminUser,
    request: ReactivateStudentSupportAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<StudentSupportAssignmentResponse> {
    const reactivateRequest = Validation.validate(
      StudentSupportAssignmentValidation.REACTIVATE,
      request,
    );

    const existing = await prismaClient.studentSupportAssignment.findFirst({
      where: {
        id: reactivateRequest.id,
        student_id: reactivateRequest.student_id,
        deleted_at: null,
      },
      include: { student: { select: { current_grade: { select: { unit_id: true } } } } },
    });
    if (!existing) {
      throw new ResponseError(404, "Student support assignment not found");
    }
    if (existing.end_date === null) {
      throw new ResponseError(400, "This assignment is already active");
    }
    await assertCanWriteSupportAssignment(
      admin,
      existing.student.current_grade.unit_id,
      "reactivate a student support assignment",
      now,
      context,
    );

    // Reactivation must not create duplicate active assignments.
    const duplicate = await prismaClient.studentSupportAssignment.findFirst({
      where: {
        student_id: existing.student_id,
        employee_id: existing.employee_id,
        role: existing.role,
        end_date: null,
        deleted_at: null,
        NOT: { id: existing.id },
      },
    });
    if (duplicate) {
      throw new ResponseError(
        400,
        "This employee already has an active assignment with this role for this student.",
      );
    }

    const previousEndDate = existing.end_date.toISOString();
    await prismaClient.$transaction(async (tx) => {
      await tx.studentSupportAssignment.update({
        where: { id: existing.id },
        data: { end_date: null },
      });

      await AuditService.record(
        {
          action: AuditAction.REACTIVATE_STUDENT_SUPPORT_ASSIGNMENT,
          source: AuditSource.UI,
          entity_type: "StudentSupportAssignment",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: { end_date: previousEndDate },
          new_values: { end_date: null },
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

  // Soft-delete mistaken assignments; end() preserves legitimate history.
  static async remove(
    admin: AdminUser,
    request: RemoveStudentSupportAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    const deleteRequest = Validation.validate(
      StudentSupportAssignmentValidation.DELETE,
      request,
    );

    const existing = await prismaClient.studentSupportAssignment.findFirst({
      where: { id: deleteRequest.id, student_id: deleteRequest.student_id },
      include: { student: { select: { current_grade: { select: { unit_id: true } } } } },
    });
    if (!existing) {
      throw new ResponseError(404, "Student support assignment not found");
    }
    if (existing.deleted_at !== null) {
      throw new ResponseError(400, "This assignment has already been dropped");
    }
    await assertCanWriteSupportAssignment(
      admin,
      existing.student.current_grade.unit_id,
      "drop a student support assignment",
      now,
      context,
    );

    const deletedAt = now;
    await prismaClient.$transaction(async (tx) => {
      await tx.studentSupportAssignment.update({
        where: { id: existing.id },
        data: { deleted_at: deletedAt },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_STUDENT_SUPPORT_ASSIGNMENT,
          source: AuditSource.UI,
          entity_type: "StudentSupportAssignment",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: {
            employee_id: existing.employee_id,
            role: existing.role,
            notes: existing.notes,
            end_date: existing.end_date?.toISOString() ?? null,
          },
          new_values: { deleted_at: deletedAt.toISOString() },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    return true;
  }
}
