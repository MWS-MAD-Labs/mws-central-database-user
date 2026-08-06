import type { VaccineRecord, VaccineType } from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export type CreateVaccineRecordRequest = {
  student_id: string;
  vaccine_type: VaccineType;
  received?: boolean;
  date?: string;
};

export type UpdateVaccineRecordRequest = {
  id: string;
  student_id: string;
  received?: boolean;
  date?: string;
};

export type DeleteVaccineRecordRequest = {
  id: string;
  student_id: string;
};

export type RestoreVaccineRecordRequest = {
  id: string;
  student_id: string;
};

export type GetVaccineRecordListRequest = {
  student_id: string;
  is_deleted?: boolean;
};

export type VaccineRecordResponse = {
  id: string;
  student_id: string;
  vaccine_type: VaccineType;
  received: boolean;
  date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export function toVaccineRecordResponse(
  record: VaccineRecord,
): VaccineRecordResponse {
  return {
    id: record.id,
    student_id: record.student_id,
    vaccine_type: record.vaccine_type,
    received: record.received,
    date: record.date ? record.date.toISOString() : null,
    created_at: record.created_at.toISOString(),
    updated_at: record.updated_at.toISOString(),
    deleted_at: record.deleted_at ? record.deleted_at.toISOString() : null,
  };
}

export type VaccineRecordExportRow = {
  student_nis: string;
  student_full_name: string;
  vaccine_type: VaccineType;
  received: boolean;
  date: string | null;
};

export function toVaccineRecordExportRow(
  response: VaccineRecordResponse,
  student: { nis: string | null; full_name: string },
): VaccineRecordExportRow {
  return {
    student_nis: student.nis ?? "",
    student_full_name: student.full_name,
    vaccine_type: response.vaccine_type,
    received: response.received,
    date: response.date,
  };
}

export function toVaccineRecordAuditSnapshot(
  record: VaccineRecord,
): AuditValue {
  return {
    student_id: record.student_id,
    vaccine_type: record.vaccine_type,
    received: record.received,
    date: record.date ? record.date.toISOString() : null,
    deleted_at: record.deleted_at ? record.deleted_at.toISOString() : null,
  };
}
