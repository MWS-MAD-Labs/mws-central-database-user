import {
  AdminRole,
  AuditAction,
  AuditSource,
  type AdminUser,
  type Prisma,
} from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toSimpleMasterDataAuditSnapshot,
  toSimpleMasterDataResponse,
  type CreateSimpleMasterDataRequest,
  type DeleteSimpleMasterDataRequest,
  type GetSimpleMasterDataRequest,
  type SearchSimpleMasterDataRequest,
  type SimpleMasterDataEntity,
  type SimpleMasterDataResponse,
  type SimpleMasterDataSortField,
  type UpdateSimpleMasterDataRequest,
} from "../model/simple-master-data-model";
import type { Pageable } from "../model/page-model";
import { AuditService } from "./audit-service";
import { SimpleMasterDataValidation } from "../validation/simple-master-data-validation";
import { Validation } from "../validation/validation";

export type SimpleMasterDataDelegate = {
  findUnique: (args: {
    where: { id: string } | { name: string };
  }) => Promise<SimpleMasterDataEntity | null>;
  findFirst: (args: {
    where: Record<string, unknown>;
  }) => Promise<SimpleMasterDataEntity | null>;
  findMany: (args: {
    where: Record<string, unknown>;
    take: number;
    skip: number;
    orderBy: Record<string, unknown>;
  }) => Promise<SimpleMasterDataEntity[]>;
  count: (args: { where: Record<string, unknown> }) => Promise<number>;
  create: (args: { data: { name: string } }) => Promise<SimpleMasterDataEntity>;
  update: (args: {
    where: { id: string };
    data: { name?: string };
  }) => Promise<SimpleMasterDataEntity>;
  delete: (args: { where: { id: string } }) => Promise<SimpleMasterDataEntity>;
};

export type ReferenceCheck = {
  label: string;
  count: (id: string) => Promise<number>;
};

export type SimpleMasterDataServiceConfig = {
  entityLabel: string;
  entityType: Prisma.ModelName;
  delegate: SimpleMasterDataDelegate;
  referenceChecks: ReferenceCheck[];
};

