import { z } from "zod";
import { ApplicationAudience, EmploymentType } from "../generated/prisma/client";
import { addressProblem } from "../utils/application-id";

const applicationId = z
  .string()
  .trim()
  .min(1, "Application ID is required")
  .max(64, "Application ID is too long")
  .regex(
    /^[a-z][a-z0-9_-]*$/,
    "Application ID must start with a lowercase letter and contain only lowercase letters, numbers, underscores, or hyphens",
  )
  // "me" means the application of the token in the internal API.
  .refine((value) => value !== "me", "Application ID \"me\" is reserved");

const tidy = (value: string) => value.replace(/\s+/g, " ").trim();

// An address as typed in the form: no spaces, http only for local ones, a sane length.
const optionalUrl = (label: string) =>
  z
    .string()
    .trim()
    .max(300, `${label} is too long`)
    .superRefine((value, ctx) => {
      const problem = value === "" ? null : addressProblem(value);
      if (problem) ctx.addIssue({ code: "custom", message: `${label}: ${problem}` });
    })
    .optional()
    .nullable();

const CATEGORIES = ["reporting", "students", "workplace", "operations", "utilities"] as const;

const applicationDetails = {
  name: z
    .string()
    .transform(tidy)
    .pipe(
      z
        .string()
        .min(2, "Name needs at least 2 characters")
        .max(60, "Name is too long")
        .regex(
          /^[\p{L}\p{N}][\p{L}\p{N} _.&()'-]*$/u,
          "Name may only have letters, numbers, spaces and & . ( ) ' _ -",
        ),
    )
    .optional(),
  description: z
    .string()
    .transform(tidy)
    .pipe(
      z
        .string()
        .max(300, "Description is too long")
        .refine((value) => !/[<>\u0000-\u001f]/.test(value), "Description cannot have < or > or control characters"),
    )
    .optional()
    .nullable(),
  icon: z
    .string()
    .trim()
    .max(40, "Icon is too long")
    .refine((value) => value === "" || /^[A-Za-z][A-Za-z0-9]*$/.test(value), "Icon may only have letters and numbers")
    .optional()
    .nullable(),
  category: z
    .string()
    .trim()
    .refine((value) => value === "" || (CATEGORIES as readonly string[]).includes(value), "Pick a category from the list")
    .optional()
    .nullable(),
  launch_url: optionalUrl("Launch URL"),
  logout_url: optionalUrl("Logout URL"),
};

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

  static readonly BULK_GRANT = z
    .object({
      person_ids: z
        .array(nonemptyId("Person ID"))
        .min(1, "Pick at least one person")
        .max(200, "Pick at most 200 people at a time")
        .refine((values) => new Set(values).size === values.length, "People must be unique"),
      application_id: applicationId,
      role: roleKey.optional(),
      // Shuts the person out of the application instead of giving them a role.
      blocked: z.boolean().optional(),
    })
    .refine((value) => value.blocked || value.role, { message: "Role is required", path: ["role"] });

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
  // Only used by groups of students.
  allows_exceptions: z.boolean().optional(),
};

const EMPLOYMENT_TYPES = Object.values(EmploymentType) as [EmploymentType, ...EmploymentType[]];

export class ApplicationValidation {
  static readonly LIST = z.object({
    search: z.string().trim().max(100).optional(),
    page: z.number().int().min(1).default(1),
    size: z.number().int().min(1).max(100).default(10),
  });

  // The id comes from the name when it is not given.
  static readonly CREATE = z
    .object({
      application_id: applicationId.optional(),
      ...applicationDetails,
      // Used by the controller, which makes the connection right after the application.
      connect: z.boolean().optional(),
      scope_names: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
      // The Hub itself: its id is fixed and it has no card or address.
      is_hub: z.boolean().optional(),
    })
    .refine((value) => value.application_id || value.name, { message: "Name is required", path: ["name"] });

  static readonly CONNECTION_SCOPES = z.object({
    scope_names: z.array(z.string().trim().min(1).max(100)).max(50),
  });

  static readonly UPDATE = z.object({
    application_id: applicationId,
    ...applicationDetails,
  });

