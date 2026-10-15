import type { Context, Next } from "hono";
import { AdminRole } from "../generated/prisma/enums";
import type { AdminVariables } from "../type/hono-context";
import { isProtectedSuperAdminEmail } from "../utils/protected-admin";

// Application management is for the protected Super Admins only, a regular Super Admin is turned away.
export const requireProtectedSuperAdmin = async (c: Context<{ Variables: AdminVariables }>, next: Next) => {
  const admin = c.var.admin;
  if (!admin) return c.json({ errors: "Unauthorized: Admin context not found" }, 401);
  if (admin.role !== AdminRole.SUPER_ADMIN || !isProtectedSuperAdminEmail(admin.email)) {
    return c.json({ errors: "Forbidden: Only a protected Super Admin can manage applications" }, 403);
  }
  await next();
};