export function createSimpleMasterDataService(
  config: SimpleMasterDataServiceConfig,
) {
  const { entityLabel, entityType, delegate, referenceChecks } = config;

  return {
    async create(
      admin: AdminUser,
      request: CreateSimpleMasterDataRequest,
      context: AuditRequestContext = {},
    ): Promise<SimpleMasterDataResponse> {
      if (admin.role !== AdminRole.SUPER_ADMIN) {
        throw new ResponseError(
          403,
          `Forbidden: Only Super Admin can create a ${entityLabel}`,
        );
      }

      const createRequest = Validation.validate(
        SimpleMasterDataValidation.CREATE,
        request,
      );

      const existing = await delegate.findUnique({
        where: { name: createRequest.name },
      });
      if (existing) {
        throw new ResponseError(
          400,
          `A ${entityLabel} with this name already exists`,
        );
      }

      const entity = await delegate.create({
        data: { name: createRequest.name },
      });

      await AuditService.record({
        action: AuditAction.CREATE_MASTER_DATA,
        source: AuditSource.UI,
        entity_type: entityType,
        entity_id: entity.id,
        admin_id: admin.id,
        new_values: toSimpleMasterDataAuditSnapshot(entity),
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });

      return toSimpleMasterDataResponse(entity);
    },

    async update(
      admin: AdminUser,
      request: UpdateSimpleMasterDataRequest,
      context: AuditRequestContext = {},
    ): Promise<SimpleMasterDataResponse> {
      if (admin.role !== AdminRole.SUPER_ADMIN) {
        throw new ResponseError(
          403,
          `Forbidden: Only Super Admin can update a ${entityLabel}`,
        );
      }

      const updateRequest = Validation.validate(
        SimpleMasterDataValidation.UPDATE,
        request,
      );

      const existing = await delegate.findUnique({
        where: { id: updateRequest.id },
      });
      if (!existing) {
        throw new ResponseError(404, `${capitalize(entityLabel)} not found`);
      }

      if (updateRequest.name && updateRequest.name !== existing.name) {
        const duplicate = await delegate.findUnique({
          where: { name: updateRequest.name },
        });
        if (duplicate) {
          throw new ResponseError(
            400,
            `A ${entityLabel} with this name already exists`,
          );
        }
      }

      const entity = await delegate.update({
        where: { id: updateRequest.id },
        data: { name: updateRequest.name },
      });

      await AuditService.record({
        action: AuditAction.UPDATE_MASTER_DATA,
        source: AuditSource.UI,
        entity_type: entityType,
        entity_id: entity.id,
        admin_id: admin.id,
        old_values: toSimpleMasterDataAuditSnapshot(existing),
        new_values: toSimpleMasterDataAuditSnapshot(entity),
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });

      return toSimpleMasterDataResponse(entity);
    },

    async remove(
      admin: AdminUser,
      request: DeleteSimpleMasterDataRequest,
      context: AuditRequestContext = {},
    ): Promise<boolean> {
      if (admin.role !== AdminRole.SUPER_ADMIN) {
        throw new ResponseError(
          403,
          `Forbidden: Only Super Admin can delete a ${entityLabel}`,
        );
      }

      const deleteRequest = Validation.validate(
        SimpleMasterDataValidation.DELETE,
        request,
      );

      const existing = await delegate.findUnique({
        where: { id: deleteRequest.id },
      });
      if (!existing) {
        throw new ResponseError(404, `${capitalize(entityLabel)} not found`);
      }

      const counts = await Promise.all(
        referenceChecks.map((check) => check.count(deleteRequest.id)),
      );

      const usages = referenceChecks
        .map((check, i) => ({ count: counts[i]!, label: check.label }))
        .filter((usage) => usage.count > 0)
        .map((usage) => `${usage.count} ${usage.label}`);

      if (usages.length > 0) {
        throw new ResponseError(
          400,
          `Cannot delete: this ${entityLabel} is still referenced by ${usages.join(", ")}. Reassign or remove those first.`,
        );
      }

      await delegate.delete({ where: { id: deleteRequest.id } });

      await AuditService.record({
        action: AuditAction.DELETE_MASTER_DATA,
        source: AuditSource.UI,
        entity_type: entityType,
        entity_id: existing.id,
        admin_id: admin.id,
        old_values: toSimpleMasterDataAuditSnapshot(existing),
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });

      return true;
    },

    async get(
      admin: AdminUser,
      request: GetSimpleMasterDataRequest,
    ): Promise<SimpleMasterDataResponse> {
      void admin;

      const entity = await delegate.findUnique({ where: { id: request.id } });
      if (!entity) {
        throw new ResponseError(404, `${capitalize(entityLabel)} not found`);
      }

      return toSimpleMasterDataResponse(entity);
    },

    async search(
      admin: AdminUser,
      request: SearchSimpleMasterDataRequest,
    ): Promise<Pageable<SimpleMasterDataResponse>> {
      void admin;

      const searchRequest = Validation.validate(
        SimpleMasterDataValidation.SEARCH,
        request,
      );

      const skip = (searchRequest.page - 1) * searchRequest.size;
      const where = {
        name: searchRequest.search
          ? { contains: searchRequest.search, mode: "insensitive" as const }
          : undefined,
      };

      const totalItems = await delegate.count({ where });

      const entities = await delegate.findMany({
        where,
        take: searchRequest.size,
        skip,
        orderBy: buildOrderBy(
          searchRequest.sort_by || "name",
          searchRequest.sort_order || "asc",
        ),
      });

      return {
        data: entities.map(toSimpleMasterDataResponse),
        paging: {
          size: searchRequest.size,
          current_page: searchRequest.page,
          total_page: Math.ceil(totalItems / searchRequest.size),
          total_item: totalItems,
        },
      };
    },
  };
}

function buildOrderBy(
  sortBy: SimpleMasterDataSortField,
  sortOrder: "asc" | "desc",
) {
  return { [sortBy]: sortOrder };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type SimpleMasterDataService = ReturnType<
  typeof createSimpleMasterDataService
>;
