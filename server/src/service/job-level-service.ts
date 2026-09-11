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
  toJobLevelAuditSnapshot,
  toJobLevelResponse,
  type CreateJobLevelRequest,
  type DeleteJobLevelRequest,
  type GetJobLevelRequest,
  type JobLevelReassignmentPreviewItem,
  type JobLevelResponse,
  type JobLevelSortField,
  type PreviewJobLevelReassignmentRequest,
  type SearchJobLevelRequest,
  type UpdateJobLevelRequest,
} from "../model/job-level-model";
import { paginate, type Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { JobLevelValidation } from "../validation/job-level-validation";
import { Validation } from "../validation/validation";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import { jobPositionAndJobLevelAreCompatible } from "../utils/employee-role-rules";

const JOB_LEVEL_WITH_UNITS_INCLUDE = {
  units: { include: { unit: true } },
} as const;

function rethrowAsFriendlyJobLevelConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("name")) {
    throw new ResponseError(400, "A job level with this name already exists");
  }
  throw error;
}

// Returns the deduplicated, DB-confirmed unit IDs to actually write - never
// the raw request array. A duplicate ID in the request (or a caller hitting
// the API directly, bypassing the checkbox UI that can't produce one) would
// otherwise reach createMany() as-is and crash on the composite PK, since
// (job_level_id, unit_id) can only appear once. Mirrors
// api-client-service.ts's scope resolution (query by `in`, build the write
// from the query result - findMany naturally collapses duplicate IDs).
async function resolveUnitIds(unitIds: string[]): Promise<string[]> {
  if (unitIds.length === 0) return [];
  const units = await prismaClient.masterUnit.findMany({
    where: { id: { in: unitIds } },
    select: { id: true },
  });
  if (units.length !== new Set(unitIds).size) {
    throw new ResponseError(400, "One or more units were not found");
  }
  return units.map((unit) => unit.id);
}

// Symmetric to job-position-service.ts's assertJobPositionHasViableJobLevel -
// guards against a unit-scoped level whose every teaching/SE-compatible job
// position is ALSO unit-scoped, to a disjoint set of units, which would make
// this level permanently unassignable to any employee.
async function assertJobLevelHasViableJobPosition(
  levelName: string,
  isTeachingRole: boolean,
  levelUnitIds: string[],
): Promise<void> {
  if (levelUnitIds.length === 0) return;

  const positions = await prismaClient.masterJobPosition.findMany({
    include: { units: { select: { unit_id: true } } },
  });

  const compatiblePositions = positions.filter((position) =>
    jobPositionAndJobLevelAreCompatible(
      position.name,
      position.is_teaching_position,
      levelName,
      isTeachingRole,
    ),
  );
  if (compatiblePositions.length === 0) return;

  const levelUnitSet = new Set(levelUnitIds);
  const hasViablePosition = compatiblePositions.some((position) => {
    const positionUnitIds = position.units.map((u) => u.unit_id);
    return (
      positionUnitIds.length === 0 ||
      positionUnitIds.some((id) => levelUnitSet.has(id))
    );
  });

  if (!hasViablePosition) {
    throw new ResponseError(
      400,
      `Job level "${levelName}" would become unusable: every compatible job position is scoped to unit(s) that don't overlap with the selected unit(s). Widen this level's units, or adjust a compatible job position's units, so at least one combination is possible.`,
    );
  }
}