  static readonly EXCEPTIONS = z.object({
    // A group id, or "other" for access no group covers.
    group_id: nonemptyId("Group ID"),
    search: z.string().trim().max(100).optional(),
    page: z.number().int().min(1).default(1),
    size: z.number().int().min(1).max(100).default(10),
  });
}

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
    // For a group of students.
    grade_id: nonemptyId("Grade ID").optional(),
    class_id: nonemptyId("Class ID").optional(),
    // Several at once, for a scope. Empty or missing means no limit.
    unit_ids: z.array(nonemptyId("Unit ID")).max(100).optional(),
    job_position_ids: z.array(nonemptyId("Job position ID")).max(100).optional(),
    job_level_ids: z.array(nonemptyId("Job level ID")).max(100).optional(),
    employment_type: z.enum(EMPLOYMENT_TYPES).optional(),
    search: z.string().trim().max(100).optional(),
    page: z.number().int().min(1).default(1),
    size: z.number().int().min(1).max(100).default(10),
  });

  // A scope someone is about to save, to ask which roles it can still take.
  static readonly ROLE_OPTIONS = z.object({
    audience: z.enum(["EMPLOYEES", "STUDENTS", "EMPLOYEES_AND_STUDENTS"]),
    unit_ids: idList("Unit").optional(),
    job_position_ids: idList("Job position").optional(),
    job_level_ids: idList("Job level").optional(),
    group_id: nonemptyId("Group ID").optional(),
  });

  // A group is for employees or for students. One group for both used to exist, but
  // students have no positions or levels, so it could not be scoped honestly.
  static readonly CREATE = z
    .object({
      application_id: applicationId,
      ...accessRuleFields,
    })
    .refine((value) => value.audience !== "EMPLOYEES_AND_STUDENTS", {
      message: "Create one group for employees and another for students",
      path: ["audience"],
    });

  // The application and audience can't change, only who within it and the role.
  static readonly UPDATE = z.object({
    id: nonemptyId("Rule ID"),
    unit_ids: idList("Unit").optional(),
    job_position_ids: idList("Job position").optional(),
    job_level_ids: idList("Job level").optional(),
    default_role_key: roleKey.optional(),
    is_active: z.boolean().optional(),
    allows_exceptions: z.boolean().optional(),
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
  static readonly CREATE = z
    .object({
      application_id: applicationId,
      key: roleKey,
      label: z.string().trim().min(1, "Label is required").max(64, "Label is too long"),
      permissions,
      allows_employees: z.boolean().optional(),
      allows_students: z.boolean().optional(),
    })
    .refine((value) => (value.allows_employees ?? true) || (value.allows_students ?? false), {
      message: "A role has to be for employees, students or both",
      path: ["allows_employees"],
    });

  static readonly UPDATE = z
    .object({
      id: nonemptyId("Role ID"),
      label: z.string().trim().min(1, "Label is required").max(64, "Label is too long").optional(),
      permissions: permissions.optional(),
      allows_employees: z.boolean().optional(),
      allows_students: z.boolean().optional(),
      is_active: z.boolean().optional(),
    })
    .refine(
      (value) =>
        value.label !== undefined ||
        value.permissions !== undefined ||
        value.allows_employees !== undefined ||
        value.allows_students !== undefined ||
        value.is_active !== undefined,
      { message: "Provide a label, permissions, who the role is for, or is_active to update" },
    );

  static readonly LIST = z.object({
    application_id: applicationId.optional(),
    is_active: z.boolean().optional(),
  });

  // Every role of the application, highest first.
  static readonly ORDER = z.object({
    application_id: applicationId,
    role_ids: z
      .array(nonemptyId("Role ID"))
      .min(1, "Provide the roles in order")
      .max(100, "Too many roles")
      .refine((values) => new Set(values).size === values.length, "Roles must be unique"),
  });
}

const permissionKey = z
  .string()
  .trim()
  .min(1, "Permission is required")
  .max(128, "Permission is too long")
  .regex(
    /^[a-z][a-z0-9_]*([.:-][a-z0-9_]+)*$/,
    "Permission must be lowercase letters, numbers and underscores, joined by dots",
  );

export class ApplicationPermissionValidation {
  static readonly LIST = z.object({ application_id: applicationId });

  static readonly CREATE = z.object({
    application_id: applicationId,
    key: permissionKey,
    description: z.string().trim().max(200, "Description is too long").optional(),
  });

  static readonly SYNC = z.object({
    application_id: applicationId,
    // Needed when this send would drop more than half of what the application published before.
    confirm_removals: z.boolean().optional(),
    permissions: z
      .array(
        z.object({
          key: permissionKey,
          description: z.string().trim().max(200, "Description is too long").optional(),
          requires: z.array(permissionKey).max(50, "Too many required permissions").optional(),
        }),
      )
      .min(1, "Send at least one permission")
      .max(300, "Too many permissions")
      .refine((rows) => new Set(rows.map((row) => row.key)).size === rows.length, "Permissions must be unique"),
  });
}
