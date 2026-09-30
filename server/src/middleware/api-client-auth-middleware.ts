import type { Context, Next } from "hono";
import { prismaClient } from "../lib/prisma";
import { verifyApiTokenSecret } from "../utils/generate-api-token";
import type { ApiClientVariables } from "../type/hono-context";
import type { ApiScopeName } from "../constants/api-scopes";
import {
  ApiCredentialStatus,
  IntegrationProfileStatus,
} from "../generated/prisma/client";

const LAST_USED_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

export const apiClientAuthMiddleware = async (
  c: Context<{ Variables: ApiClientVariables }>,
  next: Next,
) => {
  const authHeader = c.req.header("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ errors: "Unauthorized" }, 401);
  }

  const rawToken = authHeader.slice("Bearer ".length).trim();
  const separatorIndex = rawToken.indexOf(".");

  if (separatorIndex <= 0 || separatorIndex === rawToken.length - 1) {
    return c.json({ errors: "Unauthorized" }, 401);
  }

  const tokenPrefix = rawToken.slice(0, separatorIndex);
  const secret = rawToken.slice(separatorIndex + 1);

  const now = new Date();
  const credential = await prismaClient.apiClientCredential.findUnique({
    where: { token_prefix: tokenPrefix },
    include: {
      client: {
        include: {
          scopes: { include: { scope: true } },
          profile: { include: { scopes: { include: { scope: true } } } },
        },
      },
    },
  });

  let client = credential?.client ?? null;
  let credentialAuthenticated = false;
  if (credential && verifyApiTokenSecret(secret, credential.token_hash)) {
    const credentialUsable =
      (credential.status === ApiCredentialStatus.ACTIVE ||
        credential.status === ApiCredentialStatus.RETIRING) &&
      credential.activates_at <= now &&
      (!credential.expires_at || credential.expires_at > now) &&
      !credential.revoked_at;
    credentialAuthenticated = credentialUsable;
  }

  // Temporary compatibility path for clients not yet using credential rows.
  if (!credential) {
    client = await prismaClient.apiClient.findUnique({
      where: { token_prefix: tokenPrefix },
      include: {
        scopes: { include: { scope: true } },
        profile: { include: { scopes: { include: { scope: true } } } },
      },
    });
    if (!client || !verifyApiTokenSecret(secret, client.token_hash)) {
      return c.json({ errors: "Unauthorized" }, 401);
    }
  } else if (!credentialAuthenticated) {
    return c.json({ errors: "Unauthorized" }, 401);
  }

  if (
    !client ||
    !client.is_active ||
    client.status !== IntegrationProfileStatus.ACTIVE ||
    (client.profile && client.profile.status !== IntegrationProfileStatus.ACTIVE)
  ) {
    return c.json({ errors: "Unauthorized" }, 401);
  }

  const lastUsedAt = credentialAuthenticated
    ? credential!.last_used_at
    : client.last_used_at;
  if (!lastUsedAt || now.getTime() - lastUsedAt.getTime() >= LAST_USED_UPDATE_INTERVAL_MS) {
    if (credentialAuthenticated) {
      await prismaClient.apiClientCredential.update({
        where: { id: credential!.id },
        data: { last_used_at: now },
      });
    }
    await prismaClient.apiClient.update({
      where: { id: client.id },
      data: { last_used_at: now },
    });
  }

  c.set("clientId", client.id);
  c.set("clientName", client.name);
  c.set(
    "scopes",
    client.profile && client.profile.code !== "unmapped"
      ? client.profile.scopes
          .filter(({ scope }) => scope.is_active && !scope.deprecated_at)
          .map(({ scope }) => scope.name)
      : client.scopes
          .filter(({ scope }) => scope.is_active && !scope.deprecated_at)
          .map((clientScope) => clientScope.scope.name),
  );

  await next();
};

export function requireScope(scope: ApiScopeName) {
  return async (c: Context<{ Variables: ApiClientVariables }>, next: Next) => {
    if (!c.var.scopes.includes(scope)) {
      return c.json(
        { errors: `Forbidden: missing required scope '${scope}'` },
        403,
      );
    }
    await next();
  };
}
