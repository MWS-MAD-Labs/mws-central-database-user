import { AdminRole, type AdminUser } from "../generated/prisma/client";

// Separate from PROTECTED_SUPER_ADMIN_EMAILS (protected-admin.ts), which
// exists only to shield ~3 founder/dev accounts from being modified.
// This allowlist decides who may approve/reject an IdentifierChangeRequest.
function changeRequestApproverEmails(): string[] {
  return (process.env.IDENTIFIER_CHANGE_APPROVER_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

// Role floor: the CARE team that handles this data is already
// DATABASE_ADMIN at minimum, so the allowlist alone (open to any role,
// e.g. VIEWER) is deliberately not enough.
export function isChangeRequestApprover(
  admin: Pick<AdminUser, "role" | "email">,
): boolean {
  return (
    (admin.role === AdminRole.SUPER_ADMIN ||
      admin.role === AdminRole.DATABASE_ADMIN) &&
    changeRequestApproverEmails().includes(admin.email.trim().toLowerCase())
  );
}
