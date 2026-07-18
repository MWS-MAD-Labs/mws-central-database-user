import {
  AdminRole,
  AuditAction,
  AuditSource,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toClassAuditSnapshot,
  toClassResponse,
  type ClassResponse,
  type ClassSortField,
  type ClassWithRelations,
  type CreateClassRequest,
  type DeleteClassRequest,
  type GetClassRequest,
  type SearchClassRequest,
  type UpdateClassRequest,
} from "../model/class-model";
import type { Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { ClassValidation } from "../validation/class-validation";
import { Validation } from "../validation/validation";

const CLASS_INCLUDE = { grade: true, academic_year: true } as const;

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
      const teacher = await prismaClient.employee.findUnique({
        where: { id: createRequest.homeroom_teacher_id },
      });
      if (!teacher) {
        throw new ResponseError(
          400,
          "Invalid homeroom teacher: referenced employee does not exist",
        );
      }
    }

    const klass: ClassWithRelations = await prismaClient.class.create({
      data: {
        name: createRequest.name,
        grade_id: createRequest.grade_id,
        academic_year_id: createRequest.academic_year_id,
        homeroom_teacher_id: createRequest.homeroom_teacher_id,
        status: createRequest.status,
      },
      include: CLASS_INCLUDE,
    });

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
      const teacher = await prismaClient.employee.findUnique({
        where: { id: updateRequest.homeroom_teacher_id },
      });
      if (!teacher) {
        throw new ResponseError(
          400,
          "Invalid homeroom teacher: referenced employee does not exist",
        );
      }
    }

    const klass = await prismaClient.class.update({
      where: { id: updateRequest.id },
      data: {
        name: updateRequest.name,
        grade_id: updateRequest.grade_id,
        academic_year_id: updateRequest.academic_year_id,
        homeroom_teacher_id: updateRequest.homeroom_teacher_id,
        status: updateRequest.status,
      },
      include: CLASS_INCLUDE,
    });

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

    const totalItems = await prismaClient.class.count({ where });

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

    return {
      data: classes.map(toClassResponse),
      paging: {
        size: searchRequest.size,
        current_page: searchRequest.page,
        total_page: Math.ceil(totalItems / searchRequest.size),
        total_item: totalItems,
      },
    };
  }
}

function buildClassOrderBy(sortBy: ClassSortField, sortOrder: "asc" | "desc") {
  if (sortBy === "grade_level") {
    return { grade: { level: sortOrder } };
  }
  return { [sortBy]: sortOrder };
}
