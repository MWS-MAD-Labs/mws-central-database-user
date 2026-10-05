import { z } from "zod";
import { ApplicationAudience, EmploymentType } from "../generated/prisma/client";

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
    role: roleKey,
    permissions: permissions.optional(),
  });

  static readonly BULK_GRANT = z.object({
    person_ids: z
      .array(nonemptyId("Person ID"))
      .min(1, "Pick at least one person")
      .max(200, "Pick at most 200 people at a time")
      .refine((values) => new Set(values).size === values.length, "People must be unique"),
    application_id: applicationId,
    role: roleKey,
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

const AUDIENCES = Object.values(ApplicationAudience) as [
  ApplicationAudience,
  ...ApplicationAudience[],
];

const idList = (label: string) =>
  z
    .array(nonemptyId(label))
    .max(100, `Too many ${label.toLowerCase()}s`)
    .refine((values) => new Set(values).size === values.length, `${label}s must be unique`)
    .default([]);

const accessRuleFields = {
  audience: z.enum(AUDIENCES, {
    message: "Audience must be EMPLOYEES, STUDENTS or EMPLOYEES_AND_STUDENTS",
  }),
  unit_ids: idList("Unit"),
  job_position_ids: idList("Job position"),
  job_level_ids: idList("Job level"),
  default_role_key: roleKey,
  is_active: z.boolean().default(true),
};

const EMPLOYMENT_TYPES = Object.values(EmploymentType) as [EmploymentType, ...EmploymentType[]];

export class ApplicationAccessRuleValidation {
  // Who a person could be given access: filters plus how a group covers them.
  static readonly CANDIDATES = z.object({
    application_id: applicationId,
    coverage: z.enum(["ANY", "COVERED", "UNCOVERED", "GROUP"]).default("ANY"),
    group_id: nonemptyId("Group ID").optional(),
    // Leave out people who already have their own access row for the application.
    exclude_own_access: z.boolean().optional(),
    unit_id: nonemptyId("Unit ID").optional(),
    job_position_id: nonemptyId("Job position ID").optional(),
    job_level_id: nonemptyId("Job level ID").optional(),
    // Several at once, for a scope. Empty or missing means no limit.
    unit_ids: z.array(nonemptyId("Unit ID")).max(100).optional(),
    job_position_ids: z.array(nonemptyId("Job position ID")).max(100).optional(),
    job_level_ids: z.array(nonemptyId("Job level ID")).max(100).optional(),
    employment_type: z.enum(EMPLOYMENT_TYPES).optional(),
    search: z.string().trim().max(100).optional(),
    page: z.number().int().min(1).default(1),
    size: z.number().int().min(1).max(100).default(10),
  });

  static readonly CREATE = z.object({
    application_id: applicationId,
    ...accessRuleFields,
  });

  // The application and audience can't change, only who within it and the role.
  static readonly UPDATE = z.object({
    id: nonemptyId("Rule ID"),
    unit_ids: idList("Unit").optional(),
    job_position_ids: idList("Job position").optional(),
    job_level_ids: idList("Job level").optional(),
    default_role_key: roleKey.optional(),
    is_active: z.boolean().optional(),
  });

  static readonly DELETE = z.object({ id: nonemptyId("Rule ID") });

  static readonly LIST = z.object({
    kind: z.enum(["GROUP", "PERSON"]).optional(),
    application_id: applicationId.optional(),
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
