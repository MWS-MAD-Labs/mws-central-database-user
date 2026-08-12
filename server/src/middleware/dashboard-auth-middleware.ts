import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import type { JWTPayload } from "hono/utils/jwt/types";
import { EmployeeStatus, PersonType } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import type { DashboardVariables } from "../type/hono-context";

interface DashboardTokenPayload extends JWTPayload {
  id: string;
  email: string;
  role?: string;
  type?: string;
}

export const dashboardAuthMiddleware = async (
  c: Context<{ Variables: DashboardVariables }>,
  next: Next,
) => {
  const token = getCookie(c, "access_token");

  if (!token) {
    return c.json({ errors: "Unauthorized" }, 401);
  }

  let payload: DashboardTokenPayload;

  try {
    payload = (await verify(
      token,
      process.env.JWT_SECRET!,
      "HS256",
    )) as DashboardTokenPayload;
  } catch {
    return c.json({ errors: "Invalid or expired token" }, 401);
  }

  if (payload.type === "employee") {
    const person = await prismaClient.person.findFirst({
      where: {
        person_type: PersonType.EMPLOYEE,
        deleted_at: null,
        employee: {
          id: payload.id,
          status: EmployeeStatus.ACTIVE,
          deleted_at: null,
        },
      },
      include: {
        employee: {
          include: {
            unit: true,
            job_position: true,
            job_level: true,
            building: true,
          },
        },
      },
    });

    if (!person || !person.employee) {
      return c.json({ errors: "Session expired or account deactivated." }, 401);
    }

    const promotedAdmin = await prismaClient.adminUser.findFirst({
      where: { email: person.email, is_active: true },
    });

    if (promotedAdmin) {
      return c.json(
        { errors: "Your account has been upgraded. Please log in again." },
        401,
      );
    }

    c.set("dashboardUser", { type: "employee", employee: person });
    await next();
    return;
  }

  const admin = await prismaClient.adminUser.findFirst({
    where: { id: payload.id, is_active: true },
  });

  if (!admin) {
    return c.json({ errors: "Session expired or account deactivated." }, 401);
  }

  c.set("dashboardUser", { type: "admin", admin });
  await next();
};
