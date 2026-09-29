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

const EXIMA_ROLE_PERMISSIONS = {
  admin: [
    "app.admin", "dashboard.read", "analytics.read", "users.manage",
    "credentials.read", "credentials.manage", "accurate.manage",
    "inventory.export", "inventory.import", "borrowing.manage",
    "pos.catalog.read", "pos.manage", "pos.checkout", "pos.sales.read",
    "pos.sales.void", "allowance.manage", "allowance.collect", "store.use",
  ],
  resource: ["credentials.read", "inventory.export", "inventory.import", "borrowing.manage"],
  cashier: ["credentials.read", "pos.catalog.read", "pos.checkout", "pos.sales.read", "allowance.collect"],
  staff: ["credentials.read", "pos.catalog.read", "store.use"],
} as const;

const DAILY_CHECKIN_PARTICIPANT_PERMISSIONS = [
  "checkin.self.read",
  "checkin.self.submit",
  "support.contacts.read",
  "notifications.self.manage",
  "assistant.use",
] as const;

const DAILY_CHECKIN_EDUCATOR_PERMISSIONS = [
  ...DAILY_CHECKIN_PARTICIPANT_PERMISSIONS,
  "student_checkins.read",
] as const;

const DAILY_CHECKIN_SUPPORT_PERMISSIONS = [
  ...DAILY_CHECKIN_EDUCATOR_PERMISSIONS,
  "dashboard.read",
  "support_requests.manage",
] as const;

const DAILY_CHECKIN_ADMIN_PERMISSIONS = [
  ...DAILY_CHECKIN_SUPPORT_PERMISSIONS,
  "users.read",
  "users.manage",
  "organizations.manage",
  "notifications.create",
  "sync.read",
  "sync.run",
  "dev_topology.read",
] as const;

const DAILY_CHECKIN_ROLE_PERMISSIONS = {
  participant: DAILY_CHECKIN_PARTICIPANT_PERMISSIONS,
  educator: DAILY_CHECKIN_EDUCATOR_PERMISSIONS,
  support: DAILY_CHECKIN_SUPPORT_PERMISSIONS,
  admin: DAILY_CHECKIN_ADMIN_PERMISSIONS,
  superadmin: [
    ...DAILY_CHECKIN_ADMIN_PERMISSIONS,
    "users.deactivate",
    "dashboard.export",
  ],
} as const;

const APPLICATION_ROLE_PERMISSIONS = {
  exima: {
    roles: EXIMA_ROLE_PERMISSIONS,
    label: "Exima",
  },
  "daily-checkin": {
    roles: DAILY_CHECKIN_ROLE_PERMISSIONS,
    label: "Daily Check-in",
  },
} as const;

function validateApplicationPolicy(value: {
  application_id?: string;
  role?: string;
  permissions?: string[];
}, context: z.RefinementCtx) {
  if (!value.application_id || !(value.application_id in APPLICATION_ROLE_PERMISSIONS)) return;

  const policy = APPLICATION_ROLE_PERMISSIONS[
    value.application_id as keyof typeof APPLICATION_ROLE_PERMISSIONS
  ];
  if (!value.role || !(value.role in policy.roles)) {
    context.addIssue({ code: "custom", path: ["role"], message: `Unsupported ${policy.label} role` });
    return;
  }
  const expected = policy.roles[value.role as keyof typeof policy.roles];
  if (!value.permissions || value.permissions.length !== expected.length || expected.some((permission) => !value.permissions?.includes(permission))) {
    context.addIssue({ code: "custom", path: ["permissions"], message: `${policy.label} permissions must match the selected role` });
  }
}

export class ApplicationEntitlementValidation {
  static readonly LOOKUP = z.object({
    person_id: nonemptyId("Person ID"),
    application_id: applicationId,
  });

  static readonly GRANT = z.object({
    person_id: nonemptyId("Person ID"),
    application_id: applicationId,
    organization_id: nonemptyId("Organization ID"),
    role: nonemptyId("Role"),
    permissions,
  }).superRefine(validateApplicationPolicy);

  static readonly UPDATE = z
    .object({
      id: nonemptyId("Entitlement ID"),
      role: nonemptyId("Role").optional(),
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
    is_active: z.boolean().optional(),
  });
}
