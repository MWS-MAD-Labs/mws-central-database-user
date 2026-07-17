import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import type { JWTPayload } from "hono/utils/jwt/types";
import { prismaClient } from "../lib/prisma";
import type { AdminVariables } from "../type/hono-context";

interface AdminTokenPayload extends JWTPayload {
  id: string;
  email: string;
  role: string;
  type?: string;
}

export const adminAuthMiddleware = async (
  c: Context<{ Variables: AdminVariables }>,
  next: Next,
) => {
  const token = getCookie(c, "access_token");

  if (!token) {
    return c.json({ errors: "Unauthorized" }, 401);
  }

  let payload: AdminTokenPayload;

  try {
    payload = (await verify(
      token,
      process.env.JWT_SECRET!,
      "HS256",
    )) as AdminTokenPayload;
  } catch {
    return c.json({ errors: "Invalid or expired token" }, 401);
  }

  // Employee self-service tokens share the same access_token cookie but
  // carry type: "employee" instead of a role — reject explicitly instead of
  // relying only on the AdminUser lookup below missing (Employee/AdminUser
  // ids happen to live in disjoint id spaces, but that's incidental, not a
  // guarantee this middleware should depend on).
  if (payload.type === "employee") {
    return c.json({ errors: "Unauthorized" }, 401);
  }

  const admin = await prismaClient.adminUser.findFirst({
    where: { id: payload.id, is_active: true },
  });

  if (!admin) {
    return c.json({ errors: "Session expired or account deactivated." }, 401);
  }

  c.set("admin", admin);
  await next();
};
