import { prismaClient } from "./prisma";
import { API_SCOPES } from "../constants/api-scopes";

// Keeps the api_scopes catalog in sync with the API_SCOPES constant, so a
// scope added in code is immediately grantable from the API Clients page -
// no manual `bun run seed:api-scopes` step after every deploy. Safe to run
// on every boot: every row is an upsert by name, existing scopes/grants are
// untouched.
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  [API_SCOPES.EMPLOYEES_READ]: "Read employee profile data",
  [API_SCOPES.STUDENTS_READ]: "Read student profile data",
  [API_SCOPES.STUDENTS_ACADEMIC_HISTORY_READ]: "Read student academic history",
  [API_SCOPES.STUDENTS_HEALTH_READ]: "Read student health records",
  [API_SCOPES.STUDENTS_CONSENT_READ]: "Read student consent attachments",
  [API_SCOPES.STUDENTS_SUPPORT_CONTACTS_READ]:
    "Read a student's current class homeroom/subject teachers",
  [API_SCOPES.STUDENTS_ROSTER_EXPORT_READ]:
    "Read the full flat roster export (includes health, parent contact, and consent fields)",
  [API_SCOPES.CLASS_TEACHER_ASSIGNMENTS_READ]:
    "Read which classes a teacher's account is currently assigned to (homeroom/subject)",
};

export async function syncApiScopes(): Promise<void> {
  for (const name of Object.values(API_SCOPES)) {
    await prismaClient.apiScope.upsert({
      where: { name },
      update: {},
      create: { name, description: SCOPE_DESCRIPTIONS[name] },
    });
  }
}
