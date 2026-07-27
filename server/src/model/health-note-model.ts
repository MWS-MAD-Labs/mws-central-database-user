import type {
  HealthNote,
  HealthNoteCategory,
  HealthNoteStatus,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export type CreateHealthNoteRequest = {
  student_id: string;
  category: HealthNoteCategory;
  description: string;
  status?: HealthNoteStatus;
  noted_date?: string;
  resolved_date?: string;
};

export type UpdateHealthNoteRequest = {
  id: string;
  student_id: string;
  category?: HealthNoteCategory;
  description?: string;
  status?: HealthNoteStatus;
  noted_date?: string;
  resolved_date?: string;
};

export type DeleteHealthNoteRequest = {
  id: string;
  student_id: string;
};

export type RestoreHealthNoteRequest = {
  id: string;
  student_id: string;
};

export type GetHealthNoteListRequest = {
  student_id: string;
  is_deleted?: boolean;
};

export type HealthNoteResponse = {
  id: string;
  student_id: string;
  category: HealthNoteCategory;
  description: string;
  status: HealthNoteStatus;
  noted_date: string;
  resolved_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export function toHealthNoteResponse(note: HealthNote): HealthNoteResponse {
  return {
    id: note.id,
    student_id: note.student_id,
    category: note.category,
    description: note.description,
    status: note.status,
    noted_date: note.noted_date.toISOString(),
    resolved_date: note.resolved_date
      ? note.resolved_date.toISOString()
      : null,
    created_at: note.created_at.toISOString(),
    updated_at: note.updated_at.toISOString(),
    deleted_at: note.deleted_at ? note.deleted_at.toISOString() : null,
  };
}

export type HealthNoteExportRow = {
  student_nis: string;
  student_full_name: string;
  category: HealthNoteCategory;
  description: string;
  status: HealthNoteStatus;
  noted_date: string;
  resolved_date: string | null;
};

export function toHealthNoteExportRow(
  response: HealthNoteResponse,
  student: { nis: string; full_name: string },
): HealthNoteExportRow {
  return {
    student_nis: student.nis,
    student_full_name: student.full_name,
    category: response.category,
    description: response.description,
    status: response.status,
    noted_date: response.noted_date,
    resolved_date: response.resolved_date,
  };
}

export function toHealthNoteAuditSnapshot(note: HealthNote): AuditValue {
  return {
    student_id: note.student_id,
    category: note.category,
    description: note.description,
    status: note.status,
    noted_date: note.noted_date.toISOString(),
    resolved_date: note.resolved_date
      ? note.resolved_date.toISOString()
      : null,
    deleted_at: note.deleted_at ? note.deleted_at.toISOString() : null,
  };
}
