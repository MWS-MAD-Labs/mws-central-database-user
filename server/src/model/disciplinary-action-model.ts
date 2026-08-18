import type {
  DisciplinaryActionType,
  DisciplinaryActionStatus,
  EmployeeDisciplinaryAction,
} from "../generated/prisma/client";

export type CreateDisciplinaryActionRequest = {
  employee_id: string;
  type: DisciplinaryActionType;
  reason: string;
  notes?: string;
  // Defaults to now when omitted - lets an admin backdate a letter that was
  // actually issued earlier but only entered into the system later.
  issued_date?: string;
  // How many days this record stays ACTIVE from issued_date - defaults to
  // 180 (~6 months) when omitted. Not a fixed company-wide rule - the
  // admin picks it per record (e.g. 7 days for a minor note, 12 months for
  // something serious).
  validity_days?: number;
};

// Reason/notes only - type, level, status, and dates are all computed by
// the ST/SP sequencing rules or are status-transition actions (resolve/
// revoke), not free-text fields an admin edits directly.
export type UpdateDisciplinaryActionRequest = {
  id: string;
  employee_id: string;
  reason?: string;
  notes?: string;
};

export type ResolveDisciplinaryActionRequest = {
  id: string;
  employee_id: string;
  resolved_reason?: string;
};

export type RevokeDisciplinaryActionRequest = {
  id: string;
  employee_id: string;
};

export type ListDisciplinaryActionsRequest = {
  employee_id: string;
};

export type DisciplinaryActionResponse = {
  id: string;
  employee_id: string;
  type: DisciplinaryActionType;
  level: number;
  status: DisciplinaryActionStatus;
  issued_date: string;
  valid_until: string;
  reason: string;
  notes: string | null;
  issued_by_admin_id: string | null;
  issued_by_admin_name: string | null;
  resolved_at: string | null;
  resolved_reason: string | null;
  // Non-deleted attachment count only - enough for the UI to show a
  // paperclip indicator without a separate query per row.
  attachment_count: number;
  created_at: string;
};

export function toDisciplinaryActionResponse(
  action: EmployeeDisciplinaryAction & {
    issued_by_admin?: { full_name: string } | null;
    _count?: { attachments: number };
  },
): DisciplinaryActionResponse {
  return {
    id: action.id,
    employee_id: action.employee_id,
    type: action.type,
    level: action.level,
    status: action.status,
    issued_date: action.issued_date.toISOString(),
    valid_until: action.valid_until.toISOString(),
    reason: action.reason,
    notes: action.notes,
    issued_by_admin_id: action.issued_by_admin_id,
    issued_by_admin_name: action.issued_by_admin?.full_name ?? null,
    resolved_at: action.resolved_at ? action.resolved_at.toISOString() : null,
    resolved_reason: action.resolved_reason,
    attachment_count: action._count?.attachments ?? 0,
    created_at: action.created_at.toISOString(),
  };
}
