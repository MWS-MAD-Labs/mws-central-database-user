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
  toApiClientResponse,
  type ApiClientCreatedResponse,
  type ApiClientResponse,
  type CreateApiClientRequest,
  type RevokeApiClientRequest,
  type RotateApiClientRequest,
} from "../model/api-client-model";
import { generateApiToken } from "../utils/generate-api-token";
import { AuditService } from "./audit-service";
import { ApiClientValidation } from "../validation/api-client-validation";
import { Validation } from "../validation/validation";

const CLIENT_INCLUDE = { scopes: { include: { scope: true } } } as const;

export class ApiClientService {
  static async create(
    admin: AdminUser,
    request: CreateApiClientRequest,
    context: AuditRequestContext = {},
  ): Promise<ApiClientCreatedResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can create API clients",
      );
    }

    const createRequest = Validation.validate(
      ApiClientValidation.CREATE,
      request,
    );

    const existingClient = await prismaClient.apiClient.findUnique({
      where: { name: createRequest.name },
    });
    if (existingClient) {
      throw new ResponseError(400, "An API client with this name already exists");
    }

    const scopes = await prismaClient.apiScope.findMany({
      where: { name: { in: createRequest.scope_names } },
    });

    const foundScopeNames = new Set(scopes.map((scope) => scope.name));
    const unknownScopeNames = createRequest.scope_names.filter(
      (name) => !foundScopeNames.has(name),
    );
    if (unknownScopeNames.length > 0) {
      throw new ResponseError(
        400,
        `Unknown scope(s): ${unknownScopeNames.join(", ")}`,
      );
    }

    const generatedToken = generateApiToken();

    const client = await prismaClient.$transaction(async (tx) => {
      const createdClient = await tx.apiClient.create({
        data: {
          name: createRequest.name,
          description: createRequest.description,
          token_prefix: generatedToken.token_prefix,
          token_hash: generatedToken.token_hash,
          scopes: {
            create: scopes.map((scope) => ({ scope_id: scope.id })),
          },
        },
      });

      // fetched separately - write + nested include races on the pg client
      const fetchedClient = await tx.apiClient.findUniqueOrThrow({
        where: { id: createdClient.id },
        include: CLIENT_INCLUDE,
      });

      await AuditService.record(
        {
          action: AuditAction.API_TOKEN_CREATE,
          source: AuditSource.UI,
          admin_id: admin.id,
          new_values: {
            api_client_id: fetchedClient.id,
            name: fetchedClient.name,
            scopes: createRequest.scope_names,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return fetchedClient;
    });

    return {
      ...toApiClientResponse(client),
      token: generatedToken.token,
    };
  }

  static async list(admin: AdminUser): Promise<ApiClientResponse[]> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can view API clients",
      );
    }

    const clients = await prismaClient.apiClient.findMany({
      include: CLIENT_INCLUDE,
      orderBy: { created_at: "desc" },
    });

    return clients.map(toApiClientResponse);
  }

  static async revoke(
    admin: AdminUser,
    request: RevokeApiClientRequest,
    context: AuditRequestContext = {},
  ): Promise<ApiClientResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can revoke API clients",
      );
    }

    const revokeRequest = Validation.validate(
      ApiClientValidation.REVOKE,
      request,
    );

    const existingClient = await prismaClient.apiClient.findUnique({
      where: { id: revokeRequest.id },
    });
    if (!existingClient) {
      throw new ResponseError(404, "API client not found");
    }
    if (!existingClient.is_active) {
      throw new ResponseError(400, "API client is already revoked");
    }

    const client = await prismaClient.$transaction(async (tx) => {
      await tx.apiClient.update({
        where: { id: revokeRequest.id },
        data: { is_active: false },
      });

      // fetched separately - write + nested include races on the pg client
      const fetchedClient = await tx.apiClient.findUniqueOrThrow({
        where: { id: revokeRequest.id },
        include: CLIENT_INCLUDE,
      });

      await AuditService.record(
        {
          action: AuditAction.API_TOKEN_REVOKE,
          source: AuditSource.UI,
          admin_id: admin.id,
          old_values: { is_active: true },
          new_values: {
            api_client_id: fetchedClient.id,
            name: fetchedClient.name,
            is_active: false,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return fetchedClient;
    });

    return toApiClientResponse(client);
  }

  static async rotate(
    admin: AdminUser,
    request: RotateApiClientRequest,
    context: AuditRequestContext = {},
  ): Promise<ApiClientCreatedResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can rotate API client tokens",
      );
    }

    const rotateRequest = Validation.validate(
      ApiClientValidation.ROTATE,
      request,
    );

    const existingClient = await prismaClient.apiClient.findUnique({
      where: { id: rotateRequest.id },
    });
    if (!existingClient) {
      throw new ResponseError(404, "API client not found");
    }
    if (!existingClient.is_active) {
      throw new ResponseError(
        400,
        "Cannot rotate the token of a revoked API client",
      );
    }

    const generatedToken = generateApiToken();

    const client = await prismaClient.$transaction(async (tx) => {
      await tx.apiClient.update({
        where: { id: rotateRequest.id },
        data: {
          token_prefix: generatedToken.token_prefix,
          token_hash: generatedToken.token_hash,
        },
      });

      // fetched separately - write + nested include races on the pg client
      const fetchedClient = await tx.apiClient.findUniqueOrThrow({
        where: { id: rotateRequest.id },
        include: CLIENT_INCLUDE,
      });

      await AuditService.record(
        {
          action: AuditAction.API_TOKEN_ROTATE,
          source: AuditSource.UI,
          admin_id: admin.id,
          new_values: {
            api_client_id: fetchedClient.id,
            name: fetchedClient.name,
            token_prefix: fetchedClient.token_prefix,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return fetchedClient;
    });

    return {
      ...toApiClientResponse(client),
      token: generatedToken.token,
    };
  }
}
