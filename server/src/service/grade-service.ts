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
  toGradeAuditSnapshot,
  toGradeResponse,
  type CreateGradeRequest,
  type DeleteGradeRequest,
  type GetGradeRequest,
  type GradeResponse,
  type GradeSortField,
  type SearchGradeRequest,
  type UpdateGradeRequest,
} from "../model/grade-model";
import { paginate, type Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { GradeValidation } from "../validation/grade-validation";
import { Validation } from "../validation/validation";
import { getUniqueConstraintFields } from "../utils/prisma-error";

function rethrowAsFriendlyGradeConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("name")) {
    throw new ResponseError(400, "A grade with this name already exists");
  }
  if (fields?.includes("level")) {
    throw new ResponseError(400, "A grade with this level already exists");
  }
  throw error;
}

export class GradeService {
  static async create(
    admin: AdminUser,
    request: CreateGradeRequest,
    context: AuditRequestContext = {},
  ): Promise<GradeResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can create a grade",
      );
    }

    const createRequest = Validation.validate(GradeValidation.CREATE, request);

    const [duplicateName, duplicateLevel] = await Promise.all([
      prismaClient.grade.findUnique({ where: { name: createRequest.name } }),
      prismaClient.grade.findUnique({ where: { level: createRequest.level } }),
    ]);
    if (duplicateName) {
      throw new ResponseError(400, "A grade with this name already exists");
    }
    if (duplicateLevel) {
      throw new ResponseError(400, "A grade with this level already exists");
    }

    let grade;
    try {
      grade = await prismaClient.grade.create({
        data: {
          name: createRequest.name,
          level: createRequest.level,
        },
      });
    } catch (error) {
      rethrowAsFriendlyGradeConflict(error);
    }

    await AuditService.record({
      action: AuditAction.CREATE_MASTER_DATA,
      source: AuditSource.UI,
      entity_type: "Grade",
      entity_id: grade.id,
      admin_id: admin.id,
      new_values: toGradeAuditSnapshot(grade),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toGradeResponse(grade);
  }

  static async update(
    admin: AdminUser,
    request: UpdateGradeRequest,
    context: AuditRequestContext = {},
  ): Promise<GradeResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can update a grade",
      );
    }

    const updateRequest = Validation.validate(GradeValidation.UPDATE, request);

    const existing = await prismaClient.grade.findUnique({
      where: { id: updateRequest.id },
    });
    if (!existing) {
      throw new ResponseError(404, "Grade not found");
    }

    if (updateRequest.name && updateRequest.name !== existing.name) {
      const duplicate = await prismaClient.grade.findUnique({
        where: { name: updateRequest.name },
      });
      if (duplicate) {
        throw new ResponseError(400, "A grade with this name already exists");
      }
    }

    if (
      updateRequest.level !== undefined &&
      updateRequest.level !== existing.level
    ) {
      const duplicate = await prismaClient.grade.findUnique({
        where: { level: updateRequest.level },
      });
      if (duplicate) {
        throw new ResponseError(400, "A grade with this level already exists");
      }
    }

    let grade;
    try {
      grade = await prismaClient.grade.update({
        where: { id: updateRequest.id },
        data: {
          name: updateRequest.name,
          level: updateRequest.level,
        },
      });
    } catch (error) {
      rethrowAsFriendlyGradeConflict(error);
    }

    await AuditService.record({
      action: AuditAction.UPDATE_MASTER_DATA,
      source: AuditSource.UI,
      entity_type: "Grade",
      entity_id: grade.id,
      admin_id: admin.id,
      old_values: toGradeAuditSnapshot(existing),
      new_values: toGradeAuditSnapshot(grade),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toGradeResponse(grade);
  }

  static async remove(
    admin: AdminUser,
    request: DeleteGradeRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete a grade",
      );
    }

    const deleteRequest = Validation.validate(GradeValidation.DELETE, request);

    const existing = await prismaClient.grade.findUnique({
      where: { id: deleteRequest.id },
    });
    if (!existing) {
      throw new ResponseError(404, "Grade not found");
    }

    const classCount = await prismaClient.class.count({
      where: { grade_id: deleteRequest.id },
    });
    if (classCount > 0) {
      throw new ResponseError(
        400,
        `Cannot delete: this grade is still referenced by ${classCount} class(es). Reassign or remove those first.`,
      );
    }

    await prismaClient.grade.delete({ where: { id: deleteRequest.id } });

    await AuditService.record({
      action: AuditAction.DELETE_MASTER_DATA,
      source: AuditSource.UI,
      entity_type: "Grade",
      entity_id: existing.id,
      admin_id: admin.id,
      old_values: toGradeAuditSnapshot(existing),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return true;
  }

  static async get(
    admin: AdminUser,
    request: GetGradeRequest,
  ): Promise<GradeResponse> {
    void admin;

    const grade = await prismaClient.grade.findUnique({
      where: { id: request.id },
    });
    if (!grade) {
      throw new ResponseError(404, "Grade not found");
    }

    return toGradeResponse(grade);
  }

  static async search(
    admin: AdminUser,
    request: SearchGradeRequest,
  ): Promise<Pageable<GradeResponse>> {
    void admin;

    const searchRequest = Validation.validate(GradeValidation.SEARCH, request);

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const where = {
      name: searchRequest.search
        ? { contains: searchRequest.search, mode: "insensitive" as const }
        : undefined,
    };

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.grade.count({ where }),
      findMany: () =>
        prismaClient.grade
          .findMany({
            where,
            take: searchRequest.size,
            skip,
            orderBy: buildGradeOrderBy(
              searchRequest.sort_by || "level",
              searchRequest.sort_order || "asc",
            ),
          })
          .then((grades) => grades.map(toGradeResponse)),
    });
  }
}

function buildGradeOrderBy(sortBy: GradeSortField, sortOrder: "asc" | "desc") {
  return { [sortBy]: sortOrder };
}
