import { AuditAction, AuditSource, type AdminUser } from "../generated/prisma/client";
import { withLookupCache } from "../lib/lookup-cache";
import type { AuditRequestContext } from "../model/audit-log-model";
import { AuditService } from "../service/audit-service";

// One audit row per admin and student per viewing session, shared by every
// read that releases a student's hidden personal data (birth details, parent
// contacts), so the API itself is audited and not only the UI button.
export async function auditStudentPiiAccess(
  admin: AdminUser,
  studentId: string,
  studentName: string | null,
  context: AuditRequestContext = {},
): Promise<void> {
  const { cached } = await withLookupCache(
    "student-pii-access",
    [admin.id, studentId],
    async () => true,
  );
  if (cached) return;

  await AuditService.record({
    action: AuditAction.ACCESS_STUDENT_PII,
    source: AuditSource.UI,
    entity_type: "Student",
    entity_id: studentId,
    admin_id: admin.id,
    new_values: { resource: "StudentSensitiveFields", full_name: studentName },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}
