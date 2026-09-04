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

// Only these 3 units ever have grades under them (deriveUnitCode() in
// nis-generator.ts backfills exactly this set) - the other seeded units
// (BRIDGE, Pelangi, ...) are support/dept units, not academic ones.
const ACADEMIC_UNIT_NAMES = ["Kindergarten", "Elementary", "Junior High"];

function assertAcademicUnit(unit: { name: string } | null): void {
  if (unit && !ACADEMIC_UNIT_NAMES.includes(unit.name)) {
    throw new ResponseError(
      400,
      `Unit must be an academic unit (${ACADEMIC_UNIT_NAMES.join(", ")}) to have grades`,
    );
  }
}

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

    const [duplicateName, duplicateLevel, unit] = await Promise.all([
      prismaClient.grade.findUnique({ where: { name: createRequest.name } }),
      prismaClient.grade.findUnique({ where: { level: createRequest.level } }),
      createRequest.unit_id
        ? prismaClient.masterUnit.findUnique({
            where: { id: createRequest.unit_id },
          })
        : Promise.resolve(null),
    ]);
    if (duplicateName) {
      throw new ResponseError(400, "A grade with this name already exists");
    }
    if (duplicateLevel) {
      throw new ResponseError(400, "A grade with this level already exists");
    }
    if (createRequest.unit_id && !unit) {
      throw new ResponseError(400, "Unit not found");
    }
    assertAcademicUnit(unit);

    let newGrade;
    try {
      newGrade = await prismaClient.$transaction(async (tx) => {
        const created = await tx.grade.create({
          data: {
            name: createRequest.name,
            level: createRequest.level,
            unit_id: createRequest.unit_id ?? null,
            typical_age: createRequest.typical_age ?? null,
          },
        });

        await AuditService.record(
          {
            action: AuditAction.CREATE_MASTER_DATA,
            source: AuditSource.UI,
            entity_type: "Grade",
            entity_id: created.id,
            admin_id: admin.id,
            new_values: toGradeAuditSnapshot(created),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return created;
      });
    } catch (error) {
      rethrowAsFriendlyGradeConflict(error);
    }

    const grade = await prismaClient.grade.findUniqueOrThrow({
      where: { id: newGrade.id },
      include: { unit: true },
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

    if (updateRequest.unit_id) {
      const unit = await prismaClient.masterUnit.findUnique({
        where: { id: updateRequest.unit_id },
      });
      if (!unit) {
        throw new ResponseError(400, "Unit not found");
      }
      assertAcademicUnit(unit);
    }

    let updatedGradeId;
    try {
      updatedGradeId = await prismaClient.$transaction(async (tx) => {
        const updatedGrade = await tx.grade.update({
          where: { id: updateRequest.id },
          data: {
            name: updateRequest.name,
            level: updateRequest.level,
            unit_id:
              updateRequest.unit_id === undefined
                ? undefined
                : updateRequest.unit_id,
            typical_age:
              updateRequest.typical_age === undefined
                ? undefined
                : updateRequest.typical_age,
          },
        });

        await AuditService.record(
          {
            action: AuditAction.UPDATE_MASTER_DATA,
            source: AuditSource.UI,
            entity_type: "Grade",
            entity_id: updatedGrade.id,
            admin_id: admin.id,
            old_values: toGradeAuditSnapshot(existing),
            new_values: toGradeAuditSnapshot(updatedGrade),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return updatedGrade.id;
      });
    } catch (error) {
      rethrowAsFriendlyGradeConflict(error);
    }

    const grade = await prismaClient.grade.findUniqueOrThrow({
      where: { id: updatedGradeId },
      include: { unit: true },
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

    const [classCount, currentGradeCount, joinGradeCount] = await Promise.all([
      prismaClient.class.count({
        where: { grade_id: deleteRequest.id },
      }),
      prismaClient.student.count({
        where: { current_grade_id: deleteRequest.id },
      }),
      prismaClient.student.count({
        where: { join_grade_id: deleteRequest.id },
      }),
    ]);

    const usages: string[] = [];
    if (classCount > 0) usages.push(`${classCount} class(es)`);
    if (currentGradeCount > 0) {
      usages.push(`${currentGradeCount} student(s) currently in this grade`);
    }
    if (joinGradeCount > 0) {
      usages.push(`${joinGradeCount} student(s) who joined at this grade`);
    }

    if (usages.length > 0) {
      throw new ResponseError(
        400,
        `Cannot delete: this grade is still referenced by ${usages.join(", ")}. Reassign or remove those first.`,
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.grade.delete({
        where: { id: deleteRequest.id },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_MASTER_DATA,
          source: AuditSource.UI,
          entity_type: "Grade",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: toGradeAuditSnapshot(existing),
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
    request: GetGradeRequest,
  ): Promise<GradeResponse> {
    const grade = await prismaClient.grade.findUnique({
      where: { id: request.id },
      include: { unit: true },
    });
    if (!grade) {
      throw new ResponseError(404, "Grade not found");
    }

    // Same posture as Class/Student/Employee's own get() - a DATABASE_ADMIN
    // without can_view_all_units gets 404, not 403, so a grade outside
    // their unit doesn't even confirm it exists. The legacy-import
    // sentinel grade (unit_id: null) stays visible to everyone - it isn't
    // owned by any one unit.
    if (
      admin.role === AdminRole.DATABASE_ADMIN &&
      !admin.can_view_all_units &&
      grade.unit_id !== null &&
      grade.unit_id !== admin.unit_id
    ) {
      throw new ResponseError(404, "Grade not found");
    }

    return toGradeResponse(grade);
  }

  static async search(
    admin: AdminUser,
    request: SearchGradeRequest,
  ): Promise<Pageable<GradeResponse>> {
    const searchRequest = Validation.validate(GradeValidation.SEARCH, request);

    // Same posture as Class/Student/Employee's own search() - a
    // DATABASE_ADMIN without can_view_all_units only sees their own unit's
    // grades (plus the unit-less legacy-import sentinel, which every role
    // can see - it isn't owned by any one unit). Otherwise the Students
    // page's Grade filter offers every other unit's grades too, which just
    // returns zero results when picked.
    const unitScope =
      admin.role === AdminRole.DATABASE_ADMIN && !admin.can_view_all_units
        ? admin.unit_id
        : undefined;

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const where = {
      name: searchRequest.search
        ? { contains: searchRequest.search, mode: "insensitive" as const }
        : undefined,
      ...(unitScope ? { OR: [{ unit_id: unitScope }, { unit_id: null }] } : {}),
    };

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.grade.count({ where }),
      findMany: () =>
        prismaClient.grade
          .findMany({
            where,
            include: { unit: true },
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
