import {
  AdminRole,
  AuditAction,
  AuditSource,
  EmployeeStatus,
  InternStatus,
  StudentSupportRole,
  Prisma,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import {
  assertCanViewEmployeeData,
  assertCanViewStudentData,
  canViewStudentData,
  resolveEmployeeUnitScope,
  resolveStudentUnitScope,
  type AdminUserWithAcademicScope,
  type AdminUserWithEmployeeScope,
  type AdminUserWithStudentScope,
} from "../utils/admin-permissions";
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
  type GetInternSupportAssignmentsRequest,
  type GetStudentSupportAssignmentsRequest,
  type ReactivateStudentSupportAssignmentRequest,
  type RemoveStudentSupportAssignmentRequest,
  type StudentSupportAssignmentResponse,
  type StudentSupportAssignmentWithEmployee,
  type StudentSupportAssignmentWithStudent,
  type SupportAssignmentCaseloadEntry,
  type SearchSupportAssignmentCandidatesRequest,
  type SupportAssignmentCandidateResponse,
} from "../model/student-support-assignment-model";
import type { Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { StudentSupportAssignmentValidation } from "../validation/student-support-assignment-validation";
import { Validation } from "../validation/validation";
import { assertCanWriteNow } from "../utils/office-hours";
import { lockInternWorkforce } from "../utils/intern-workforce-lock";

const ASSIGNMENT_INCLUDE = {
  employee: { include: { person: true } },
  intern: true,
} as const;

type SupportWorkforceTarget = {
  unitId: string;
  auditValues: {
    member_type: "EMPLOYEE" | "INTERN";
    member_id: string;
    member_name: string;
    employee_id: string | null;
    intern_id: string | null;
  };
};

async function supportWorkforceAuditValues(
  employeeId?: string | null,
  internId?: string | null,
): Promise<SupportWorkforceTarget["auditValues"]> {
  if (employeeId) {
    const employee = await prismaClient.employee.findUniqueOrThrow({
      where: { id: employeeId },
      include: { person: true },
    });
    return {
      member_type: "EMPLOYEE",
      member_id: employee.id,
      member_name: employee.person.full_name,
      employee_id: employee.id,
      intern_id: null,
    };
  }
  const intern = await prismaClient.intern.findUniqueOrThrow({
    where: { id: internId! },
  });
  return {
    member_type: "INTERN",
    member_id: intern.id,
    member_name: intern.full_name,
    employee_id: null,
    intern_id: intern.id,
  };
}

async function assertWorkforceMemberIsEligible(
  tx: Prisma.TransactionClient,
  employeeId: string | undefined,
  internId: string | undefined,
  now: Date,
): Promise<SupportWorkforceTarget> {
  if (employeeId) {
  const employee = await tx.employee.findUnique({
    where: { id: employeeId },
    select: {
      status: true,
      deleted_at: true,
      unit_id: true,
      job_level: { select: { is_teaching_role: true } },
      job_position: { select: { name: true } },
      person: { select: { full_name: true } },
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
    return {
      unitId: employee.unit_id,
      auditValues: {
        member_type: "EMPLOYEE",
        member_id: employeeId,
        member_name: employee.person.full_name,
        employee_id: employeeId,
        intern_id: null,
      },
    };
  }

  const intern = await tx.intern.findUnique({
    where: { id: internId! },
    include: { job_position: true },
  });
  if (
    !intern ||
    intern.deleted_at !== null ||
    intern.status !== InternStatus.ACTIVE ||
    intern.end_date <= now ||
    !intern.job_position.is_teaching_position ||
    intern.job_position.name !== "Special Education Teacher"
  ) {
    throw new ResponseError(
      400,
      "Invalid intern: must be active, not expired, and hold the Special Education Teacher position",
    );
  }
  return {
    unitId: intern.unit_id,
    auditValues: {
      member_type: "INTERN",
      member_id: intern.id,
      member_name: intern.full_name,
      employee_id: null,
      intern_id: intern.id,
    },
  };
}

// Teacher and student units must match when both are known.
async function assertSameUnit(
  workforceUnitId: string,
  studentId: string,
): Promise<void> {
  const student = await prismaClient.student.findUniqueOrThrow({
    where: { id: studentId },
    select: { current_grade: { select: { unit_id: true } } },
  });
  const studentUnitId = student.current_grade.unit_id;
  if (studentUnitId && studentUnitId !== workforceUnitId) {
    throw new ResponseError(
      400,
      "This workforce member's unit doesn't match the student's unit - a Special Education teacher can only support students in their own unit.",
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
  static async searchCandidates(
    admin: AdminUserWithEmployeeScope,
    request: SearchSupportAssignmentCandidatesRequest,
    now: Date = new Date(),
  ): Promise<Pageable<SupportAssignmentCandidateResponse>> {
    assertCanViewEmployeeData(admin);
    const searchRequest = Validation.validate(
      StudentSupportAssignmentValidation.SEARCH_CANDIDATES,
      request,
    );
    const unitScope = resolveEmployeeUnitScope(admin);
    if (
      searchRequest.unit_id &&
      unitScope !== undefined &&
      !unitScope.includes(searchRequest.unit_id)
    ) {
      throw new ResponseError(403, "Forbidden: Unit is outside your scope");
    }
    const unitIds = searchRequest.unit_id
      ? [searchRequest.unit_id]
      : unitScope;
    const search = searchRequest.search?.trim();
    const [employees, interns, groups] = await Promise.all([
      prismaClient.employee.findMany({
        where: {
          deleted_at: null,
          status: EmployeeStatus.ACTIVE,
          ...(unitIds === undefined ? {} : { unit_id: { in: unitIds } }),
          job_level: { is_teaching_role: true },
          ...(search
            ? {
                OR: [
                  { employee_id: { contains: search, mode: "insensitive" } },
                  { person: { full_name: { contains: search, mode: "insensitive" } } },
                  { person: { email: { contains: search, mode: "insensitive" } } },
                ],
              }
            : {}),
        },
        include: { person: true, job_position: true },
      }),
      prismaClient.intern.findMany({
        where: {
          deleted_at: null,
          status: InternStatus.ACTIVE,
          end_date: { gt: now },
          ...(unitIds === undefined ? {} : { unit_id: { in: unitIds } }),
          job_position: {
            is_teaching_position: true,
            name: "Special Education Teacher",
          },
          ...(search
            ? {
                OR: [
                  { full_name: { contains: search, mode: "insensitive" } },
                  { email: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        include: { job_position: true },
      }),
      prismaClient.studentSupportAssignment.groupBy({
        by: ["employee_id", "intern_id"],
        where: {
          role: StudentSupportRole.SPECIAL_ED,
          end_date: null,
          deleted_at: null,
        },
        _count: { _all: true },
      }),
    ]);
    const counts = new Map<string, number>();
    for (const group of groups) {
      const key = group.employee_id
        ? `EMPLOYEE:${group.employee_id}`
        : `INTERN:${group.intern_id}`;
      counts.set(key, group._count._all);
    }
    const candidates: SupportAssignmentCandidateResponse[] = [
      ...employees.map((employee) => ({
        id: employee.id,
        type: "EMPLOYEE" as const,
        employee_id: employee.employee_id,
        full_name: employee.person.full_name,
        email: employee.person.email,
        unit_id: employee.unit_id,
        job_position: employee.job_position.name,
        active_student_count: counts.get(`EMPLOYEE:${employee.id}`) ?? 0,
      })),
      ...interns.map((intern) => ({
        id: intern.id,
        type: "INTERN" as const,
        employee_id: null,
        full_name: intern.full_name,
        email: intern.email,
        unit_id: intern.unit_id,
        job_position: intern.job_position.name,
        active_student_count: counts.get(`INTERN:${intern.id}`) ?? 0,
      })),
    ].sort((a, b) =>
      a.full_name.localeCompare(b.full_name, undefined, { sensitivity: "base" }),
    );
    const start = (searchRequest.page - 1) * searchRequest.size;
    return {
      data: candidates.slice(start, start + searchRequest.size),
      paging: {
        size: searchRequest.size,
        current_page: searchRequest.page,
        total_page: Math.ceil(candidates.length / searchRequest.size),
        total_item: candidates.length,
      },
    };
  }

  static async getList(
    admin: AdminUserWithStudentScope,
    request: GetStudentSupportAssignmentsRequest,
  ): Promise<StudentSupportAssignmentResponse[]> {
    assertCanViewStudentData(admin);

    const getRequest = Validation.validate(
      StudentSupportAssignmentValidation.GET,
      request,
    );

    const student = await prismaClient.student.findFirst({
      where: { id: getRequest.student_id, deleted_at: null },
      select: { current_grade: { select: { unit_id: true } } },
    });
    if (!student) throw new ResponseError(404, "Student not found");
    const studentUnitScope = resolveStudentUnitScope(admin);
    if (
      studentUnitScope !== undefined &&
      !studentUnitScope.includes(student.current_grade.unit_id)
    ) {
      throw new ResponseError(404, "Student not found");
    }

    const assignments: StudentSupportAssignmentWithEmployee[] =
      await prismaClient.studentSupportAssignment.findMany({
        where: { student_id: getRequest.student_id, deleted_at: null },
        include: ASSIGNMENT_INCLUDE,
        orderBy: { start_date: "desc" },
      });

    return assignments.map(toStudentSupportAssignmentResponse);
  }

  // Return the employee's current and past caseload.
  static async getListByEmployee(
    admin: AdminUserWithAcademicScope,
    request: GetEmployeeSupportAssignmentsRequest,
  ): Promise<EmployeeSupportAssignmentResponse[]> {
    assertCanViewEmployeeData(admin);
    // The caseload names students. Without student access the employee page
    // still loads, with an empty list instead of a 403.
    if (!canViewStudentData(admin)) return [];

    const getRequest = Validation.validate(
      StudentSupportAssignmentValidation.GET_BY_EMPLOYEE,
      request,
    );

    const employee = await prismaClient.employee.findFirst({
      where: { id: getRequest.employee_id, deleted_at: null },
      select: { unit_id: true },
    });
    if (!employee) {
      throw new ResponseError(404, "Employee not found");
    }
    const employeeUnitScope = resolveEmployeeUnitScope(admin);
    if (
      employeeUnitScope !== undefined &&
      !employeeUnitScope.includes(employee.unit_id)
    ) {
      throw new ResponseError(404, "Employee not found");
    }
    const studentUnitScope = resolveStudentUnitScope(admin);

    const assignments: StudentSupportAssignmentWithStudent[] =
      await prismaClient.studentSupportAssignment.findMany({
        where: {
          employee_id: getRequest.employee_id,
          deleted_at: null,
          ...(studentUnitScope === undefined
            ? {}
            : {
                student: {
                  current_grade: { unit_id: { in: studentUnitScope } },
                },
              }),
        },
        include: { student: { include: { person: true } } },
        orderBy: { start_date: "desc" },
      });

    return assignments.map(toEmployeeSupportAssignmentResponse);
  }

  static async getListByIntern(
    admin: AdminUserWithEmployeeScope,
    request: GetInternSupportAssignmentsRequest,
  ): Promise<EmployeeSupportAssignmentResponse[]> {
    assertCanViewEmployeeData(admin);
    if (!canViewStudentData(admin)) return [];
    const getRequest = Validation.validate(
      StudentSupportAssignmentValidation.GET_BY_INTERN,
      request,
    );
    const intern = await prismaClient.intern.findFirst({
      where: { id: getRequest.intern_id, deleted_at: null },
      select: { unit_id: true },
    });
    if (!intern) throw new ResponseError(404, "Intern not found");
    const internUnitScope = resolveEmployeeUnitScope(admin);
    if (
      internUnitScope !== undefined &&
      !internUnitScope.includes(intern.unit_id)
    ) {
      throw new ResponseError(404, "Intern not found");
    }

    const assignments: StudentSupportAssignmentWithStudent[] =
      await prismaClient.studentSupportAssignment.findMany({
        where: { intern_id: getRequest.intern_id, deleted_at: null },
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

    const assignments = await prismaClient.studentSupportAssignment.findMany({
      where: {
        role: StudentSupportRole.SPECIAL_ED,
        end_date: null,
        deleted_at: null,
      },
      select: { employee_id: true, intern_id: true },
    });
    const counts = new Map<string, SupportAssignmentCaseloadEntry>();
    for (const assignment of assignments) {
      const memberType = assignment.employee_id ? "EMPLOYEE" : "INTERN";
      const memberId = assignment.employee_id ?? assignment.intern_id!;
      const key = `${memberType}:${memberId}`;
      const current = counts.get(key);
      counts.set(key, {
        member_type: memberType,
        member_id: memberId,
        employee_id: assignment.employee_id,
        intern_id: assignment.intern_id,
        active_student_count: (current?.active_student_count ?? 0) + 1,
      });
    }
    return Array.from(counts.values());
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
        employee: { select: { id: true, employee_id: true, person: { select: { full_name: true, email: true } } } },
        intern: { select: { id: true, full_name: true, email: true } },
      },
      distinct: ["student_id"],
    });

    return assignments.map((assignment) => ({
      student_id: assignment.student_id,
      workforce_member: assignment.employee
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
          },
      employee: assignment.employee
        ? { id: assignment.employee.id, full_name: assignment.employee.person.full_name }
        : null,
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
    const createdId = await prismaClient.$transaction(async (tx) => {
      if (assignRequest.intern_id) {
        await lockInternWorkforce(tx, assignRequest.intern_id);
      }
      const workforceTarget = await assertWorkforceMemberIsEligible(
        tx,
        assignRequest.employee_id,
        assignRequest.intern_id,
        now,
      );
      await assertSameUnit(workforceTarget.unitId, assignRequest.student_id);
      const duplicate = await tx.studentSupportAssignment.findFirst({
        where: {
          student_id: assignRequest.student_id,
          employee_id: assignRequest.employee_id,
          intern_id: assignRequest.intern_id,
          role: assignRequest.role,
          end_date: null,
          deleted_at: null,
        },
      });
      if (duplicate) {
        throw new ResponseError(
          400,
          "This workforce member already has an active assignment with this role for this student.",
        );
      }
      const created = await tx.studentSupportAssignment.create({
        data: {
          student_id: assignRequest.student_id,
          employee_id: assignRequest.employee_id,
          intern_id: assignRequest.intern_id,
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
            ...workforceTarget.auditValues,
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
        include: ASSIGNMENT_INCLUDE,
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
    const workforceAuditValues = await supportWorkforceAuditValues(
      existing.employee_id ?? undefined,
      existing.intern_id ?? undefined,
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
          old_values: { ...workforceAuditValues, end_date: null },
          new_values: {
            ...workforceAuditValues,
            end_date: updated.end_date?.toISOString() ?? null,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const updated =
      await prismaClient.studentSupportAssignment.findUniqueOrThrow({
        where: { id: existing.id },
        include: ASSIGNMENT_INCLUDE,
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
    const previousEndDate = existing.end_date.toISOString();
    await prismaClient.$transaction(async (tx) => {
      if (existing.intern_id) {
        await lockInternWorkforce(tx, existing.intern_id);
      }
      const workforceTarget = await assertWorkforceMemberIsEligible(
        tx,
        existing.employee_id ?? undefined,
        existing.intern_id ?? undefined,
        now,
      );
      await assertSameUnit(workforceTarget.unitId, existing.student_id);
      const duplicate = await tx.studentSupportAssignment.findFirst({
        where: {
          student_id: existing.student_id,
          employee_id: existing.employee_id,
          intern_id: existing.intern_id,
          role: existing.role,
          end_date: null,
          deleted_at: null,
          NOT: { id: existing.id },
        },
      });
      if (duplicate) {
        throw new ResponseError(
          400,
          "This workforce member already has an active assignment with this role for this student.",
        );
      }
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
          old_values: {
            ...workforceTarget.auditValues,
            end_date: previousEndDate,
          },
          new_values: { ...workforceTarget.auditValues, end_date: null },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    const updated =
      await prismaClient.studentSupportAssignment.findUniqueOrThrow({
        where: { id: existing.id },
        include: ASSIGNMENT_INCLUDE,
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
    const workforceAuditValues = await supportWorkforceAuditValues(
      existing.employee_id ?? undefined,
      existing.intern_id ?? undefined,
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
            ...workforceAuditValues,
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
