import {
  AcademicYearStatus,
  AdminRole,
  AuditAction,
  AuditSource,
  ClassStatus,
  ClassTeacherRole,
  EmployeeStatus,
  EnrollmentStatus,
  Prisma,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toClassAuditSnapshot,
  toClassTeacherAssignmentResponse,
  toClassResponse,
  type AssignClassTeacherRequest,
  type ClassTeacherAssignmentResponse,
  type ClassTeacherAssignmentWithEmployee,
  type ClassResponse,
  type ClassSortField,
  type ClassWithRelations,
  type CreateClassRequest,
  type DeleteClassRequest,
  type EndClassTeacherAssignmentRequest,
  type GetClassRequest,
  type SearchClassRequest,
  type UpdateClassRequest,
} from "../model/class-model";
import { paginate, type Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { ClassValidation } from "../validation/class-validation";
import { Validation } from "../validation/validation";
import { getUniqueConstraintFields } from "../utils/prisma-error";

const CLASS_INCLUDE = { grade: true, academic_year: true } as const;

// A class can only be live (ACTIVE) while its academic year is the live
// one - an UPCOMING or COMPLETED year has no business having "active"
// classes. Deactivating classes when a year stops being ACTIVE is handled
// separately (cascade in AcademicYearService.update); this only guards
// against setting ACTIVE the other way, on the class side.
async function assertClassStatusMatchesAcademicYear(
  status: ClassStatus,
  academicYearId: string,
): Promise<void> {
  if (status !== ClassStatus.ACTIVE) return;

  const academicYear = await prismaClient.academicYear.findUnique({
    where: { id: academicYearId },
    select: { status: true, name: true },
  });

  if (academicYear && academicYear.status !== AcademicYearStatus.ACTIVE) {
    throw new ResponseError(
      400,
      `Cannot set class to ACTIVE: academic year "${academicYear.name}" is ${academicYear.status}, not ACTIVE.`,
    );
  }
}

function activeEnrollmentWhere(classId: string) {
  return {
    class_id: classId,
    enrollment_status: EnrollmentStatus.ACTIVE,
    deleted_at: null,
  };
}

async function getActiveEnrollmentCount(classId: string): Promise<number> {
  return prismaClient.studentClassEnrollment.count({
    where: activeEnrollmentWhere(classId),
  });
}

// Shared by every teacher role (homeroom, supporting, subject) - all of
// them need an active, teaching-eligible employee, regardless of how many
// classes that employee ends up assigned to.
async function assertTeacherIsActive(employeeId: string): Promise<void> {
  const teacher = await prismaClient.employee.findUnique({
    where: { id: employeeId },
    select: {
      status: true,
      deleted_at: true,
      job_level: { select: { is_teaching_role: true } },
    },
  });
  if (
    !teacher ||
    teacher.deleted_at !== null ||
    teacher.status !== EmployeeStatus.ACTIVE ||
    !teacher.job_level.is_teaching_role
  ) {
    throw new ResponseError(
      400,
      "Invalid teacher: referenced employee does not exist, is not active, or does not hold a teaching-eligible job level",
    );
  }
}

const DUPLICATE_HOMEROOM_ASSIGNMENT_MESSAGE =
  "This employee is already the homeroom teacher of another class in this academic year.";

const DUPLICATE_CLASS_NAME_MESSAGE =
  "A class with this name already exists for this academic year";

async function assertHomeroomTeacherNotAssignedElsewhere(
  homeroomTeacherId: string,
  academicYearId: string,
  excludeClassId?: string,
): Promise<void> {
  const conflicting = await prismaClient.class.findFirst({
    where: {
      homeroom_teacher_id: homeroomTeacherId,
      academic_year_id: academicYearId,
      ...(excludeClassId ? { id: { not: excludeClassId } } : {}),
    },
  });
  if (conflicting) {
    throw new ResponseError(400, DUPLICATE_HOMEROOM_ASSIGNMENT_MESSAGE);
  }
}

function rethrowAsFriendlyClassConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("homeroom_teacher_id")) {
    throw new ResponseError(400, DUPLICATE_HOMEROOM_ASSIGNMENT_MESSAGE);
  }
  if (fields?.includes("name")) {
    throw new ResponseError(400, DUPLICATE_CLASS_NAME_MESSAGE);
  }
  throw error;
}

