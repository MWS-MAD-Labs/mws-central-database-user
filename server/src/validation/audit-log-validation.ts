import { z } from "zod";
import { AuditAction, AuditSource, Prisma } from "../generated/prisma/client";
import { ENTITY_AUDIT_ACTIONS } from "../model/audit-log-model";
import type { AuditJsonValue } from "../model/audit-log-model";

const ENTITY_AUDIT_ACTION_SET: ReadonlySet<string> = new Set(
  ENTITY_AUDIT_ACTIONS,
);

const AUDIT_ACTION_VALUES = Object.keys(AuditAction) as [
  keyof typeof AuditAction,
  ...(keyof typeof AuditAction)[],
];

const AUDIT_SOURCE_VALUES = Object.keys(AuditSource) as [
  keyof typeof AuditSource,
  ...(keyof typeof AuditSource)[],
];

const AUDIT_ENTITY_TYPE_VALUES = Object.values(Prisma.ModelName) as [
  Prisma.ModelName,
  ...Prisma.ModelName[],
];

const AuditJsonValueSchema: z.ZodType<AuditJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(AuditJsonValueSchema),
    z.record(z.string(), AuditJsonValueSchema),
  ]),
);

const AuditValueSchema = z.record(z.string(), AuditJsonValueSchema);

export class AuditLogValidation {
  static readonly RECORD = z
    .object({
      action: z.enum(AUDIT_ACTION_VALUES, {
        message: "Action is required and must be a valid audit action",
      }),
      source: z.enum(AUDIT_SOURCE_VALUES, {
        message: "Source is required and must be a valid audit source",
      }),

      entity_type: z
        .enum(AUDIT_ENTITY_TYPE_VALUES, {
          message: "Entity type must be a known model name",
        })
        .optional(),
      entity_id: z
        .string()
        .min(1, "Entity ID cannot be an empty string")
        .max(50, "Entity ID is too long")
        .optional(),

      admin_id: z
        .string()
        .min(1, "Admin ID cannot be an empty string")
        .max(50, "Admin ID is too long")
        .optional(),
      api_client_id: z
        .string()
        .min(1, "API Client ID cannot be an empty string")
        .max(50, "API Client ID is too long")
        .optional(),

      old_values: AuditValueSchema.optional(),
      new_values: AuditValueSchema.optional(),

      ip_address: z.union([z.ipv4(), z.ipv6()]).optional(),

      user_agent: z.string().max(512, "User agent is too long").optional(),
    })
    .superRefine((data, ctx) => {
      const isEntityAction = ENTITY_AUDIT_ACTION_SET.has(data.action);

      if (isEntityAction) {
        if (data.entity_type === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["entity_type"],
            message: `entity_type is required for action ${data.action}`,
          });
        }
        if (data.entity_id === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["entity_id"],
            message: `entity_id is required for action ${data.action}`,
          });
        }
      } else {
        if (data.entity_type !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["entity_type"],
            message: `entity_type must not be set for action ${data.action}`,
          });
        }
        if (data.entity_id !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["entity_id"],
            message: `entity_id must not be set for action ${data.action}`,
          });
        }
      }

      if (data.source === AuditSource.SYSTEM) {
        if (data.admin_id !== undefined || data.api_client_id !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["source"],
            message:
              "A SYSTEM-sourced audit log entry must not be attributed to an admin or an API client",
          });
        }
        if (data.ip_address !== undefined || data.user_agent !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["source"],
            message:
              "A SYSTEM-sourced audit log entry must not include ip_address or user_agent",
          });
        }
      } else if (data.admin_id && data.api_client_id) {
        ctx.addIssue({
          code: "custom",
          path: ["admin_id"],
          message:
            "An audit log entry must be attributed to either an admin or an API client, not both",
        });
      }
    });
}
