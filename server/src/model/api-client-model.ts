import type {
  ApiClient,
  ApiClientCredential,
  ApiScope,
  ApplicationIntegrationProfile,
  IntegrationEnvironment,
  IntegrationProfileStatus,
} from "../generated/prisma/client";

export type CreateApiClientRequest = {
  profile_id?: string;
  profile_code?: string;
  purpose?: string;
  name?: string;
  description?: string;
  scope_names?: string[];
};

export type RevokeApiClientRequest = {
  id: string;
};

export type RotateApiClientRequest = {
  id: string;
  immediate?: boolean;
  grace_hours?: number;
};

export type RevokeApiClientCredentialRequest = {
  id: string;
  credential_id: string;
};

export type UpdateApiClientScopesRequest = {
  id: string;
  scope_names: string[];
};

export type ApiClientResponse = {
  id: string;
  name: string;
  description: string | null;
  token_prefix: string;
  is_active: boolean;
  status: IntegrationProfileStatus;
  environment: IntegrationEnvironment | null;
  purpose: string | null;
  profile: {
    id: string;
    code: string;
    name: string;
    status: IntegrationProfileStatus;
    version: number;
  } | null;
  scopes: string[];
  effective_scopes: string[];
  credentials: Array<{
    id: string;
    token_prefix: string;
    status: string;
    issued_at: string;
    activates_at: string;
    expires_at: string | null;
    revoked_at: string | null;
    last_used_at: string | null;
  }>;
  last_used_at: string | null;
  created_at: string;
};

export type ApiClientCreatedResponse = ApiClientResponse & {
  token: string;
};

export type ApiClientWithScopes = ApiClient & {
  scopes: { scope: Pick<ApiScope, "name" | "is_active" | "deprecated_at"> }[];
  credentials: ApiClientCredential[];
  profile:
    | (ApplicationIntegrationProfile & {
        scopes: { scope: ApiScope }[];
      })
    | null;
};

export function toApiClientResponse(
  client: ApiClientWithScopes,
): ApiClientResponse {
  return {
    id: client.id,
    name: client.name,
    description: client.description,
    token_prefix: client.token_prefix,
    is_active: client.is_active,
    status: client.status,
    environment: client.environment,
    purpose: client.purpose,
    profile: client.profile
      ? {
          id: client.profile.id,
          code: client.profile.code,
          name: client.profile.name,
          status: client.profile.status,
          version: client.profile.version,
        }
      : null,
    scopes: client.scopes
      .filter(({ scope }) => scope.is_active && !scope.deprecated_at)
      .map((clientScope) => clientScope.scope.name),
    effective_scopes: client.profile && client.profile.code !== "unmapped"
      ? client.profile.scopes
          .filter(({ scope }) => scope.is_active && !scope.deprecated_at)
          .map(({ scope }) => scope.name)
      : client.scopes
          .filter(({ scope }) => scope.is_active && !scope.deprecated_at)
          .map((clientScope) => clientScope.scope.name),
    credentials: client.credentials.map((credential) => ({
      id: credential.id,
      token_prefix: credential.token_prefix,
      status: credential.status,
      issued_at: credential.issued_at.toISOString(),
      activates_at: credential.activates_at.toISOString(),
      expires_at: credential.expires_at?.toISOString() ?? null,
      revoked_at: credential.revoked_at?.toISOString() ?? null,
      last_used_at: credential.last_used_at?.toISOString() ?? null,
    })),
    last_used_at: client.last_used_at
      ? client.last_used_at.toISOString()
      : null,
    created_at: client.created_at.toISOString(),
  };
}
