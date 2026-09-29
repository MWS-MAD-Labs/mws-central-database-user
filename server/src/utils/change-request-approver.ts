import { AdminRole, type AdminUser } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { logger } from "../lib/logger";

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

// A misconfigured allowlist (unset, a typo'd email, an email that was never
// promoted to admin, or one that got deactivated later) fails silently -
// isChangeRequestApprover just returns false for everyone and nothing ever
// surfaces that requests have no one able to approve them. Run this once at
// boot (see index.ts) to log a clear warning instead.
export async function validateChangeRequestApproverConfig(): Promise<void> {
  const emails = changeRequestApproverEmails();
  if (emails.length === 0) {
    logger.warn(
      "IDENTIFIER_CHANGE_APPROVER_EMAILS is unset or empty - no one can approve identifier change requests.",
    );
    return;
  }

  const matches = await prismaClient.adminUser.findMany({
    where: { email: { in: emails } },
    select: { email: true, role: true, is_active: true },
  });
  const matchByEmail = new Map(
    matches.map((admin) => [admin.email.trim().toLowerCase(), admin]),
  );

  const problems: string[] = [];
  for (const email of emails) {
    const match = matchByEmail.get(email);
    if (!match) {
      problems.push(`${email}: no admin account with this email exists`);
    } else if (!match.is_active) {
      problems.push(`${email}: admin account is deactivated`);
    } else if (
      match.role !== AdminRole.SUPER_ADMIN &&
      match.role !== AdminRole.DATABASE_ADMIN
    ) {
      problems.push(`${email}: role ${match.role} is below the required Database Admin floor`);
    }
  }

  if (problems.length > 0) {
    logger.warn(
      `IDENTIFIER_CHANGE_APPROVER_EMAILS has ${problems.length} misconfigured entr${problems.length === 1 ? "y" : "ies"}: ${problems.join("; ")}`,
    );
  } else {
    logger.info(
      `IDENTIFIER_CHANGE_APPROVER_EMAILS: ${emails.length} configured approver(s), all valid and active.`,
    );
  }
}
