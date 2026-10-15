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
import { UNKNOWN_LEGACY_UNIT_NAME } from "../utils/legacy-unit";
import { AuditService } from "./audit-service";
import { GradeValidation } from "../validation/grade-validation";
import { Validation } from "../validation/validation";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import {
  UNKNOWN_LEGACY_GRADE_LEVEL,
  UNKNOWN_LEGACY_GRADE_NAME,
} from "../model/grade-model";
import {
  resolveAcademicUnitScope,
  type AdminUserWithAcademicScope,
} from "../utils/admin-permissions";

// Grades belong only to academic units used by NIS generation.

const ACADEMIC_UNIT_NAMES = [
  "Kindergarten",
  "Elementary",
  "Junior High",
  UNKNOWN_LEGACY_UNIT_NAME,
];

function expectedUnitName(name: string, level: number): string | null {
  if (name === UNKNOWN_LEGACY_GRADE_NAME || level === UNKNOWN_LEGACY_GRADE_LEVEL) {
    return UNKNOWN_LEGACY_UNIT_NAME;
  }
  if (level >= -3 && level <= 0) return "Kindergarten";
  if (level >= 1 && level <= 6) return "Elementary";
  if (level >= 7 && level <= 9) return "Junior High";
  return null;
}

async function resolveGradeUnit(
  name: string,
  level: number,
  requestedUnitId: string | null | undefined,
): Promise<{ id: string; name: string }> {
  const expectedName = expectedUnitName(name, level);
  if (expectedName) {
    const expectedUnit = await prismaClient.masterUnit.findUnique({
      where: { name: expectedName },
      select: { id: true, name: true },
    });
    if (!expectedUnit) {
      throw new ResponseError(400, `Required unit "${expectedName}" is not configured`);
    }
    if (requestedUnitId && requestedUnitId !== expectedUnit.id) {
      throw new ResponseError(
        400,
        `Grade level ${level} must belong to ${expectedName}`,
      );
    }
    return expectedUnit;
  }

  if (!requestedUnitId) {
    const legacyUnit = await prismaClient.masterUnit.findUnique({
      where: { name: UNKNOWN_LEGACY_UNIT_NAME },
      select: { id: true, name: true },
    });
    if (!legacyUnit) {
      throw new ResponseError(
        400,
        `Required unit "${UNKNOWN_LEGACY_UNIT_NAME}" is not configured`,
      );
    }
    return legacyUnit;
  }
  const unit = await prismaClient.masterUnit.findUnique({
    where: { id: requestedUnitId },
    select: { id: true, name: true },
  });
  if (!unit) throw new ResponseError(400, "Unit not found");
  assertAcademicUnit(unit);
  return unit;
}

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
      resolveGradeUnit(
        createRequest.name,
        createRequest.level,
        createRequest.unit_id,
      ),
    ]);
    if (duplicateName) {
      throw new ResponseError(400, "A grade with this name already exists");
    }
    if (duplicateLevel) {
      throw new ResponseError(400, "A grade with this level already exists");
    }
    let newGrade;
    try {
      newGrade = await prismaClient.$transaction(async (tx) => {
        const created = await tx.grade.create({
          data: {
            name: createRequest.name,
            level: createRequest.level,
            unit_id: unit.id,
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

    const nextName = updateRequest.name ?? existing.name;
    const nextLevel = updateRequest.level ?? existing.level;
    const requestedUnitId =
      updateRequest.unit_id === undefined ? existing.unit_id : updateRequest.unit_id;
    const unit = await resolveGradeUnit(
      nextName,
      nextLevel,
      requestedUnitId,
    );

    let updatedGradeId;
    try {
      updatedGradeId = await prismaClient.$transaction(async (tx) => {
        const updatedGrade = await tx.grade.update({
          where: { id: updateRequest.id },
          data: {
            name: updateRequest.name,
            level: updateRequest.level,
            unit_id: unit.id,
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

    const [
      classCount,
      currentGradeCount,
      joinGradeCount,
      enrollmentCount,
      roomGradeCount,
    ] = await Promise.all([
      prismaClient.class.count({
        where: { grade_id: deleteRequest.id },
      }),
      prismaClient.student.count({
        where: { current_grade_id: deleteRequest.id },
      }),
      prismaClient.student.count({
        where: { join_grade_id: deleteRequest.id },
      }),
      prismaClient.studentClassEnrollment.count({
        where: { grade_id: deleteRequest.id },
      }),
      prismaClient.pcActivityRoomGrade.count({
        where: { grade_id: deleteRequest.id },
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
    if (enrollmentCount > 0) usages.push(`${enrollmentCount} enrollment(s)`);
    if (roomGradeCount > 0) {
      usages.push(`${roomGradeCount} PC Activity room grade scope(s)`);
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
    admin: AdminUserWithAcademicScope,
    request: GetGradeRequest,
  ): Promise<GradeResponse> {
    const grade = await prismaClient.grade.findUnique({
      where: { id: request.id },
      include: { unit: true },
    });
    if (!grade) {
      throw new ResponseError(404, "Grade not found");
    }

    const unitScope = resolveAcademicUnitScope(admin);
    if (unitScope !== undefined && !unitScope.includes(grade.unit_id)) {
      throw new ResponseError(404, "Grade not found");
    }

    return toGradeResponse(grade);
  }

  static async search(
    admin: AdminUserWithAcademicScope,
    request: SearchGradeRequest,
  ): Promise<Pageable<GradeResponse>> {
    const searchRequest = Validation.validate(GradeValidation.SEARCH, request);

    const unitScope = resolveAcademicUnitScope(admin);

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const where = {
      name: searchRequest.search
        ? { contains: searchRequest.search, mode: "insensitive" as const }
        : undefined,
      ...(unitScope ? { unit_id: { in: unitScope } } : {}),
    };

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.grade.count({ where }),
      findMany: async () => {
        const grades = await prismaClient.grade.findMany({
          where,
          include: { unit: true },
          take: searchRequest.size,
          skip,
          orderBy: buildGradeOrderBy(
            searchRequest.sort_by || "level",
            searchRequest.sort_order || "asc",
          ),
        });
        const blockers = await getGradeDeleteBlockers(
          grades.map((grade) => grade.id),
        );
        return grades.map((grade) =>
          toGradeResponse(grade, blockers.get(grade.id)!),
        );
      },
    });
  }
}

function buildGradeOrderBy(sortBy: GradeSortField, sortOrder: "asc" | "desc") {
  return { [sortBy]: sortOrder };
}

// Batched has_dependents check for the list endpoint - same signals
// GradeService.remove() uses to reject a delete, computed once per page.
async function getGradeDeleteBlockers(
  gradeIds: string[],
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  for (const id of gradeIds) map.set(id, false);
  if (gradeIds.length === 0) return map;

  const [classGroups, currentGradeGroups, joinGradeGroups, enrollmentGroups, roomGradeGroups] =
    await Promise.all([
      prismaClient.class.groupBy({
        by: ["grade_id"],
        where: { grade_id: { in: gradeIds } },
        _count: { _all: true },
      }),
      prismaClient.student.groupBy({
        by: ["current_grade_id"],
        where: { current_grade_id: { in: gradeIds } },
        _count: { _all: true },
      }),
      prismaClient.student.groupBy({
        by: ["join_grade_id"],
        where: { join_grade_id: { in: gradeIds } },
        _count: { _all: true },
      }),
      prismaClient.studentClassEnrollment.groupBy({
        by: ["grade_id"],
        where: { grade_id: { in: gradeIds } },
        _count: { _all: true },
      }),
      prismaClient.pcActivityRoomGrade.groupBy({
        by: ["grade_id"],
        where: { grade_id: { in: gradeIds } },
        _count: { _all: true },
      }),
    ]);

  for (const group of classGroups) map.set(group.grade_id, true);
  for (const group of currentGradeGroups) {
    map.set(group.current_grade_id, true);
  }
  for (const group of joinGradeGroups) map.set(group.join_grade_id, true);
  for (const group of enrollmentGroups) map.set(group.grade_id, true);
  for (const group of roomGradeGroups) map.set(group.grade_id, true);
  return map;
}
