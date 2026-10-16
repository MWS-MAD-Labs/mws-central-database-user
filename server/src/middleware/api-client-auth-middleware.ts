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
const ORGANIZATION_HEADER = "x-central-organization-id";
const ORGANIZATION_SHAPE = /^[A-Za-z0-9_-]{1,100}$/;
// What was last written for an application, so a call that says the same thing costs no query.
const noted = new Map<string, { reported: string; at: number }>();

// The Organization ID an application says it has, set from the line in its .env. Central compares it with the one it
// made, so a wrong or mixed-up value shows in Settings. It never changes the answer to the call.
async function noteOrganization(applicationId: string, reported: string, now: Date) {
  const last = noted.get(applicationId);
  if (last && last.reported === reported && now.getTime() - last.at < LAST_USED_UPDATE_INTERVAL_MS) return;
  const organization = await prismaClient.applicationOrganization.findUnique({
    where: { application_id: applicationId },
    select: { organization_id: true },
  });
  if (!organization) return;
  await prismaClient.application.updateMany({
    where: { application_id: applicationId },
    data: {
      organization_check_ok: organization.organization_id === reported,
      organization_reported: reported,
      organization_checked_at: now,
    },
  });
  noted.set(applicationId, { reported, at: now.getTime() });
}

// A correct token of a retired application gets its own answer, so the application can end its sessions.
async function retiredApplicationResponse(
  c: Context<{ Variables: ApiClientVariables }>,
  applicationId: string | null | undefined,
) {
  if (!applicationId) return null;
  const application = await prismaClient.application.findUnique({
    where: { application_id: applicationId },
    select: { retired_at: true },
  });
  if (!application?.retired_at) return null;
  return c.json({ errors: "Application retired", code: "application_retired" }, 403);
}

// A token that can no longer be used, shown with the right secret: the application behind it still runs on an old
// token. Only the right secret counts, so nobody else can set this. Once per interval, like last_used_at.
async function noteRejectedCredential(
  credential: { id: string; last_rejected_at: Date | null },
  now: Date,
) {
  if (credential.last_rejected_at && now.getTime() - credential.last_rejected_at.getTime() < LAST_USED_UPDATE_INTERVAL_MS) return;
  await prismaClient.apiClientCredential
    .update({ where: { id: credential.id }, data: { last_rejected_at: now } })
    .catch(() => undefined);
}

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
    if (!credentialUsable) {
      await noteRejectedCredential(credential, now);
      const retired = await retiredApplicationResponse(c, client?.profile?.code);
      if (retired) return retired;
    }
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

  const reportedOrganization = c.req.header(ORGANIZATION_HEADER)?.trim();
  const applicationCode = client.profile?.code;
  if (reportedOrganization && ORGANIZATION_SHAPE.test(reportedOrganization) && applicationCode && applicationCode !== "unmapped") {
    await noteOrganization(applicationCode, reportedOrganization, now).catch(() => undefined);
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
