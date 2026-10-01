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
  "ROLLBACK_INTERN_MUTATION",
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
  "CREATE_CLASS_PC_ACTIVITY",
  "DELETE_CLASS_PC_ACTIVITY",
  "BULK_ENROLL_CLASS_PC_ACTIVITY",
  "CREATE_PC_ACTIVITY_ROOM",
  "UPDATE_PC_ACTIVITY_ROOM",
  "DELETE_PC_ACTIVITY_ROOM",
  "BULK_ASSIGN_PC_ACTIVITY_ROOM_STUDENTS",
  "ASSIGN_PC_ACTIVITY_ROOM_MENTOR",
  "END_PC_ACTIVITY_ROOM_MENTOR_ASSIGNMENT",
  "REMOVE_PC_ACTIVITY_ROOM_MENTOR_ASSIGNMENT",
  "REOPEN_PC_ACTIVITY_ROOM_MENTOR_ASSIGNMENT",
  "AUTO_EXPIRE_PC_ACTIVITY_ASSIGNMENT",
  "END_PC_ACTIVITY_ROOM_STUDENT_ASSIGNMENT",
  "DROP_PC_ACTIVITY_ROOM_STUDENT_ASSIGNMENT",
  "REOPEN_PC_ACTIVITY_ROOM_STUDENT_ASSIGNMENT",
  "MOVE_PC_ACTIVITY_ROOM_STUDENT_ASSIGNMENT",
  "MOVE_PC_ACTIVITY_ROOM_MENTOR_ASSIGNMENT",
  "REASSIGN_PC_ACTIVITY_ROOM_STUDENT",
  "REQUEST_IDENTIFIER_CHANGE",
  "APPROVE_IDENTIFIER_CHANGE_REQUEST",
  "REJECT_IDENTIFIER_CHANGE_REQUEST",
  "CREATE_MASTER_DATA",
  "UPDATE_MASTER_DATA",
  "DELETE_MASTER_DATA",
  "UPLOAD_ATTACHMENT",
  "DOWNLOAD_ATTACHMENT",
  "DELETE_ATTACHMENT",
  "RESTORE_ATTACHMENT",
  "ACCESS_HEALTH_DATA",
  "ACCESS_EMPLOYEE_PII",
  "ACCESS_STUDENT_PII",
  "ACCESS_EMPLOYEE_DISCIPLINARY_DATA",
  "IMPORT_DATA",
  "ROLLBACK_IMPORT",
  "ROLE_CHANGE",
  "PERMISSION_CHANGE",
  // API client mutations always identify an existing client.
  "API_TOKEN_CREATE",
  "API_TOKEN_REVOKE",
  "API_TOKEN_ROTATE",
  "API_TOKEN_UPDATE_SCOPES",
  "APPLICATION_ENTITLEMENT_GRANT",
  "APPLICATION_ENTITLEMENT_UPDATE",
  "APPLICATION_ENTITLEMENT_REVOKE",
] as const satisfies readonly AuditAction[];

export type EntityAuditAction = (typeof ENTITY_AUDIT_ACTIONS)[number];

// API lookups may be audited without an entity when no record matches.
export const OPTIONAL_ENTITY_AUDIT_ACTIONS = [
  "API_ACCESS",
  // Bulk and list-level blocked actions may not identify one entity.
  "UNAUTHORIZED_ACCESS",
  // Employee login uses entity fields because AuditLog has no employee actor FK.
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
