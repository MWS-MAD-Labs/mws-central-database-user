import type {
  AdminUser,
  ParentGuardian,
  ParentType,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";
import { canViewSensitiveData } from "../utils/sensitive-data";

export type CreateParentGuardianRequest = {
  student_id: string;
  type: ParentType;
  full_name: string;
  phone?: string;
  email?: string;
  address?: string;
  is_primary?: boolean;
};

export type UpdateParentGuardianRequest = {
  id: string;
  student_id: string;
  type?: ParentType;
  full_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  is_primary?: boolean;
};

export type DeleteParentGuardianRequest = {
  id: string;
  student_id: string;
};

export type RestoreParentGuardianRequest = {
  id: string;
  student_id: string;
};

export type GetParentGuardianListRequest = {
  student_id: string;
  is_deleted?: boolean;
};

export type ParentGuardianResponse = {
  id: string;
  student_id: string;
  type: ParentType;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export function toParentGuardianResponse(
  parentGuardian: ParentGuardian,
  admin: Pick<AdminUser, "role" | "can_view_sensitive_data">,
): ParentGuardianResponse {
  return {
    id: parentGuardian.id,
    student_id: parentGuardian.student_id,
    type: parentGuardian.type,
    full_name: parentGuardian.full_name,
    ...(canViewSensitiveData(admin) && {
      phone: parentGuardian.phone,
      email: parentGuardian.email,
      address: parentGuardian.address,
    }),
    is_primary: parentGuardian.is_primary,
    created_at: parentGuardian.created_at.toISOString(),
    updated_at: parentGuardian.updated_at.toISOString(),
    deleted_at: parentGuardian.deleted_at
      ? parentGuardian.deleted_at.toISOString()
      : null,
  };
}

export type ParentGuardianExportRow = {
  student_nis: string;
  student_full_name: string;
  type: ParentType;
  parent_full_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_primary: boolean;
};

export function toParentGuardianExportRow(
  response: ParentGuardianResponse,
  student: { nis: string; full_name: string },
): ParentGuardianExportRow {
  return {
    student_nis: student.nis,
    student_full_name: student.full_name,
    type: response.type,
    parent_full_name: response.full_name,
    phone: response.phone ?? null,
    email: response.email ?? null,
    address: response.address ?? null,
    is_primary: response.is_primary,
  };
}

export function toParentGuardianAuditSnapshot(
  parentGuardian: ParentGuardian,
): AuditValue {
  return {
    student_id: parentGuardian.student_id,
    type: parentGuardian.type,
    full_name: parentGuardian.full_name,
    phone: parentGuardian.phone,
    email: parentGuardian.email,
    address: parentGuardian.address,
    is_primary: parentGuardian.is_primary,
    deleted_at: parentGuardian.deleted_at
      ? parentGuardian.deleted_at.toISOString()
      : null,
  };
}
