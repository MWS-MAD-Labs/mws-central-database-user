import {
  AdminRole,
  AuditAction,
  AuditSource,
  EmployeeStatus,
  Prisma,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toClassAuditSnapshot,
  toClassHomeroomAssignmentResponse,
  toClassResponse,
  type ClassHomeroomAssignmentResponse,
  type ClassHomeroomAssignmentWithEmployee,
  type ClassResponse,
  type ClassSortField,
  type ClassWithRelations,
  type CreateClassRequest,
  type DeleteClassRequest,
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

async function assertHomeroomTeacherIsActive(
  homeroomTeacherId: string,
): Promise<void> {
  const teacher = await prismaClient.employee.findUnique({
    where: { id: homeroomTeacherId },
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
      "Invalid homeroom teacher: referenced employee does not exist, is not active, or does not hold a teaching-eligible job level",
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
    await tx.classHomeroomAssignment.updateMany({
      where: {
        class_id: classId,
        employee_id: previousTeacherId,
        end_date: null,
      },
      data: { end_date: new Date() },
    });
  }
  if (nextTeacherId) {
    await tx.classHomeroomAssignment.create({
      data: { class_id: classId, employee_id: nextTeacherId },
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

    if (createRequest.homeroom_teacher_id) {
      await assertHomeroomTeacherIsActive(createRequest.homeroom_teacher_id);
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

        return created;
      });
    } catch (error) {
      rethrowAsFriendlyClassConflict(error);
    }

    await AuditService.record({
      action: AuditAction.CREATE_CLASS,
      source: AuditSource.UI,
      entity_type: "Class",
      entity_id: klass.id,
      admin_id: admin.id,
      new_values: toClassAuditSnapshot(klass),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toClassResponse(klass);
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

    if (updateRequest.homeroom_teacher_id) {
      await assertHomeroomTeacherIsActive(updateRequest.homeroom_teacher_id);
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

        return updated;
      });
    } catch (error) {
      rethrowAsFriendlyClassConflict(error);
    }

    await AuditService.record({
      action: AuditAction.UPDATE_CLASS,
      source: AuditSource.UI,
      entity_type: "Class",
      entity_id: klass.id,
      admin_id: admin.id,
      old_values: toClassAuditSnapshot(existing),
      new_values: toClassAuditSnapshot(klass),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toClassResponse(klass);
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

    await prismaClient.class.delete({
      where: { id: deleteRequest.id },
    });

    await AuditService.record({
      action: AuditAction.DELETE_CLASS,
      source: AuditSource.UI,
      entity_type: "Class",
      entity_id: existing.id,
      admin_id: admin.id,
      old_values: toClassAuditSnapshot(existing),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
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

    return toClassResponse(klass);
  }

  static async getHomeroomHistory(
    admin: AdminUser,
    request: GetClassRequest,
  ): Promise<ClassHomeroomAssignmentResponse[]> {
    void admin;

    const klass = await prismaClient.class.findUnique({
      where: { id: request.id },
    });
    if (!klass) {
      throw new ResponseError(404, "Class not found");
    }

    const assignments: ClassHomeroomAssignmentWithEmployee[] =
      await prismaClient.classHomeroomAssignment.findMany({
        where: { class_id: request.id },
        include: { employee: { include: { person: true } } },
        orderBy: { start_date: "desc" },
      });

    return assignments.map(toClassHomeroomAssignmentResponse);
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
      findMany: () =>
        prismaClient.class
          .findMany({
            where,
            include: CLASS_INCLUDE,
            take: searchRequest.size,
            skip,
            orderBy: buildClassOrderBy(
              searchRequest.sort_by || "created_at",
              searchRequest.sort_order || "desc",
            ),
          })
          .then((classes) => classes.map(toClassResponse)),
    });
  }
}

function buildClassOrderBy(sortBy: ClassSortField, sortOrder: "asc" | "desc") {
  if (sortBy === "grade_level") {
    return { grade: { level: sortOrder } };
  }
  return { [sortBy]: sortOrder };
}
