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
  toJobPositionAuditSnapshot,
  toJobPositionResponse,
  type CreateJobPositionRequest,
  type DeleteJobPositionRequest,
  type GetJobPositionRequest,
  type JobPositionReassignmentPreviewItem,
  type JobPositionResponse,
  type JobPositionSortField,
  type PreviewJobPositionReassignmentRequest,
  type SearchJobPositionRequest,
  type UpdateJobPositionRequest,
} from "../model/job-position-model";
import { paginate, type Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { JobPositionValidation } from "../validation/job-position-validation";
import { Validation } from "../validation/validation";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import { jobPositionAndJobLevelAreCompatible } from "../utils/employee-role-rules";

const JOB_POSITION_WITH_UNITS_INCLUDE = {
  units: { include: { unit: true } },
} as const;

function rethrowAsFriendlyJobPositionConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("name")) {
    throw new ResponseError(400, "A job position with this name already exists");
  }
  throw error;
}

// Returns the deduplicated, DB-confirmed unit IDs to actually write - never
// the raw request array. A duplicate ID in the request (or a caller hitting
// the API directly, bypassing the checkbox UI that can't produce one) would
// otherwise reach createMany() as-is and crash on the composite PK, since
// (job_position_id, unit_id) can only appear once. Mirrors
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

// Guards against a dead-on-arrival master-data combo: a unit-scoped position
// whose every teaching/SE-compatible job level is ALSO unit-scoped, to a
// disjoint set of units. If that happens, no employee's unit could ever
// satisfy both this position's and any compatible level's constraint at
// once - the position becomes permanently unassignable, and the rejection
// an admin eventually sees at employee-create time (from whichever unit
// they happened to try) doesn't explain why. Skipped entirely for
// unit-agnostic positions (unitIds empty) and when no compatible level
// exists at all (a separate, pre-existing gap this isn't meant to catch).
async function assertJobPositionHasViableJobLevel(
  positionName: string,
  isTeachingPosition: boolean,
  positionUnitIds: string[],
): Promise<void> {
  if (positionUnitIds.length === 0) return;

  const levels = await prismaClient.masterJobLevel.findMany({
    include: { units: { select: { unit_id: true } } },
  });

  const compatibleLevels = levels.filter((level) =>
    jobPositionAndJobLevelAreCompatible(
      positionName,
      isTeachingPosition,
      level.name,
      level.is_teaching_role,
    ),
  );
  if (compatibleLevels.length === 0) return;

  const positionUnitSet = new Set(positionUnitIds);
  const hasViableLevel = compatibleLevels.some((level) => {
    const levelUnitIds = level.units.map((u) => u.unit_id);
    return (
      levelUnitIds.length === 0 ||
      levelUnitIds.some((id) => positionUnitSet.has(id))
    );
  });

  if (!hasViableLevel) {
    throw new ResponseError(
      400,
      `Job position "${positionName}" would become unusable: every compatible job level is scoped to unit(s) that don't overlap with the selected unit(s). Widen this position's units, or adjust a compatible job level's units, so at least one combination is possible.`,
    );
  }
}

