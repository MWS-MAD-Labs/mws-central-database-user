import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { prismaClient } from "../lib/prisma";
import { syncApiScopes } from "../lib/sync-api-scopes";
import { API_SCOPES } from "../constants/api-scopes";

const CODE = "test-sync-scopes-app";
const OTHER = "test-sync-scopes-other";

async function scopesOf(code: string) {
  const profile = await prismaClient.applicationIntegrationProfile.findUnique({
    where: { code },
    include: { scopes: { include: { scope: true } } },
  });
  return (profile?.scopes ?? []).map((item) => item.scope.name).sort();
}

describe("syncApiScopes connection profiles", () => {
  beforeAll(async () => {
    await syncApiScopes();
    const employees = await prismaClient.apiScope.findUniqueOrThrow({ where: { name: API_SCOPES.EMPLOYEES_READ } });
    await prismaClient.application.create({ data: { application_id: CODE, name: "Sync Scopes Test" } });
    for (const code of [CODE, OTHER]) {
      await prismaClient.applicationIntegrationProfile.create({
        data: { code, name: code, is_system: false, scopes: { create: [{ scope_id: employees.id }] } },
      });
    }
  });
  afterAll(async () => {
    for (const code of [CODE, OTHER]) {
      const profile = await prismaClient.applicationIntegrationProfile.findUnique({ where: { code } });
      if (!profile) continue;
      await prismaClient.applicationIntegrationProfileScope.deleteMany({ where: { profile_id: profile.id } });
      await prismaClient.applicationIntegrationProfile.delete({ where: { id: profile.id } });
    }
    await prismaClient.application.deleteMany({ where: { application_id: CODE } });
  });

  it("adds the scopes every connection needs to the profile of an application, and keeps the rest", async () => {
    await syncApiScopes();
    expect(await scopesOf(CODE)).toEqual(
      [API_SCOPES.APPLICATION_ENTITLEMENTS_READ, API_SCOPES.APPLICATION_PERMISSIONS_WRITE, API_SCOPES.EMPLOYEES_READ].sort(),
    );
    await syncApiScopes();
    expect(await scopesOf(CODE)).toHaveLength(3);
  });

  it("leaves a profile that belongs to no application alone", async () => {
    await syncApiScopes();
    expect(await scopesOf(OTHER)).toEqual([API_SCOPES.EMPLOYEES_READ]);
  });
});
