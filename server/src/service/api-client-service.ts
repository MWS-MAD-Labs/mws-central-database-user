import {
  AdminRole,
  ApiCredentialStatus,
  AuditAction,
  AuditSource,
  IntegrationProfileStatus,
  Prisma,
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
  type RevokeApiClientCredentialRequest,
  type RotateApiClientRequest,
  type UpdateApiClientScopesRequest,
} from "../model/api-client-model";
import { generateApiToken } from "../utils/generate-api-token";
import { AuditService } from "./audit-service";
import { ApiClientValidation } from "../validation/api-client-validation";
import { Validation } from "../validation/validation";
import { getIntegrationEnvironment } from "../utils/integration-environment";
import {
  INTERNAL_API_ENDPOINTS,
  type InternalApiEndpointDoc,
} from "../constants/internal-api-endpoints";

const CLIENT_INCLUDE = {
  scopes: { include: { scope: true } },
  credentials: { orderBy: { issued_at: "desc" as const } },
  profile: { include: { scopes: { include: { scope: true } } } },
} as const;

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

    const managed = Boolean(createRequest.profile_id || createRequest.profile_code);
    const environment = getIntegrationEnvironment();
    const profile = managed
      ? await prismaClient.applicationIntegrationProfile.findFirst({
          where: createRequest.profile_id
            ? { id: createRequest.profile_id }
            : { code: createRequest.profile_code },
        })
      : null;
    if (managed && !profile) {
      throw new ResponseError(404, "Application integration profile not found");
    }
    if (profile && profile.status !== IntegrationProfileStatus.ACTIVE) {
      throw new ResponseError(400, "Application integration profile is not active");
    }

    const name = managed
      ? createRequest.name ?? `${profile!.name} (${environment}/${createRequest.purpose})`
      : createRequest.name!;
    const existingClient = await prismaClient.apiClient.findUnique({ where: { name } });
    if (existingClient) throw new ResponseError(400, "An API client with this name already exists");

    const scopeNames = createRequest.scope_names ?? [];
    const scopes = managed
      ? []
      : await prismaClient.apiScope.findMany({ where: { name: { in: scopeNames } } });

    const foundScopeNames = new Set(scopes.map((scope) => scope.name));
    const unknownScopeNames = scopeNames.filter(
      (name) => !foundScopeNames.has(name),
    );
    if (unknownScopeNames.length > 0) {
      throw new ResponseError(
        400,
        `Unknown scope(s): ${unknownScopeNames.join(", ")}`,
      );
    }

    const generatedToken = generateApiToken();

    try {
      const client = await prismaClient.$transaction(async (tx) => {
        const createdClient = await tx.apiClient.create({
        data: {
          name,
          description: createRequest.description,
          token_prefix: generatedToken.token_prefix,
          token_hash: generatedToken.token_hash,
          profile_id: profile?.id,
          environment: managed ? environment : undefined,
          purpose: managed ? createRequest.purpose : undefined,
          scopes: {
            create: scopes.map((scope) => ({ scope_id: scope.id })),
          },
          credentials: {
            create: {
              token_prefix: generatedToken.token_prefix,
              token_hash: generatedToken.token_hash,
            },
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
          entity_type: "ApiClient",
          entity_id: fetchedClient.id,
          admin_id: admin.id,
          new_values: {
            api_client_id: fetchedClient.id,
            name: fetchedClient.name,
            profile_code: profile?.code ?? null,
            environment: managed ? environment : null,
            purpose: createRequest.purpose ?? null,
            scopes: managed
              ? (fetchedClient.profile?.scopes.map(({ scope }) => scope.name) ?? [])
              : scopeNames,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

        return fetchedClient;
      });

      return { ...toApiClientResponse(client), token: generatedToken.token };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ResponseError(409, "A client already exists for this profile, environment, and purpose");
      }
      throw error;
    }
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

  // Return the static internal endpoint catalog.
  static async listInternalEndpoints(
    admin: AdminUser,
  ): Promise<InternalApiEndpointDoc[]> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can view the internal API reference",
      );
    }

    return INTERNAL_API_ENDPOINTS;
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
        data: {
          is_active: false,
          status: IntegrationProfileStatus.DISABLED,
          disabled_at: new Date(),
          credentials: {
            updateMany: {
              where: { status: { in: [ApiCredentialStatus.ACTIVE, ApiCredentialStatus.RETIRING] } },
              data: { status: ApiCredentialStatus.REVOKED, revoked_at: new Date() },
            },
          },
        },
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
          entity_type: "ApiClient",
          entity_id: fetchedClient.id,
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
      include: { profile: { select: { code: true } } },
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

    const managed = Boolean(existingClient.profile_id && existingClient.profile?.code !== "unmapped");
    const now = new Date();
    const immediate = rotateRequest.immediate ?? false;
    // A managed client gets 24 hours unless told otherwise. A legacy client is cut off at once when
    // the request names no grace, so a caller that sends nothing keeps the behaviour it had; a
    // request that names a grace (the admin screen always does) is honored for both.
    const graceHours = immediate ? 0 : (rotateRequest.grace_hours ?? (managed ? 24 : 0));
    const retiringAt = new Date(now.getTime() + graceHours * 60 * 60 * 1000);
    const revokeNow = immediate || graceHours === 0;

    const client = await prismaClient.$transaction(async (tx) => {
      // A client from before credential rows keeps its token on the client itself. Give that token a
      // row first, so it can retire with a grace like any other.
      const hasRow = await tx.apiClientCredential.findUnique({
        where: { token_prefix: existingClient.token_prefix },
        select: { id: true },
      });
      if (!hasRow) {
        await tx.apiClientCredential.create({
          data: {
            client_id: existingClient.id,
            token_prefix: existingClient.token_prefix,
            token_hash: existingClient.token_hash,
          },
        });
      }
      await tx.apiClient.update({
        where: { id: existingClient.id },
        data: {
          token_prefix: generatedToken.token_prefix,
          token_hash: generatedToken.token_hash,
        },
      });
      await tx.apiClientCredential.updateMany({
        where: {
          client_id: existingClient.id,
          status: revokeNow
            ? { in: [ApiCredentialStatus.ACTIVE, ApiCredentialStatus.RETIRING] }
            : ApiCredentialStatus.ACTIVE,
        },
        data: revokeNow
          ? { status: ApiCredentialStatus.REVOKED, revoked_at: now, expires_at: now }
          : { status: ApiCredentialStatus.RETIRING, expires_at: retiringAt },
      });
      await tx.apiClientCredential.create({
        data: {
          client_id: existingClient.id,
          token_prefix: generatedToken.token_prefix,
          token_hash: generatedToken.token_hash,
        },
      });
      // fetched separately - write + nested include races on the pg client
      const fetchedClient = await tx.apiClient.findUniqueOrThrow({
        where: { id: existingClient.id },
        include: CLIENT_INCLUDE,
      });
      await AuditService.record(
        {
          action: AuditAction.API_TOKEN_ROTATE,
          source: AuditSource.UI,
          entity_type: "ApiClient",
          entity_id: fetchedClient.id,
          admin_id: admin.id,
          new_values: {
            api_client_id: fetchedClient.id,
            name: fetchedClient.name,
            token_prefix: generatedToken.token_prefix,
            immediate: revokeNow,
            grace_hours: graceHours,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return fetchedClient;
    });

    return { ...toApiClientResponse(client), token: generatedToken.token };
  }

  static async updateScopes(
    admin: AdminUser,
    request: UpdateApiClientScopesRequest,
    context: AuditRequestContext = {},
  ): Promise<ApiClientResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can change API client scopes",
      );
    }

    const updateRequest = Validation.validate(
      ApiClientValidation.UPDATE_SCOPES,
      request,
    );

    const existingClient = await prismaClient.apiClient.findUnique({
      where: { id: updateRequest.id },
      include: CLIENT_INCLUDE,
    });
    if (!existingClient) {
      throw new ResponseError(404, "API client not found");
    }
    if (!existingClient.is_active) {
      throw new ResponseError(
        400,
        "Cannot change scopes of a revoked API client",
      );
    }
    if (existingClient.profile_id && existingClient.profile?.code !== "unmapped") {
      throw new ResponseError(400, "Scopes for managed API clients are controlled by their profile");
    }

    const scopes = await prismaClient.apiScope.findMany({
      where: { name: { in: updateRequest.scope_names } },
    });

    const foundScopeNames = new Set(scopes.map((scope) => scope.name));
    const unknownScopeNames = updateRequest.scope_names.filter(
      (name) => !foundScopeNames.has(name),
    );
    if (unknownScopeNames.length > 0) {
      throw new ResponseError(
        400,
        `Unknown scope(s): ${unknownScopeNames.join(", ")}`,
      );
    }

    const oldScopeNames = existingClient.scopes.map(
      (clientScope) => clientScope.scope.name,
    );

    const client = await prismaClient.$transaction(async (tx) => {
      // Full replace, not a diff/merge - the form always submits the
      // client's complete desired scope set, same as create().
      await tx.apiClientScope.deleteMany({
        where: { client_id: updateRequest.id },
      });
      await tx.apiClientScope.createMany({
        data: scopes.map((scope) => ({
          client_id: updateRequest.id,
          scope_id: scope.id,
        })),
      });

      // fetched separately - write + nested include races on the pg client
      const fetchedClient = await tx.apiClient.findUniqueOrThrow({
        where: { id: updateRequest.id },
        include: CLIENT_INCLUDE,
      });

      await AuditService.record(
        {
          action: AuditAction.API_TOKEN_UPDATE_SCOPES,
          source: AuditSource.UI,
          entity_type: "ApiClient",
          entity_id: fetchedClient.id,
          admin_id: admin.id,
          old_values: {
            api_client_id: fetchedClient.id,
            name: fetchedClient.name,
            scopes: oldScopeNames,
          },
          new_values: {
            api_client_id: fetchedClient.id,
            name: fetchedClient.name,
            scopes: updateRequest.scope_names,
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

  static async revokeCredential(
    admin: AdminUser,
    request: RevokeApiClientCredentialRequest,
    context: AuditRequestContext = {},
  ): Promise<ApiClientResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(403, "Forbidden: Only Super Admin can revoke API credentials");
    }
    const value = Validation.validate(ApiClientValidation.REVOKE_CREDENTIAL, request);
    const credential = await prismaClient.apiClientCredential.findFirst({
      where: { id: value.credential_id, client_id: value.id },
    });
    if (!credential) throw new ResponseError(404, "API client credential not found");

    const client = await prismaClient.$transaction(async (tx) => {
      await tx.apiClientCredential.update({
        where: { id: credential.id },
        data: { status: ApiCredentialStatus.REVOKED, revoked_at: new Date() },
      });
      const fetched = await tx.apiClient.findUniqueOrThrow({
        where: { id: value.id },
        include: CLIENT_INCLUDE,
      });
      await AuditService.record(
        {
          action: AuditAction.API_TOKEN_REVOKE,
          source: AuditSource.UI,
          entity_type: "ApiClientCredential",
          entity_id: credential.id,
          admin_id: admin.id,
          new_values: { api_client_id: value.id, credential_id: credential.id, token_prefix: credential.token_prefix },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return fetched;
    });
    return toApiClientResponse(client);
  }
}
