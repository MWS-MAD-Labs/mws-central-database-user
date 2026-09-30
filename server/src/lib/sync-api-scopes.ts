import { prismaClient } from "./prisma";
import { API_SCOPES } from "../constants/api-scopes";
import { APPLICATION_INTEGRATION_PROFILES } from "../constants/application-integration-profiles";
import { getIntegrationEnvironment } from "../utils/integration-environment";

// Upsert scope definitions on boot without changing existing grants.
const SCOPE_DEFINITIONS: Record<
  string,
  { description: string; is_sensitive?: boolean }
> = {
  [API_SCOPES.EMPLOYEES_READ]: { description: "Read employee profile data" },
  [API_SCOPES.STUDENTS_READ]: { description: "Read student profile data" },
  [API_SCOPES.STUDENTS_ACADEMIC_HISTORY_READ]: {
    description: "Read student academic history",
  },
  [API_SCOPES.STUDENTS_HEALTH_READ]: {
    description: "Read student health records",
    is_sensitive: true,
  },
  [API_SCOPES.STUDENTS_CONSENT_READ]: {
    description: "Read student consent attachments",
    is_sensitive: true,
  },
  [API_SCOPES.STUDENTS_SUPPORT_CONTACTS_READ]:
    { description: "Read a student's current class homeroom/subject teachers" },
  [API_SCOPES.STUDENTS_ROSTER_EXPORT_READ]: {
    description:
      "Read the full flat roster export (includes health, parent contact, and consent fields)",
    is_sensitive: true,
  },
  [API_SCOPES.CLASSES_READ]: {
    description:
      "Read every active class, independent of whether it has a teacher assigned",
  },
  [API_SCOPES.CLASS_TEACHER_ASSIGNMENTS_READ]:
    {
      description:
        "Read which classes a teacher's account is currently assigned to (homeroom/subject)",
    },
  [API_SCOPES.STUDENT_SUPPORT_ASSIGNMENTS_READ]:
    {
      description:
        "Read which students an employee is the active SE/support teacher for",
    },
  [API_SCOPES.APPLICATION_ENTITLEMENTS_READ]:
    { description: "Read active application entitlements by stable person ID" },
};

export async function syncApiScopes(): Promise<void> {
  await prismaClient.$transaction(async (tx) => {
    for (const name of Object.values(API_SCOPES)) {
      const definition = SCOPE_DEFINITIONS[name];
      await tx.apiScope.upsert({
        where: { name },
        update: {
          description: definition.description,
          is_sensitive: definition.is_sensitive ?? false,
        },
        create: {
          name,
          description: definition.description,
          is_sensitive: definition.is_sensitive ?? false,
        },
      });
    }

    // Built-in profiles are only seeded when missing or empty (a profile can
    // never be saved with zero scopes, so empty means it was never seeded, or
    // its scope rows were reset with the scope catalog). After that they are
    // ordinary rows managed from the UI, so a restart never overwrites edits.
    for (const definition of APPLICATION_INTEGRATION_PROFILES) {
      const existing = await tx.applicationIntegrationProfile.findUnique({
        where: { code: definition.code },
        select: { id: true, _count: { select: { scopes: true } } },
      });
      if (existing && existing._count.scopes > 0) continue;

      const scopes = await tx.apiScope.findMany({
        where: { name: { in: [...definition.scopeNames] } },
        select: { id: true },
      });
      const profileId =
        existing?.id ??
        (
          await tx.applicationIntegrationProfile.create({
            data: {
              code: definition.code,
              name: definition.name,
              description: definition.description,
              is_system: true,
            },
          })
        ).id;
      await tx.applicationIntegrationProfileScope.createMany({
        data: scopes.map((scope) => ({ profile_id: profileId, scope_id: scope.id })),
        skipDuplicates: true,
      });
    }

    const hubProfile = await tx.applicationIntegrationProfile.findUnique({
      where: { code: "hub" },
    });
    if (hubProfile) {
      await tx.apiClient.updateMany({
        // The migration labels the existing Hub client DEVELOPMENT; correct it
        // to the server's environment. Clients moved to another profile stay put.
        where: {
          name: "MWS Hub",
          OR: [{ profile_id: null }, { profile_id: hubProfile.id }],
        },
        data: {
          profile_id: hubProfile.id,
          environment: getIntegrationEnvironment(),
          purpose: "backend",
        },
      });
    }
  });
}