export class JobLevelService {
  static async create(
    admin: AdminUser,
    request: CreateJobLevelRequest,
    context: AuditRequestContext = {},
  ): Promise<JobLevelResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can create a job level",
      );
    }

    const createRequest = Validation.validate(
      JobLevelValidation.CREATE,
      request,
    );

    const existing = await prismaClient.masterJobLevel.findUnique({
      where: { name: createRequest.name },
    });
    if (existing) {
      throw new ResponseError(400, "A job level with this name already exists");
    }

    const unitIds = await resolveUnitIds(createRequest.unit_ids ?? []);
    await assertJobLevelHasViableJobPosition(
      createRequest.name,
      createRequest.is_teaching_role ?? false,
      unitIds,
    );

    let newJobLevelId: string;
    try {
      newJobLevelId = await prismaClient.$transaction(async (tx) => {
        const created = await tx.masterJobLevel.create({
          data: {
            name: createRequest.name,
            is_teaching_role: createRequest.is_teaching_role ?? false,
          },
        });

        if (unitIds.length > 0) {
          await tx.masterJobLevelUnit.createMany({
            data: unitIds.map((unitId) => ({
              job_level_id: created.id,
              unit_id: unitId,
            })),
          });
        }

        await AuditService.record(
          {
            action: AuditAction.CREATE_MASTER_DATA,
            source: AuditSource.UI,
            entity_type: "MasterJobLevel",
            entity_id: created.id,
            admin_id: admin.id,
            new_values: toJobLevelAuditSnapshot({
              name: created.name,
              is_teaching_role: created.is_teaching_role,
              unit_ids: unitIds,
            }),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return created.id;
      });
    } catch (error) {
      rethrowAsFriendlyJobLevelConflict(error);
    }

    const jobLevel = await prismaClient.masterJobLevel.findUniqueOrThrow({
      where: { id: newJobLevelId },
      include: JOB_LEVEL_WITH_UNITS_INCLUDE,
    });

    return toJobLevelResponse(jobLevel);
  }

  static async update(
    admin: AdminUser,
    request: UpdateJobLevelRequest,
    context: AuditRequestContext = {},
  ): Promise<JobLevelResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can update a job level",
      );
    }

    const updateRequest = Validation.validate(
      JobLevelValidation.UPDATE,
      request,
    );

    const existing = await prismaClient.masterJobLevel.findUnique({
      where: { id: updateRequest.id },
      include: JOB_LEVEL_WITH_UNITS_INCLUDE,
    });
    if (!existing) {
      throw new ResponseError(404, "Job level not found");
    }
    const existingUnitIds = existing.units.map((u) => u.unit_id);

    if (updateRequest.name && updateRequest.name !== existing.name) {
      const duplicate = await prismaClient.masterJobLevel.findUnique({
        where: { name: updateRequest.name },
      });
      if (duplicate) {
        throw new ResponseError(
          400,
          "A job level with this name already exists",
        );
      }
    }

    const requestedUnitIds = updateRequest.unit_ids;
    let nextUnitIds: string[] | undefined;
    if (requestedUnitIds !== undefined) {
      nextUnitIds = await resolveUnitIds(requestedUnitIds);

      // Same guard as JobPositionService.update: narrowing the unit set
      // could instantly orphan an already-hired employee. Widening to "any
      // unit" (empty array) only loosens the constraint, so it's skipped.
      if (nextUnitIds.length > 0) {
        const mismatchedEmployeeCount = await prismaClient.employee.count({
          where: {
            job_level_id: existing.id,
            unit_id: { notIn: nextUnitIds },
          },
        });
        if (mismatchedEmployeeCount > 0) {
          throw new ResponseError(
            400,
            `Cannot change this job level's units: ${mismatchedEmployeeCount} employee(s) on this level are in a unit outside the new selection. Move or reassign them first.`,
          );
        }
      }
    }

    // Re-run the viable-job-position sanity check whenever this update
    // could change the answer: the level's own unit scope changed, or its
    // teaching flag changed (which changes which positions even count as
    // "compatible" in the first place).
    if (
      (requestedUnitIds !== undefined ||
        updateRequest.is_teaching_role !== undefined) &&
      (nextUnitIds ?? existingUnitIds).length > 0
    ) {
      await assertJobLevelHasViableJobPosition(
        updateRequest.name ?? existing.name,
        updateRequest.is_teaching_role ?? existing.is_teaching_role,
        nextUnitIds ?? existingUnitIds,
      );
    }

    try {
      await prismaClient.$transaction(async (tx) => {
        const updated = await tx.masterJobLevel.update({
          where: { id: updateRequest.id },
          data: {
            name: updateRequest.name,
            is_teaching_role: updateRequest.is_teaching_role,
          },
        });

        if (nextUnitIds !== undefined) {
          await tx.masterJobLevelUnit.deleteMany({
            where: { job_level_id: existing.id },
          });
          if (nextUnitIds.length > 0) {
            await tx.masterJobLevelUnit.createMany({
              data: nextUnitIds.map((unitId) => ({
                job_level_id: existing.id,
                unit_id: unitId,
              })),
            });
          }
        }

        await AuditService.record(
          {
            action: AuditAction.UPDATE_MASTER_DATA,
            source: AuditSource.UI,
            entity_type: "MasterJobLevel",
            entity_id: updated.id,
            admin_id: admin.id,
            old_values: toJobLevelAuditSnapshot({
              name: existing.name,
              is_teaching_role: existing.is_teaching_role,
              unit_ids: existingUnitIds,
            }),
            new_values: toJobLevelAuditSnapshot({
              name: updated.name,
              is_teaching_role: updated.is_teaching_role,
              unit_ids: nextUnitIds ?? existingUnitIds,
            }),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );
      });
    } catch (error) {
      rethrowAsFriendlyJobLevelConflict(error);
    }

    const jobLevel = await prismaClient.masterJobLevel.findUniqueOrThrow({
      where: { id: updateRequest.id },
      include: JOB_LEVEL_WITH_UNITS_INCLUDE,
    });

    return toJobLevelResponse(jobLevel);
  }

  static async remove(
    admin: AdminUser,
    request: DeleteJobLevelRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete a job level",
      );
    }

    const deleteRequest = Validation.validate(
      JobLevelValidation.DELETE,
      request,
    );

    const existing = await prismaClient.masterJobLevel.findUnique({
      where: { id: deleteRequest.id },
      include: JOB_LEVEL_WITH_UNITS_INCLUDE,
    });
    if (!existing) {
      throw new ResponseError(404, "Job level not found");
    }

    const employeeCount = await prismaClient.employee.count({
      where: { job_level_id: deleteRequest.id },
    });
    if (employeeCount > 0) {
      throw new ResponseError(
        400,
        `Cannot delete: this job level is still referenced by ${employeeCount} employee(s). Reassign or remove those first.`,
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.masterJobLevel.delete({
        where: { id: deleteRequest.id },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_MASTER_DATA,
          source: AuditSource.UI,
          entity_type: "MasterJobLevel",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: toJobLevelAuditSnapshot({
            name: existing.name,
            is_teaching_role: existing.is_teaching_role,
            unit_ids: existing.units.map((u) => u.unit_id),
          }),
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
    request: GetJobLevelRequest,
  ): Promise<JobLevelResponse> {
    void admin;

    const jobLevel = await prismaClient.masterJobLevel.findUnique({
      where: { id: request.id },
      include: JOB_LEVEL_WITH_UNITS_INCLUDE,
    });
    if (!jobLevel) {
      throw new ResponseError(404, "Job level not found");
    }

    return toJobLevelResponse(jobLevel);
  }

  static async search(
    admin: AdminUser,
    request: SearchJobLevelRequest,
  ): Promise<Pageable<JobLevelResponse>> {
    void admin;

    const searchRequest = Validation.validate(
      JobLevelValidation.SEARCH,
      request,
    );

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const where = {
      name: searchRequest.search
        ? { contains: searchRequest.search, mode: "insensitive" as const }
        : undefined,
    };

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.masterJobLevel.count({ where }),
      findMany: () =>
        prismaClient.masterJobLevel
          .findMany({
            where,
            take: searchRequest.size,
            skip,
            include: JOB_LEVEL_WITH_UNITS_INCLUDE,
            orderBy: buildJobLevelOrderBy(
              searchRequest.sort_by || "name",
              searchRequest.sort_order || "asc",
            ),
          })
          .then((jobLevels) => jobLevels.map(toJobLevelResponse)),
    });
  }

  // Symmetric to job-position-service.ts's previewReassignmentImpact.
  static async previewReassignmentImpact(
    admin: AdminUser,
    request: PreviewJobLevelReassignmentRequest,
  ): Promise<Pageable<JobLevelReassignmentPreviewItem>> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can preview job level reassignment impact",
      );
    }

    const previewRequest = Validation.validate(
      JobLevelValidation.PREVIEW_REASSIGNMENT,
      request,
    );

    const existing = await prismaClient.masterJobLevel.findUnique({
      where: { id: previewRequest.id },
    });
    if (!existing) {
      throw new ResponseError(404, "Job level not found");
    }

    if (previewRequest.unit_ids.length === 0) {
      return {
        data: [],
        paging: {
          size: previewRequest.size,
          current_page: previewRequest.page,
          total_page: 0,
          total_item: 0,
        },
      };
    }

    const where = {
      job_level_id: previewRequest.id,
      unit_id: { notIn: previewRequest.unit_ids },
    };
    const skip = (previewRequest.page - 1) * previewRequest.size;

    return paginate(previewRequest.page, previewRequest.size, {
      count: () => prismaClient.employee.count({ where }),
      findMany: () =>
        prismaClient.employee
          .findMany({
            where,
            take: previewRequest.size,
            skip,
            include: { person: true, unit: true },
            orderBy: { person: { full_name: "asc" } },
          })
          .then((employees) =>
            employees.map((employee) => ({
              employee_id: employee.id,
              employee_number: employee.employee_id,
              full_name: employee.person.full_name,
              unit_name: employee.unit.name,
            })),
          ),
    });
  }
}

function buildJobLevelOrderBy(
  sortBy: JobLevelSortField,
  sortOrder: "asc" | "desc",
) {
  return { [sortBy]: sortOrder };
}
