import { z } from "zod";

export class ApiClientValidation {
  static readonly CREATE = z.object({
    profile_id: z.string().min(1).optional(),
    profile_code: z.string().min(1).max(100).optional(),
    purpose: z.string().min(1).max(100).optional(),
    name: z.string().min(1, "Name is required").max(100).optional(),
    description: z
      .string()
      .max(255, "Description is too long")
      .optional(),
    scope_names: z
      .array(z.string().min(1, "Scope name cannot be empty"))
      .min(1, "At least one scope is required")
      .optional(),
  }).superRefine((value, ctx) => {
    const managed = Boolean(value.profile_id || value.profile_code);
    if (value.profile_id && value.profile_code) {
      ctx.addIssue({ code: "custom", message: "Provide profile_id or profile_code, not both" });
    }
    if (managed && !value.purpose) {
      ctx.addIssue({ code: "custom", message: "Purpose is required for managed API clients" });
    }
    if (managed && value.scope_names) {
      ctx.addIssue({ code: "custom", message: "scope_names is not accepted for managed API clients" });
    }
    if (!managed && (!value.name || !value.scope_names)) {
      ctx.addIssue({ code: "custom", message: "Legacy creation requires name and scope_names" });
    }
  });

  static readonly REVOKE = z.object({
    id: z.string().min(1, "API Client ID is required"),
  });

  static readonly ROTATE = z.object({
    id: z.string().min(1, "API Client ID is required"),
    immediate: z.boolean().optional(),
    grace_hours: z.number().min(0).max(168).optional(),
  });

  static readonly REVOKE_CREDENTIAL = z.object({
    id: z.string().min(1, "API Client ID is required"),
    credential_id: z.string().min(1, "Credential ID is required"),
  });

  static readonly UPDATE_SCOPES = z.object({
    id: z.string().min(1, "API Client ID is required"),
    scope_names: z
      .array(z.string().min(1, "Scope name cannot be empty"))
      .min(1, "At least one scope is required"),
  });
}
