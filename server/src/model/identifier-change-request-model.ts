import type { Pageable } from "./page-model";
import type {
  AdminUser,
  IdentifierChangeRequest,
  IdentifierChangeRequestStatus,
} from "../generated/prisma/client";

export const IDENTIFIER_CHANGE_ENTITY_TYPES = ["Employee", "Student"] as const;
export type IdentifierChangeEntityType =
  (typeof IDENTIFIER_CHANGE_ENTITY_TYPES)[number];

export const EMPLOYEE_LOCKABLE_FIELDS = [
  "nik",
  "npwp",
  "bank_account_number",
  "bpjs_number",
  "bpjs_employment_number",
  "kpj_number",
] as const;
export type EmployeeLockableField = (typeof EMPLOYEE_LOCKABLE_FIELDS)[number];

export const STUDENT_LOCKABLE_FIELDS = ["nisn"] as const;
export type StudentLockableField = (typeof STUDENT_LOCKABLE_FIELDS)[number];

export const IDENTIFIER_FIELD_LABELS: Record<string, string> = {
  nik: "NIK",
  npwp: "NPWP",
  bank_account_number: "Bank account number",
  bpjs_number: "BPJS Kesehatan number",
  bpjs_employment_number: "BPJS Ketenagakerjaan number",
  kpj_number: "KPJ number",
  nisn: "NISN",
};

export type CreateIdentifierChangeRequest = {
  entity_type: IdentifierChangeEntityType;
  entity_id: string;
  field_name: string;
  new_value: string;
  reason: string;
};

export type DecideIdentifierChangeRequest = {
  id: string;
  decision_note?: string;
};

export type ListIdentifierChangeRequests = {
  status?: IdentifierChangeRequestStatus;
  entity_type?: IdentifierChangeEntityType;
  entity_id?: string;
  history?: boolean;
  page?: number;
  size?: number;
};

export type ListMyIdentifierChangeRequests = {
  entity_type?: IdentifierChangeEntityType;
  entity_id?: string;
  page?: number;
  size?: number;
};

export type MyIdentifierChangeRequestListResponse = Pageable<IdentifierChangeRequestResponse> & {
  // Decided (approved or rejected) requests the requester has not opened yet.
  unseen_decided_count: number;
};

export type IdentifierChangeRequestResponse = {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_name: string | null;
  field_name: string;
  field_label: string;
  // Null when the viewer can't see this field's PII.
  old_value: string | null;
  new_value: string | null;
  values_masked: boolean;
  reason: string;
  status: IdentifierChangeRequestStatus;
  requested_by: { id: string; full_name: string; email: string };
  requested_at: string;
  decided_by: { id: string; full_name: string; email: string } | null;
  decided_at: string | null;
  decision_note: string | null;
  can_decide: boolean;
  can_cancel: boolean;
};

export type IdentifierChangeRequestListResponse = Pageable<IdentifierChangeRequestResponse> & {
  can_approve: boolean;
  // Pending requests this admin can decide, for the sidebar badge.
  pending_decidable_count: number;
};

export function toIdentifierChangeRequestResponse(
  record: IdentifierChangeRequest & {
    requester: Pick<AdminUser, "id" | "full_name" | "email">;
    decider: Pick<AdminUser, "id" | "full_name" | "email"> | null;
  },
  options: {
    entityName: string | null;
    masked: boolean;
    canDecide: boolean;
    canCancel: boolean;
  },
): IdentifierChangeRequestResponse {
  return {
    id: record.id,
    entity_type: record.entity_type,
    entity_id: record.entity_id,
    entity_name: options.entityName,
    field_name: record.field_name,
    field_label: IDENTIFIER_FIELD_LABELS[record.field_name] ?? record.field_name,
    old_value: options.masked ? null : record.old_value,
    new_value: options.masked ? null : record.new_value,
    values_masked: options.masked,
    reason: record.reason,
    status: record.status,
    requested_by: {
      id: record.requester.id,
      full_name: record.requester.full_name,
      email: record.requester.email,
    },
    requested_at: record.requested_at.toISOString(),
    decided_by: record.decider
      ? {
          id: record.decider.id,
          full_name: record.decider.full_name,
          email: record.decider.email,
        }
      : null,
    decided_at: record.decided_at?.toISOString() ?? null,
    decision_note: record.decision_note,
    can_decide: options.canDecide,
    can_cancel: options.canCancel,
  };
}
