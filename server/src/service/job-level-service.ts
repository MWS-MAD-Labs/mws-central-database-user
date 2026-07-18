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
  type JobLevelResponse,
  type JobLevelSortField,
  type SearchJobLevelRequest,
  type UpdateJobLevelRequest,
} from "../model/job-level-model";
import type { Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { JobLevelValidation } from "../validation/job-level-validation";
import { Validation } from "../validation/validation";

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
      throw new ResponseError(
        400,
        "A job level with this name already exists",
      );
    }

    const jobLevel = await prismaClient.masterJobLevel.create({
      data: {
        name: createRequest.name,
        is_teaching_role: createRequest.is_teaching_role ?? false,
      },
    });

    await AuditService.record({
      action: AuditAction.CREATE_MASTER_DATA,
      source: AuditSource.UI,
      entity_type: "MasterJobLevel",
      entity_id: jobLevel.id,
      admin_id: admin.id,
      new_values: toJobLevelAuditSnapshot(jobLevel),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
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
    });
    if (!existing) {
      throw new ResponseError(404, "Job level not found");
    }

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

    const jobLevel = await prismaClient.masterJobLevel.update({
      where: { id: updateRequest.id },
      data: {
        name: updateRequest.name,
        is_teaching_role: updateRequest.is_teaching_role,
      },
    });

    await AuditService.record({
      action: AuditAction.UPDATE_MASTER_DATA,
      source: AuditSource.UI,
      entity_type: "MasterJobLevel",
      entity_id: jobLevel.id,
      admin_id: admin.id,
      old_values: toJobLevelAuditSnapshot(existing),
      new_values: toJobLevelAuditSnapshot(jobLevel),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
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

    await prismaClient.masterJobLevel.delete({
      where: { id: deleteRequest.id },
    });

    await AuditService.record({
      action: AuditAction.DELETE_MASTER_DATA,
      source: AuditSource.UI,
      entity_type: "MasterJobLevel",
      entity_id: existing.id,
      admin_id: admin.id,
      old_values: toJobLevelAuditSnapshot(existing),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
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

    const totalItems = await prismaClient.masterJobLevel.count({ where });

    const jobLevels = await prismaClient.masterJobLevel.findMany({
      where,
      take: searchRequest.size,
      skip,
      orderBy: buildJobLevelOrderBy(
        searchRequest.sort_by || "name",
        searchRequest.sort_order || "asc",
      ),
    });

    return {
      data: jobLevels.map(toJobLevelResponse),
      paging: {
        size: searchRequest.size,
        current_page: searchRequest.page,
        total_page: Math.ceil(totalItems / searchRequest.size),
        total_item: totalItems,
      },
    };
  }
}

function buildJobLevelOrderBy(
  sortBy: JobLevelSortField,
  sortOrder: "asc" | "desc",
) {
  return { [sortBy]: sortOrder };
}
