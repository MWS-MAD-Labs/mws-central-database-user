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
}

export const adminAuthMiddleware = async (
  c: Context<{ Variables: AdminVariables }>,
  next: Next,
) => {
  const token = getCookie(c, "admin_token");

  if (!token) {
    return c.json({ errors: "Unauthorized" }, 401);
  }

  let payload: AdminTokenPayload;

  try {
    payload = (await verify(token, process.env.JWT_SECRET!, "HS256")) as AdminTokenPayload;
  } catch {
    return c.json({ errors: "Invalid or expired token", code: "INVALID_TOKEN" }, 401);
  }

  // Cek is_active — langsung invalid kalau admin di-deactivate
  const admin = await prismaClient.adminUser.findFirst({
    where: { id: payload.id, is_active: true },
  });

  if (!admin) {
    return c.json({ errors: "Session expired or account deactivated.", code: "SESSION_EXPIRED" }, 401);
  }

  c.set("admin", admin);
  await next();
};
