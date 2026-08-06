import type {
  ConsentRecord,
  ConsentStatus,
  ConsentType,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export type CreateConsentRequest = {
  student_id: string;
  consent_type: ConsentType;
  status?: ConsentStatus;
  consent_date?: string;
  signed_by?: string;
  notes?: string;
  validity_period?: string;
};

export type UpdateConsentRequest = {
  id: string;
  student_id: string;
  status?: ConsentStatus;
  consent_date?: string;
  signed_by?: string;
  notes?: string;
  validity_period?: string;
};

export type DeleteConsentRequest = {
  id: string;
  student_id: string;
};

export type RestoreConsentRequest = {
  id: string;
  student_id: string;
};

export type GetConsentListRequest = {
  student_id: string;
  is_deleted?: boolean;
};

export type ConsentResponse = {
  id: string;
  student_id: string;
  consent_type: ConsentType;
  status: ConsentStatus;
  consent_date: string | null;
  signed_by: string | null;
  notes: string | null;
  validity_period: string | null;
  // Always empty for now - attachment upload (Part B) isn't built yet.
  // Kept in the response shape so the API contract doesn't change once it is.
  attachments: [];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export function toConsentResponse(consent: ConsentRecord): ConsentResponse {
  return {
    id: consent.id,
    student_id: consent.student_id,
    consent_type: consent.consent_type,
    status: consent.status,
    consent_date: consent.consent_date
      ? consent.consent_date.toISOString()
      : null,
    signed_by: consent.signed_by,
    notes: consent.notes,
    validity_period: consent.validity_period
      ? consent.validity_period.toISOString()
      : null,
    attachments: [],
    created_at: consent.created_at.toISOString(),
    updated_at: consent.updated_at.toISOString(),
    deleted_at: consent.deleted_at ? consent.deleted_at.toISOString() : null,
  };
}

export type ConsentExportRow = {
  student_nis: string;
  student_full_name: string;
  consent_type: ConsentType;
  status: ConsentStatus;
  consent_date: string | null;
  signed_by: string | null;
  validity_period: string | null;
};

export function toConsentExportRow(
  response: ConsentResponse,
  student: { nis: string | null; full_name: string },
): ConsentExportRow {
  return {
    student_nis: student.nis ?? "",
    student_full_name: student.full_name,
    consent_type: response.consent_type,
    status: response.status,
    consent_date: response.consent_date,
    signed_by: response.signed_by,
    validity_period: response.validity_period,
  };
}

export function toConsentAuditSnapshot(consent: ConsentRecord): AuditValue {
  return {
    student_id: consent.student_id,
    consent_type: consent.consent_type,
    status: consent.status,
    consent_date: consent.consent_date
      ? consent.consent_date.toISOString()
      : null,
    signed_by: consent.signed_by,
    notes: consent.notes,
    validity_period: consent.validity_period
      ? consent.validity_period.toISOString()
      : null,
    deleted_at: consent.deleted_at ? consent.deleted_at.toISOString() : null,
  };
}