async function recordHomeroomAssignmentChange(
  tx: Prisma.TransactionClient,
  classId: string,
  previousTeacherId: string | null,
  nextTeacherId: string | null,
): Promise<void> {
  if (previousTeacherId === nextTeacherId) return;

  if (previousTeacherId) {
    await tx.classTeacherAssignment.updateMany({
      where: {
        class_id: classId,
        employee_id: previousTeacherId,
        role: ClassTeacherRole.HOMEROOM,
        end_date: null,
      },
      data: { end_date: new Date() },
    });
  }
  if (nextTeacherId) {
    await tx.classTeacherAssignment.create({
      data: {
        class_id: classId,
        employee_id: nextTeacherId,
        role: ClassTeacherRole.HOMEROOM,
      },
    });
  }
}

export class ClassService {
  static async create(
    admin: AdminUser,
    request: CreateClassRequest,
    context: AuditRequestContext = {},
  ): Promise<ClassResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can create a class",
      );
    }

    const createRequest = Validation.validate(ClassValidation.CREATE, request);

    const duplicate = await prismaClient.class.findFirst({
      where: {
        name: createRequest.name,
        academic_year_id: createRequest.academic_year_id,
      },
    });
    if (duplicate) {
      throw new ResponseError(
        400,
        "A class with this name already exists for this academic year",
      );
    }

    await assertClassStatusMatchesAcademicYear(
      createRequest.status ?? ClassStatus.ACTIVE,
      createRequest.academic_year_id,
    );

    if (createRequest.homeroom_teacher_id) {
      await assertTeacherIsActive(createRequest.homeroom_teacher_id);
      await assertHomeroomTeacherNotAssignedElsewhere(
        createRequest.homeroom_teacher_id,
        createRequest.academic_year_id,
      );
    }

    let klass: ClassWithRelations;
    try {
      klass = await prismaClient.$transaction(async (tx) => {
        const created = await tx.class.create({
          data: {
            name: createRequest.name,
            grade_id: createRequest.grade_id,
            academic_year_id: createRequest.academic_year_id,
            homeroom_teacher_id: createRequest.homeroom_teacher_id,
            status: createRequest.status,
            capacity: createRequest.capacity,
          },
          include: CLASS_INCLUDE,
        });

        if (createRequest.homeroom_teacher_id) {
          await recordHomeroomAssignmentChange(
            tx,
            created.id,
            null,
            createRequest.homeroom_teacher_id,
          );
        }

        await AuditService.record(
          {
            action: AuditAction.CREATE_CLASS,
            source: AuditSource.UI,
            entity_type: "Class",
            entity_id: created.id,
            admin_id: admin.id,
            new_values: toClassAuditSnapshot(created),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return created;
      });
    } catch (error) {
      rethrowAsFriendlyClassConflict(error);
    }

    return toClassResponse(klass, 0);
  }

  static async update(
    admin: AdminUser,
    request: UpdateClassRequest,
    context: AuditRequestContext = {},
  ): Promise<ClassResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can update a class",
      );
    }

    const updateRequest = Validation.validate(ClassValidation.UPDATE, request);

    const existing = await prismaClient.class.findUnique({
      where: { id: updateRequest.id },
    });
    if (!existing) {
      throw new ResponseError(404, "Class not found");
    }

    const nextName = updateRequest.name ?? existing.name;
    const nextAcademicYearId =
      updateRequest.academic_year_id ?? existing.academic_year_id;
    if (
      nextName !== existing.name ||
      nextAcademicYearId !== existing.academic_year_id
    ) {
      const duplicate = await prismaClient.class.findFirst({
        where: {
          name: nextName,
          academic_year_id: nextAcademicYearId,
          id: { not: updateRequest.id },
        },
      });
      if (duplicate) {
        throw new ResponseError(
          400,
          "A class with this name already exists for this academic year",
        );
      }
    }

    await assertClassStatusMatchesAcademicYear(
      updateRequest.status ?? existing.status,
      nextAcademicYearId,
    );

    if (updateRequest.homeroom_teacher_id) {
      await assertTeacherIsActive(updateRequest.homeroom_teacher_id);
      await assertHomeroomTeacherNotAssignedElsewhere(
        updateRequest.homeroom_teacher_id,
        nextAcademicYearId,
        updateRequest.id,
      );
    }

    const nextHomeroomTeacherId =
      updateRequest.homeroom_teacher_id === undefined
        ? existing.homeroom_teacher_id
        : updateRequest.homeroom_teacher_id;

    let klass: ClassWithRelations;
    try {
      klass = await prismaClient.$transaction(async (tx) => {
        const updated = await tx.class.update({
          where: { id: updateRequest.id },
          data: {
            name: updateRequest.name,
            grade_id: updateRequest.grade_id,
            academic_year_id: updateRequest.academic_year_id,
            homeroom_teacher_id: updateRequest.homeroom_teacher_id,
            status: updateRequest.status,
            capacity: updateRequest.capacity,
          },
          include: CLASS_INCLUDE,
        });

        await recordHomeroomAssignmentChange(
          tx,
          updateRequest.id,
          existing.homeroom_teacher_id,
          nextHomeroomTeacherId,
        );

        await AuditService.record(
          {
            action: AuditAction.UPDATE_CLASS,
            source: AuditSource.UI,
            entity_type: "Class",
            entity_id: updated.id,
            admin_id: admin.id,
            old_values: toClassAuditSnapshot(existing),
            new_values: toClassAuditSnapshot(updated),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return updated;
      });
    } catch (error) {
      rethrowAsFriendlyClassConflict(error);
    }

    return toClassResponse(klass, await getActiveEnrollmentCount(klass.id));
  }

  static async remove(
    admin: AdminUser,
    request: DeleteClassRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete a class",
      );
    }

    const deleteRequest = Validation.validate(ClassValidation.DELETE, request);

    const existing = await prismaClient.class.findUnique({
      where: { id: deleteRequest.id },
    });
    if (!existing) {
      throw new ResponseError(404, "Class not found");
    }

    const [currentStudentCount, enrollmentCount] = await Promise.all([
      prismaClient.student.count({
        where: { current_class_id: deleteRequest.id },
      }),
      prismaClient.studentClassEnrollment.count({
        where: { class_id: deleteRequest.id },
      }),
    ]);

    const usages: string[] = [];
    if (currentStudentCount > 0) {
      usages.push(`${currentStudentCount} student(s) currently assigned`);
    }
    if (enrollmentCount > 0) {
      usages.push(`${enrollmentCount} enrollment(s)`);
    }

    if (usages.length > 0) {
      throw new ResponseError(
        400,
        `Cannot delete: this class is still referenced by ${usages.join(", ")}. Reassign or remove those first.`,
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.class.delete({
        where: { id: deleteRequest.id },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_CLASS,
          source: AuditSource.UI,
          entity_type: "Class",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: toClassAuditSnapshot(existing),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    return true;
  }

  static async get(
    admin: AdminUser,
    request: GetClassRequest,
  ): Promise<ClassResponse> {
    void admin;

    const klass = await prismaClient.class.findUnique({
      where: { id: request.id },
      include: CLASS_INCLUDE,
    });
    if (!klass) {
      throw new ResponseError(404, "Class not found");
    }

    return toClassResponse(klass, await getActiveEnrollmentCount(klass.id));
  }

  // Returns every teacher assignment for the class - homeroom (history),
  // supporting homeroom, and subject teacher rows all live in the same
  // table now, distinguished by `role`.
  static async getTeacherAssignments(
    admin: AdminUser,
    request: GetClassRequest,
  ): Promise<ClassTeacherAssignmentResponse[]> {
    void admin;

    const klass = await prismaClient.class.findUnique({
      where: { id: request.id },
    });
    if (!klass) {
      throw new ResponseError(404, "Class not found");
    }

    const assignments: ClassTeacherAssignmentWithEmployee[] =
      await prismaClient.classTeacherAssignment.findMany({
        where: { class_id: request.id },
        include: { employee: { include: { person: true } } },
        orderBy: { start_date: "desc" },
      });

    return assignments.map(toClassTeacherAssignmentResponse);
  }

  // Adds a SUPPORTING_HOMEROOM or SUBJECT_TEACHER assignment - unlike
  // HOMEROOM (capped at one per class via Class.homeroom_teacher_id, see
  // create/update above), these roles allow multiple simultaneously active
  // assignments both per class (several supporting teachers) and per
  // employee (one subject teacher across several classes/grades).
  static async assignTeacher(
    admin: AdminUser,
    request: AssignClassTeacherRequest,
    context: AuditRequestContext = {},
  ): Promise<ClassTeacherAssignmentResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can assign a class teacher",
      );
    }

    const assignRequest = Validation.validate(
      ClassValidation.ASSIGN_TEACHER,
      request,
    );

    if (assignRequest.role === ClassTeacherRole.HOMEROOM) {
      throw new ResponseError(
        400,
        "Homeroom teacher is set via the class's homeroom_teacher_id field, not this endpoint.",
      );
    }

    const klass = await prismaClient.class.findUnique({
      where: { id: assignRequest.class_id },
    });
    if (!klass) {
      throw new ResponseError(404, "Class not found");
    }

    await assertTeacherIsActive(assignRequest.employee_id);

    const duplicate = await prismaClient.classTeacherAssignment.findFirst({
      where: {
        class_id: assignRequest.class_id,
        employee_id: assignRequest.employee_id,
        role: assignRequest.role,
        subject: assignRequest.subject ?? null,
        end_date: null,
      },
    });
    if (duplicate) {
      throw new ResponseError(
        400,
        "This employee already has an active assignment with this exact role/subject for this class.",
      );
    }

    const createdId = await prismaClient.$transaction(async (tx) => {
      const created = await tx.classTeacherAssignment.create({
        data: {
          class_id: assignRequest.class_id,
          employee_id: assignRequest.employee_id,
          role: assignRequest.role,
          subject: assignRequest.subject,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.ASSIGN_CLASS_TEACHER,
          source: AuditSource.UI,
          entity_type: "ClassTeacherAssignment",
          entity_id: created.id,
          admin_id: admin.id,
          new_values: {
            class_id: created.class_id,
            employee_id: created.employee_id,
            role: created.role,
            subject: created.subject,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return created.id;
    });

    const withEmployee =
      await prismaClient.classTeacherAssignment.findUniqueOrThrow({
        where: { id: createdId },
        include: { employee: { include: { person: true } } },
      });

    return toClassTeacherAssignmentResponse(withEmployee);
  }

  static async endTeacherAssignment(
    admin: AdminUser,
    request: EndClassTeacherAssignmentRequest,
    context: AuditRequestContext = {},
  ): Promise<ClassTeacherAssignmentResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can end a class teacher assignment",
      );
    }

    const endRequest = Validation.validate(
      ClassValidation.END_TEACHER_ASSIGNMENT,
      request,
    );

    const existing = await prismaClient.classTeacherAssignment.findFirst({
      where: { id: endRequest.id, class_id: endRequest.class_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Teacher assignment not found");
    }
    if (existing.role === ClassTeacherRole.HOMEROOM) {
      throw new ResponseError(
        400,
        "Homeroom teacher is cleared via the class's homeroom_teacher_id field, not this endpoint.",
      );
    }
    if (existing.end_date !== null) {
      throw new ResponseError(400, "This assignment has already ended");
    }

    await prismaClient.$transaction(async (tx) => {
      const updated = await tx.classTeacherAssignment.update({
        where: { id: existing.id },
        data: { end_date: new Date() },
      });

      await AuditService.record(
        {
          action: AuditAction.END_CLASS_TEACHER_ASSIGNMENT,
          source: AuditSource.UI,
          entity_type: "ClassTeacherAssignment",
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

    const updated = await prismaClient.classTeacherAssignment.findUniqueOrThrow({
      where: { id: existing.id },
      include: { employee: { include: { person: true } } },
    });

    return toClassTeacherAssignmentResponse(updated);
  }

  static async search(
    admin: AdminUser,
    request: SearchClassRequest,
  ): Promise<Pageable<ClassResponse>> {
    void admin;

    const searchRequest = Validation.validate(ClassValidation.SEARCH, request);

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const where = {
      name: searchRequest.search
        ? { contains: searchRequest.search, mode: "insensitive" as const }
        : undefined,
      grade_id: searchRequest.grade_id,
      academic_year_id: searchRequest.academic_year_id,
      status: searchRequest.status,
    };

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.class.count({ where }),
      findMany: async () => {
        const classes = await prismaClient.class.findMany({
          where,
          include: CLASS_INCLUDE,
          take: searchRequest.size,
          skip,
          orderBy: buildClassOrderBy(
            searchRequest.sort_by || "created_at",
            searchRequest.sort_order || "desc",
          ),
        });
        if (classes.length === 0) return [];

        const counts = await prismaClient.studentClassEnrollment.groupBy({
          by: ["class_id"],
          where: {
            class_id: { in: classes.map((klass) => klass.id) },
            enrollment_status: EnrollmentStatus.ACTIVE,
            deleted_at: null,
          },
          _count: { _all: true },
        });
        const countByClassId = new Map(
          counts.map((count) => [count.class_id, count._count._all]),
        );
        return classes.map((klass) =>
          toClassResponse(klass, countByClassId.get(klass.id) ?? 0),
        );
      },
    });
  }
}

function buildClassOrderBy(sortBy: ClassSortField, sortOrder: "asc" | "desc") {
  if (sortBy === "grade_level") {
    return { grade: { level: sortOrder } };
  }
  return { [sortBy]: sortOrder };
}
