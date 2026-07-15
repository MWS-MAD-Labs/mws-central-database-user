import type { ApiClient } from "../generated/prisma/client";

export type CreateApiClientRequest = {
  name: string;
  description?: string;
  scope_names: string[];
};

export type RevokeApiClientRequest = {
  id: string;
};

export type ApiClientResponse = {
  id: string;
  name: string;
  description: string | null;
  token_prefix: string;
  is_active: boolean;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
};

export type ApiClientCreatedResponse = ApiClientResponse & {
  token: string;
};

export type ApiClientWithScopes = ApiClient & {
  scopes: { scope: { name: string } }[];
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
    scopes: client.scopes.map((clientScope) => clientScope.scope.name),
    last_used_at: client.last_used_at
      ? client.last_used_at.toISOString()
      : null,
    created_at: client.created_at.toISOString(),
  };
}
