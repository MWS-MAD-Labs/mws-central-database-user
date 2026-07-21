import type {
  AuditAction,
  AuditSource,
  Prisma,
} from "../generated/prisma/client";

export type AuditEntityType = Prisma.ModelName;

export type AuditJsonPrimitive = string | number | boolean | null;

export type AuditJsonValue =
  | AuditJsonPrimitive
  | AuditJsonValue[]
  | { [key: string]: AuditJsonValue };

export type AuditValue = { [key: string]: AuditJsonValue };

// Actions that operate on one specific record and must say which one.
export const ENTITY_AUDIT_ACTIONS = [
  "CREATE_STUDENT",
  "UPDATE_STUDENT",
  "DEACTIVATE_STUDENT",
  "DELETE_STUDENT",
  "CREATE_EMPLOYEE",
  "UPDATE_EMPLOYEE",
  "DEACTIVATE_EMPLOYEE",
  "DELETE_EMPLOYEE",
  "CREATE_ACADEMIC_YEAR",
  "UPDATE_ACADEMIC_YEAR",
  "DELETE_ACADEMIC_YEAR",
  "CREATE_CLASS",
  "UPDATE_CLASS",
  "DELETE_CLASS",
  "CREATE_ENROLLMENT",
  "PROMOTE_STUDENT",
  "TRANSFER_STUDENT_CLASS",
  "WITHDRAW_STUDENT_ENROLLMENT",
  "DELETE_ENROLLMENT",
  "RESTORE_ENROLLMENT",
  "CREATE_PARENT_GUARDIAN",
  "UPDATE_PARENT_GUARDIAN",
  "DELETE_PARENT_GUARDIAN",
  "CREATE_MASTER_DATA",
  "UPDATE_MASTER_DATA",
  "DELETE_MASTER_DATA",
  "UPLOAD_ATTACHMENT",
  "DOWNLOAD_ATTACHMENT",
  "ACCESS_HEALTH_DATA",
  "ROLE_CHANGE",
  "PERMISSION_CHANGE",
] as const satisfies readonly AuditAction[];

export type EntityAuditAction = (typeof ENTITY_AUDIT_ACTIONS)[number];
export type NonEntityAuditAction = Exclude<AuditAction, EntityAuditAction>;

type EntityFields =
  | {
      action: EntityAuditAction;
      entity_type: AuditEntityType;
      entity_id: string;
    }
  | {
      action: NonEntityAuditAction;
      entity_type?: never;
      entity_id?: never;
    };

type ActorFields =
  | { admin_id: string; api_client_id?: never }
  | { admin_id?: never; api_client_id: string }
  | { admin_id?: never; api_client_id?: never };

type SourceFields =
  | {
      source: "SYSTEM";
      admin_id?: never;
      api_client_id?: never;
      ip_address?: never;
      user_agent?: never;
    }
  | ({
      source: Exclude<AuditSource, "SYSTEM">;
      ip_address?: string;
      user_agent?: string;
    } & ActorFields);

export type RecordAuditLogRequest = EntityFields &
  SourceFields & {
    old_values?: AuditValue;
    new_values?: AuditValue;
  };

// What a controller can pull off the incoming HTTP request for an audit
// entry; everything here is best-effort (never blocks the caller).
export type AuditRequestContext = {
  ip_address?: string;
  user_agent?: string;
};
