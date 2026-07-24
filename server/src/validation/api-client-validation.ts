import { z } from "zod";

export class ApiClientValidation {
  static readonly CREATE = z.object({
    name: z
      .string()
      .min(1, "Name is required")
      .max(50, "Name is too long"),
    description: z
      .string()
      .max(255, "Description is too long")
      .optional(),
    scope_names: z
      .array(z.string().min(1, "Scope name cannot be empty"))
      .min(1, "At least one scope is required"),
  });

  static readonly REVOKE = z.object({
    id: z.string().min(1, "API Client ID is required"),
  });

  static readonly ROTATE = z.object({
    id: z.string().min(1, "API Client ID is required"),
  });
}
