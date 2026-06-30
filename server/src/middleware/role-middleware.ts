import type { Context, Next } from "hono";
import type { AdminVariables } from "../type/hono-context";
import type { AdminRole } from "../generated/prisma/enums";

export const requireRole = (allowedRoles: AdminRole[]) => {
  return async (c: Context<{ Variables: AdminVariables }>, next: Next) => {
    const admin = c.var.admin;

    if (!admin) {
      return c.json({ errors: "Unauthorized: Admin context not found" }, 401);
    }

    if (!allowedRoles.includes(admin.role as AdminRole)) {
      return c.json(
        {
          errors:
            "Forbidden: You don't have sufficient permissions to perform this action.",
          requiredRoles: allowedRoles,
          currentRole: admin.role,
        },
        403,
      );
    }

    await next();
  };
};
