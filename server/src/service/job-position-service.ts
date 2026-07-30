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
  type JobPositionResponse,
  type JobPositionSortField,
  type SearchJobPositionRequest,
  type UpdateJobPositionRequest,
} from "../model/job-position-model";
import { paginate, type Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { JobPositionValidation } from "../validation/job-position-validation";
import { Validation } from "../validation/validation";
import { getUniqueConstraintFields } from "../utils/prisma-error";

function rethrowAsFriendlyJobPositionConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("name")) {
    throw new ResponseError(400, "A job position with this name already exists");
  }
  throw error;
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

    let jobPosition;
    try {
      jobPosition = await prismaClient.$transaction(async (tx) => {
        const newJobPosition = await tx.masterJobPosition.create({
          data: {
            name: createRequest.name,
            is_teaching_position: createRequest.is_teaching_position ?? false,
          },
        });

        await AuditService.record(
          {
            action: AuditAction.CREATE_MASTER_DATA,
            source: AuditSource.UI,
            entity_type: "MasterJobPosition",
            entity_id: newJobPosition.id,
            admin_id: admin.id,
            new_values: toJobPositionAuditSnapshot(newJobPosition),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return newJobPosition;
      });
    } catch (error) {
      rethrowAsFriendlyJobPositionConflict(error);
    }

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
    });
    if (!existing) {
      throw new ResponseError(404, "Job position not found");
    }

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

    let jobPosition;
    try {
      jobPosition = await prismaClient.$transaction(async (tx) => {
        const updatedJobPosition = await tx.masterJobPosition.update({
          where: { id: updateRequest.id },
          data: {
            name: updateRequest.name,
            is_teaching_position: updateRequest.is_teaching_position,
          },
        });

        await AuditService.record(
          {
            action: AuditAction.UPDATE_MASTER_DATA,
            source: AuditSource.UI,
            entity_type: "MasterJobPosition",
            entity_id: updatedJobPosition.id,
            admin_id: admin.id,
            old_values: toJobPositionAuditSnapshot(existing),
            new_values: toJobPositionAuditSnapshot(updatedJobPosition),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return updatedJobPosition;
      });
    } catch (error) {
      rethrowAsFriendlyJobPositionConflict(error);
    }

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
          old_values: toJobPositionAuditSnapshot(existing),
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
            orderBy: buildJobPositionOrderBy(
              searchRequest.sort_by || "name",
              searchRequest.sort_order || "asc",
            ),
          })
          .then((jobPositions) => jobPositions.map(toJobPositionResponse)),
    });
  }
}

function buildJobPositionOrderBy(
  sortBy: JobPositionSortField,
  sortOrder: "asc" | "desc",
) {
  return { [sortBy]: sortOrder };
}
