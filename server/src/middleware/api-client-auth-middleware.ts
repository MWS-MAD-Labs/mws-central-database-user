import type { Context, Next } from "hono";
import { prismaClient } from "../lib/prisma";
import { verifyApiTokenSecret } from "../utils/generate-api-token";
import type { ApiClientVariables } from "../type/hono-context";
import type { ApiScopeName } from "../constants/api-scopes";

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

  const client = await prismaClient.apiClient.findUnique({
    where: { token_prefix: tokenPrefix },
    include: { scopes: { include: { scope: true } } },
  });

  if (
    !client ||
    !client.is_active ||
    !verifyApiTokenSecret(secret, client.token_hash)
  ) {
    return c.json({ errors: "Unauthorized" }, 401);
  }

  await prismaClient.apiClient.update({
    where: { id: client.id },
    data: { last_used_at: new Date() },
  });

  c.set("clientId", client.id);
  c.set("clientName", client.name);
  c.set(
    "scopes",
    client.scopes.map((clientScope) => clientScope.scope.name),
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
