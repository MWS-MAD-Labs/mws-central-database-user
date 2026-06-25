import type { Context, Next } from "hono";
import { prismaClient } from "../lib/prisma";
import type { ApiClientVariables } from "../type/hono-context";
import bcrypt from "bcrypt";

export const apiAuthMiddleware = async (
  c: Context<{ Variables: ApiClientVariables }>,
  next: Next,
) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ errors: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);
  const dotIndex = token.indexOf(".");

  if (dotIndex === -1) {
    return c.json(
      { errors: "Invalid token format", code: "INVALID_TOKEN" },
      401,
    );
  }

  const prefix = token.slice(0, dotIndex);
  const secret = token.slice(dotIndex + 1);

  const client = await prismaClient.apiClient.findFirst({
    where: { token_prefix: prefix, is_active: true },
    include: { scopes: { include: { scope: true } } },
  });

  if (!client) {
    return c.json({ errors: "Invalid API token", code: "INVALID_TOKEN" }, 401);
  }

  const isValid = await bcrypt.compare(secret, client.token_hash);

  if (!isValid) {
    return c.json({ errors: "Invalid API token", code: "INVALID_TOKEN" }, 401);
  }

  await prismaClient.apiClient.update({
    where: { id: client.id },
    data: { last_used_at: new Date() },
  });

  c.set("clientId", client.id);
  c.set("clientName", client.name);
  c.set(
    "scopes",
    client.scopes.map((s) => s.scope.name),
  );

  await next();
};