export class JobPositionService {
  static async create(
    admin: AdminUser,
    request: CreateJobPositionRequest,
    context: AuditRequestContext = {},
  ): Promise<JobPositionResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can create a job position",
      );
    }

    const createRequest = Validation.validate(
      JobPositionValidation.CREATE,
      request,
    );

    const existing = await prismaClient.masterJobPosition.findUnique({
      where: { name: createRequest.name },
    });
    if (existing) {
      throw new ResponseError(400, "A job position with this name already exists");
    }

    const unitIds = await resolveUnitIds(createRequest.unit_ids ?? []);
    await assertJobPositionHasViableJobLevel(
      createRequest.name,
      createRequest.is_teaching_position ?? false,
      unitIds,
    );

    let newJobPositionId: string;
    try {
      newJobPositionId = await prismaClient.$transaction(async (tx) => {
        const created = await tx.masterJobPosition.create({
          data: {
            name: createRequest.name,
            is_teaching_position: createRequest.is_teaching_position ?? false,
          },
        });

        if (unitIds.length > 0) {
          await tx.masterJobPositionUnit.createMany({
            data: unitIds.map((unitId) => ({
              job_position_id: created.id,
              unit_id: unitId,
            })),
          });
        }

        await AuditService.record(
          {
            action: AuditAction.CREATE_MASTER_DATA,
            source: AuditSource.UI,
            entity_type: "MasterJobPosition",
            entity_id: created.id,
            admin_id: admin.id,
            new_values: toJobPositionAuditSnapshot({
              name: created.name,
              is_teaching_position: created.is_teaching_position,
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
      rethrowAsFriendlyJobPositionConflict(error);
    }

    const jobPosition = await prismaClient.masterJobPosition.findUniqueOrThrow(
      {
        where: { id: newJobPositionId },
        include: JOB_POSITION_WITH_UNITS_INCLUDE,
      },
    );

    return toJobPositionResponse(jobPosition);
  }

  static async update(
    admin: AdminUser,
    request: UpdateJobPositionRequest,
    context: AuditRequestContext = {},
  ): Promise<JobPositionResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can update a job position",
      );
    }

    const updateRequest = Validation.validate(
      JobPositionValidation.UPDATE,
      request,
    );

    const existing = await prismaClient.masterJobPosition.findUnique({
      where: { id: updateRequest.id },
      include: JOB_POSITION_WITH_UNITS_INCLUDE,
    });
    if (!existing) {
      throw new ResponseError(404, "Job position not found");
    }
    const existingUnitIds = existing.units.map((u) => u.unit_id);

    if (updateRequest.name && updateRequest.name !== existing.name) {
      const duplicate = await prismaClient.masterJobPosition.findUnique({
        where: { name: updateRequest.name },
      });
      if (duplicate) {
        throw new ResponseError(
          400,
          "A job position with this name already exists",
        );
      }
    }

    const requestedUnitIds = updateRequest.unit_ids;
    let nextUnitIds: string[] | undefined;
    if (requestedUnitIds !== undefined) {
      nextUnitIds = await resolveUnitIds(requestedUnitIds);

      // Narrowing (or clearing to a specific set) could instantly orphan any
      // employee currently on this position outside the new unit set - same
      // class of problem assertNoActiveTeacherAssignmentsBlockingRoleChange
      // in employee-service.ts guards against, just from the other side.
      // Widening to "any unit" (empty array) only ever loosens the
      // constraint, so it's always safe and skips this check entirely.
      if (nextUnitIds.length > 0) {
        const mismatchedEmployeeCount = await prismaClient.employee.count({
          where: {
            job_position_id: existing.id,
            unit_id: { notIn: nextUnitIds },
          },
        });
        if (mismatchedEmployeeCount > 0) {
          throw new ResponseError(
            400,
            `Cannot change this job position's units: ${mismatchedEmployeeCount} employee(s) on this position are in a unit outside the new selection. Move or reassign them first.`,
          );
        }
      }
    }

    // Re-run the viable-job-level sanity check whenever this update could
    // change the answer: the position's own unit scope changed, or its
    // teaching flag changed (which changes which levels even count as
    // "compatible" in the first place).
    if (
      (requestedUnitIds !== undefined ||
        updateRequest.is_teaching_position !== undefined) &&
      (nextUnitIds ?? existingUnitIds).length > 0
    ) {
      await assertJobPositionHasViableJobLevel(
        updateRequest.name ?? existing.name,
        updateRequest.is_teaching_position ?? existing.is_teaching_position,
        nextUnitIds ?? existingUnitIds,
      );
    }

    try {
      await prismaClient.$transaction(async (tx) => {
        const updated = await tx.masterJobPosition.update({
          where: { id: updateRequest.id },
          data: {
            name: updateRequest.name,
            is_teaching_position: updateRequest.is_teaching_position,
          },
        });

        if (nextUnitIds !== undefined) {
          await tx.masterJobPositionUnit.deleteMany({
            where: { job_position_id: existing.id },
          });
          if (nextUnitIds.length > 0) {
            await tx.masterJobPositionUnit.createMany({
              data: nextUnitIds.map((unitId) => ({
                job_position_id: existing.id,
                unit_id: unitId,
              })),
            });
          }
        }

        await AuditService.record(
          {
            action: AuditAction.UPDATE_MASTER_DATA,
            source: AuditSource.UI,
            entity_type: "MasterJobPosition",
            entity_id: updated.id,
            admin_id: admin.id,
            old_values: toJobPositionAuditSnapshot({
              name: existing.name,
              is_teaching_position: existing.is_teaching_position,
              unit_ids: existingUnitIds,
            }),
            new_values: toJobPositionAuditSnapshot({
              name: updated.name,
              is_teaching_position: updated.is_teaching_position,
              unit_ids: nextUnitIds ?? existingUnitIds,
            }),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );
      });
    } catch (error) {
      rethrowAsFriendlyJobPositionConflict(error);
    }

    const jobPosition = await prismaClient.masterJobPosition.findUniqueOrThrow(
      {
        where: { id: updateRequest.id },
        include: JOB_POSITION_WITH_UNITS_INCLUDE,
      },
    );

    return toJobPositionResponse(jobPosition);
  }

  static async remove(
    admin: AdminUser,
    request: DeleteJobPositionRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete a job position",
      );
    }

    const deleteRequest = Validation.validate(
      JobPositionValidation.DELETE,
      request,
    );

    const existing = await prismaClient.masterJobPosition.findUnique({
      where: { id: deleteRequest.id },
      include: JOB_POSITION_WITH_UNITS_INCLUDE,
    });
    if (!existing) {
      throw new ResponseError(404, "Job position not found");
    }

    const employeeCount = await prismaClient.employee.count({
      where: { job_position_id: deleteRequest.id },
    });
    if (employeeCount > 0) {
      throw new ResponseError(
        400,
        `Cannot delete: this job position is still referenced by ${employeeCount} employee(s). Reassign or remove those first.`,
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.masterJobPosition.delete({
        where: { id: deleteRequest.id },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_MASTER_DATA,
          source: AuditSource.UI,
          entity_type: "MasterJobPosition",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: toJobPositionAuditSnapshot({
            name: existing.name,
            is_teaching_position: existing.is_teaching_position,
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
    request: GetJobPositionRequest,
  ): Promise<JobPositionResponse> {
    void admin;

    const jobPosition = await prismaClient.masterJobPosition.findUnique({
      where: { id: request.id },
      include: JOB_POSITION_WITH_UNITS_INCLUDE,
    });
    if (!jobPosition) {
      throw new ResponseError(404, "Job position not found");
    }

    return toJobPositionResponse(jobPosition);
  }

  static async search(
    admin: AdminUser,
    request: SearchJobPositionRequest,
  ): Promise<Pageable<JobPositionResponse>> {
    void admin;

    const searchRequest = Validation.validate(
      JobPositionValidation.SEARCH,
      request,
    );

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const where = {
      name: searchRequest.search
        ? { contains: searchRequest.search, mode: "insensitive" as const }
        : undefined,
    };

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.masterJobPosition.count({ where }),
      findMany: () =>
        prismaClient.masterJobPosition
          .findMany({
            where,
            take: searchRequest.size,
            skip,
            include: JOB_POSITION_WITH_UNITS_INCLUDE,
            orderBy: buildJobPositionOrderBy(
              searchRequest.sort_by || "name",
              searchRequest.sort_order || "asc",
            ),
          })
          .then((jobPositions) => jobPositions.map(toJobPositionResponse)),
    });
  }

  // Powers the "who would this narrowing block on" preview in the admin
  // UI - same query shape as the mismatchedEmployeeCount guard in update()
  // above, just returning the actual rows (paginated) instead of a count,
  // so the admin knows who to reassign instead of just how many.
  static async previewReassignmentImpact(
    admin: AdminUser,
    request: PreviewJobPositionReassignmentRequest,
  ): Promise<Pageable<JobPositionReassignmentPreviewItem>> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can preview job position reassignment impact",
      );
    }

    const previewRequest = Validation.validate(
      JobPositionValidation.PREVIEW_REASSIGNMENT,
      request,
    );

    const existing = await prismaClient.masterJobPosition.findUnique({
      where: { id: previewRequest.id },
    });
    if (!existing) {
      throw new ResponseError(404, "Job position not found");
    }

    // Empty unit_ids means "any unit" (widening) - nobody can ever be
    // "outside" an unrestricted set, so there's nothing to preview.
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
      job_position_id: previewRequest.id,
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

function buildJobPositionOrderBy(
  sortBy: JobPositionSortField,
  sortOrder: "asc" | "desc",
) {
  return { [sortBy]: sortOrder };
}
