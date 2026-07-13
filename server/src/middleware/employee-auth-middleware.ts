import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import type { JWTPayload } from "hono/utils/jwt/types";
import { EmployeeStatus, PersonType } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import type { EmployeeVariables } from "../type/hono-context";

interface EmployeeTokenPayload extends JWTPayload {
  id: string;
  email: string;
  type: "employee";
}

export const employeeAuthMiddleware = async (
  c: Context<{ Variables: EmployeeVariables }>,
  next: Next,
) => {
  const token = getCookie(c, "access_token");

  if (!token) {
    return c.json({ errors: "Unauthorized" }, 401);
  }

  let payload: EmployeeTokenPayload;

  try {
    payload = (await verify(
      token,
      process.env.JWT_SECRET!,
      "HS256",
    )) as EmployeeTokenPayload;
  } catch {
    return c.json({ errors: "Invalid or expired token" }, 401);
  }

  if (payload.type !== "employee") {
    return c.json({ errors: "Unauthorized" }, 401);
  }

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
        include: { unit: true, job_position: true, job_level: true },
      },
    },
  });

  if (!person || !person.employee) {
    return c.json({ errors: "Session expired or account deactivated." }, 401);
  }

  // Employee was promoted to AdminUser after this token was issued —
  // force re-login so they get a properly scoped admin token instead.
  const promotedAdmin = await prismaClient.adminUser.findFirst({
    where: { email: person.email, is_active: true },
  });

  if (promotedAdmin) {
    return c.json(
      { errors: "Your account has been upgraded. Please log in again." },
      401,
    );
  }

  c.set("employee", person);
  await next();
};
