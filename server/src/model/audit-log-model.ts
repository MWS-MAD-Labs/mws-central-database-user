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
  "REACTIVATE_STUDENT",
  "DELETE_STUDENT",
  "REISSUE_STUDENT_NIS",
  "UPLOAD_STUDENT_PHOTO",
  "DELETE_STUDENT_PHOTO",
  "ROLLBACK_STUDENT_MUTATION",
  "CREATE_EMPLOYEE",
  "UPDATE_EMPLOYEE",
  "DEACTIVATE_EMPLOYEE",
  "DELETE_EMPLOYEE",
  "CREATE_INTERN",
  "UPDATE_INTERN",
  "DELETE_INTERN",
  "UPLOAD_EMPLOYEE_PHOTO",
  "DELETE_EMPLOYEE_PHOTO",
  "ROLLBACK_EMPLOYEE_MUTATION",
  "ROLLBACK_PC_ACTIVITY_MENTOR_MUTATION",
  "EXTEND_EMPLOYEE_CONTRACT",
  "AUTO_RESIGN_EMPLOYEE",
  "ISSUE_DISCIPLINARY_ACTION",
  "UPDATE_DISCIPLINARY_ACTION",
  "RESOLVE_DISCIPLINARY_ACTION",
  "REVOKE_DISCIPLINARY_ACTION",
  "AUTO_EXPIRE_DISCIPLINARY_ACTION",
  "CREATE_ACADEMIC_YEAR",
  "UPDATE_ACADEMIC_YEAR",
  "DELETE_ACADEMIC_YEAR",
  "CREATE_CLASS",
  "UPDATE_CLASS",
  "DELETE_CLASS",
  "ASSIGN_CLASS_TEACHER",
  "END_CLASS_TEACHER_ASSIGNMENT",
  "DELETE_CLASS_TEACHER_ASSIGNMENT",
  "REOPEN_CLASS_TEACHER_ASSIGNMENT",
  "CREATE_ENROLLMENT",
  "PROMOTE_STUDENT",
  "TRANSFER_STUDENT_CLASS",
  "FIX_ENROLLMENT_CLASS",
  "WITHDRAW_STUDENT_ENROLLMENT",
  "DELETE_ENROLLMENT",
  "RESTORE_ENROLLMENT",
  "REACTIVATE_ENROLLMENT",
  "ROLLBACK_PROMOTE_ENROLLMENT",
  "CREATE_PARENT_GUARDIAN",
  "UPDATE_PARENT_GUARDIAN",
  "DELETE_PARENT_GUARDIAN",
  "CREATE_CONSENT",
  "UPDATE_CONSENT",
  "DELETE_CONSENT",
  "CREATE_HEALTH_RECORD",
  "UPDATE_HEALTH_RECORD",
  "DELETE_HEALTH_RECORD",
  "CREATE_HEALTH_NOTE",
  "UPDATE_HEALTH_NOTE",
  "DELETE_HEALTH_NOTE",
  "CREATE_VACCINE_RECORD",
  "UPDATE_VACCINE_RECORD",
  "DELETE_VACCINE_RECORD",
  "ASSIGN_STUDENT_SUPPORT",
  "END_STUDENT_SUPPORT_ASSIGNMENT",
  "DELETE_STUDENT_SUPPORT_ASSIGNMENT",
  "REACTIVATE_STUDENT_SUPPORT_ASSIGNMENT",
  "CREATE_PC_ACTIVITY",
  "UPDATE_PC_ACTIVITY",
  "DELETE_PC_ACTIVITY",
  "CREATE_MASTER_DATA",
  "UPDATE_MASTER_DATA",
  "DELETE_MASTER_DATA",
  "UPLOAD_ATTACHMENT",
  "DOWNLOAD_ATTACHMENT",
  "DELETE_ATTACHMENT",
  "RESTORE_ATTACHMENT",
  "ACCESS_HEALTH_DATA",
  "ROLE_CHANGE",
  "PERMISSION_CHANGE",
  // Always about one specific, already-existing (or just-created) ApiClient
  // row - unlike API_ACCESS (OPTIONAL_ENTITY_AUDIT_ACTIONS below), there's
  // no "not found" case here to make entity_id optional for.
  "API_TOKEN_CREATE",
  "API_TOKEN_REVOKE",
  "API_TOKEN_ROTATE",
  "API_TOKEN_UPDATE_SCOPES",
] as const satisfies readonly AuditAction[];

export type EntityAuditAction = (typeof ENTITY_AUDIT_ACTIONS)[number];

// Actions where the entity is usually knowable but not guaranteed - an API
// lookup either resolves to a real record or doesn't (e.g. "employee not
// found for this email"), and both outcomes are worth logging. Unlike
// ENTITY_AUDIT_ACTIONS above, entity_type/entity_id are allowed here but not
// required - set them when there's a real record to point at, leave them
// out (not null) when there isn't.
export const OPTIONAL_ENTITY_AUDIT_ACTIONS = [
  "API_ACCESS",
  // A blocked action almost always names the record it was blocked on
  // (student_id, employee_id, ...) but a few call sites (bulk import,
  // list-level checks) genuinely have none.
  "UNAUTHORIZED_ACCESS",
  // Admin login already has admin_id as the actor - only the employee
  // login path (no Employee FK on AuditLog to be the actor) needs this,
  // so it can say entity_type: "Employee" instead of Actor showing
  // "System" with nothing else identifying who logged in.
  "LOGIN",
] as const satisfies readonly AuditAction[];

export type OptionalEntityAuditAction =
  (typeof OPTIONAL_ENTITY_AUDIT_ACTIONS)[number];
export type NonEntityAuditAction = Exclude<
  AuditAction,
  EntityAuditAction | OptionalEntityAuditAction
>;

type EntityFields =
  | {
      action: EntityAuditAction;
      entity_type: AuditEntityType;
      entity_id: string;
    }
  | {
      action: OptionalEntityAuditAction;
      entity_type?: AuditEntityType;
      entity_id?: string;
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
