import { z } from "zod";

const applicationId = z
  .string()
  .trim()
  .min(1, "Application ID is required")
  .max(64, "Application ID is too long")
  .regex(
    /^[a-z][a-z0-9_-]*$/,
    "Application ID must start with a lowercase letter and contain only lowercase letters, numbers, underscores, or hyphens",
  );

const nonemptyId = (label: string) =>
  z.string().trim().min(1, `${label} is required`).max(128, `${label} is too long`);

const permissions = z
  .array(z.string().trim().min(1, "Permission cannot be empty").max(128))
  .max(100, "Too many permissions")
  .refine(
    (values) => new Set(values).size === values.length,
    "Permissions must be unique",
  );

// Role keys are exact: uppercase letters, digits and underscores.
const roleKey = z
  .string()
  .min(1, "Role is required")
  .max(64, "Role is too long")
  .regex(
    /^[A-Z][A-Z0-9_]*$/,
    "Role must be UPPER_SNAKE_CASE, for example ADMIN or SUPPORT_STAFF",
  );

export class ApplicationEntitlementValidation {
  static readonly LOOKUP = z.object({
    person_id: nonemptyId("Person ID"),
    application_id: applicationId,
  });

  // Permissions are optional: the registry role decides them.
  static readonly GRANT = z.object({
    person_id: nonemptyId("Person ID"),
    application_id: applicationId,
    organization_id: nonemptyId("Organization ID"),
    role: roleKey,
    permissions: permissions.optional(),
  });

  static readonly UPDATE = z
    .object({
      id: nonemptyId("Entitlement ID"),
      role: roleKey.optional(),
      permissions: permissions.optional(),
    })
    .refine((value) => value.role !== undefined || value.permissions !== undefined, {
      message: "Role or permissions is required",
    });

  static readonly REVOKE = z.object({ id: nonemptyId("Entitlement ID") });

  static readonly LIST = z.object({
    person_id: nonemptyId("Person ID").optional(),
    application_id: applicationId.optional(),
    organization_id: nonemptyId("Organization ID").optional(),
    role: roleKey.optional(),
    is_active: z.boolean().optional(),
    search: z.string().trim().max(100).optional(),
    page: z.number().int().min(1).default(1),
    size: z.number().int().min(1).max(100).default(10),
  });
}

export class ApplicationRoleValidation {
  static readonly CREATE = z.object({
    application_id: applicationId,
    key: roleKey,
    label: z.string().trim().min(1, "Label is required").max(64, "Label is too long"),
    permissions,
  });

  static readonly UPDATE = z
    .object({
      id: nonemptyId("Role ID"),
      label: z.string().trim().min(1, "Label is required").max(64, "Label is too long").optional(),
      permissions: permissions.optional(),
      is_active: z.boolean().optional(),
    })
    .refine(
      (value) =>
        value.label !== undefined ||
        value.permissions !== undefined ||
        value.is_active !== undefined,
      { message: "Provide a label, permissions, or is_active to update" },
    );

  static readonly LIST = z.object({
    application_id: applicationId.optional(),
    is_active: z.boolean().optional(),
  });
}
