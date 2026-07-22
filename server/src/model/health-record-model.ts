import type { HealthRecord } from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export type CreateHealthRecordRequest = {
  student_id: string;
  blood_type?: string;
  needs_assistance?: boolean;
};

export type UpdateHealthRecordRequest = {
  student_id: string;
  blood_type?: string;
  needs_assistance?: boolean;
};

export type DeleteHealthRecordRequest = {
  student_id: string;
};

export type RestoreHealthRecordRequest = {
  student_id: string;
};

export type GetHealthRecordRequest = {
  student_id: string;
};

export type HealthRecordResponse = {
  id: string;
  student_id: string;
  blood_type: string | null;
  needs_assistance: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export function toHealthRecordResponse(
  record: HealthRecord,
): HealthRecordResponse {
  return {
    id: record.id,
    student_id: record.student_id,
    blood_type: record.blood_type,
    needs_assistance: record.needs_assistance,
    created_at: record.created_at.toISOString(),
    updated_at: record.updated_at.toISOString(),
    deleted_at: record.deleted_at ? record.deleted_at.toISOString() : null,
  };
}

export function toHealthRecordAuditSnapshot(
  record: HealthRecord,
): AuditValue {
  return {
    student_id: record.student_id,
    blood_type: record.blood_type,
    needs_assistance: record.needs_assistance,
    deleted_at: record.deleted_at ? record.deleted_at.toISOString() : null,
  };
}
