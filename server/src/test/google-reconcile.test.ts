import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AdminUserTest, AuditLogTest, EmployeeTest, MasterDataTest, TestRequest } from "./test-utils";
import { EmployeeStatus, GoogleSyncStatus } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { setDirectoryClientForTests } from "../lib/google-workspace";
import { SimulatedDirectoryClient } from "../lib/google-workspace/simulated-directory-client";
import type { DirectoryUser } from "../lib/google-workspace/directory-client";
import { resetReconcileCacheForTests } from "../service/google-reconcile-service";
import { FakeDirectory } from "./fake-directory";

const user = (over: Partial<DirectoryUser> & { id: string; primaryEmail: string }): DirectoryUser => ({
  givenName: "Given",
  familyName: "Family",
  suspended: false,
  isAdmin: false,
  changePasswordAtNextLogin: false,
  lastLoginTime: null,
  ...over,
});

describe("comparing Central with Google", () => {
  let master: Awaited<ReturnType<typeof MasterDataTest.create>>;
  let google: FakeDirectory;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    master = await MasterDataTest.create();
    google = new FakeDirectory();
    setDirectoryClientForTests(google);
    process.env.GOOGLE_WORKSPACE_TEST_PREFIX = "test_rec";
    resetReconcileCacheForTests();
  });
  afterEach(async () => {
    delete process.env.GOOGLE_WORKSPACE_TEST_PREFIX;
    setDirectoryClientForTests(null);
    resetReconcileCacheForTests();
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  const employee = (email: string, over: { status?: EmployeeStatus } = {}) =>
    EmployeeTest.create({ email, unitId: master.unit.id, jobPositionId: master.position.id, jobLevelId: master.level.id, buildingId: master.building.id, ...over });
  const link = (personId: string, googleId: string, status: GoogleSyncStatus = GoogleSyncStatus.ACTIVE) =>
    prismaClient.person.update({ where: { id: personId }, data: { google_user_id: googleId, google_sync_status: status } });
  const rows = (data: any, group: string) => data.groups[group].rows.map((row: any) => row.email);

  it("puts every difference in its own group, and nothing else", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const same = await employee("test_rec_same@millennia21.id");
    const missing = await employee("test_rec_missing@millennia21.id");
    const unlinked = await employee("test_rec_unlinked@millennia21.id");
    const renamed = await employee("test_rec_renamed@millennia21.id");
    const moved = await employee("test_rec_moved@millennia21.id");
    const resigned = await employee("test_rec_resigned@millennia21.id", { status: EmployeeStatus.RESIGNED });
    const held = await employee("test_rec_held@millennia21.id");
    const gone = await employee("test_rec_gone@millennia21.id");
    for (const [person, id, over] of [
      [same, "g-same", {}],
      [renamed, "g-renamed", { givenName: "Other", familyName: "Name" }],
      [moved, "g-moved", { primaryEmail: "test_rec_moved_new@millennia21.id" }],
      [resigned, "g-resigned", {}],
      [held, "g-held", { suspended: true }],
    ] as const) {
      const email = (over as any).primaryEmail ?? person.email;
      google.users.set(id, user({ id, primaryEmail: email, givenName: "Given", familyName: "Family", ...(over as object) }));
      await link(person.id, id, GoogleSyncStatus.ACTIVE);
    }
    // The name Central holds for these is the test name, so make "same" match it.
    const sameName = (await prismaClient.person.findUniqueOrThrow({ where: { id: same.id } })).full_name;
    google.users.set("g-same", user({ id: "g-same", primaryEmail: same.email, givenName: sameName, familyName: "" }));
    await link(gone.id, "g-gone");
    google.users.set("g-unlinked", user({ id: "g-unlinked", primaryEmail: unlinked.email }));
    google.users.set("g-orphan", user({ id: "g-orphan", primaryEmail: "test_rec_orphan@millennia21.id" }));
    // Not part of the comparison: a Workspace admin, an address outside the prefix and outside the domain.
    google.users.set("g-admin", user({ id: "g-admin", primaryEmail: "test_rec_admin@millennia21.id", isAdmin: true }));
    google.users.set("g-other", user({ id: "g-other", primaryEmail: "someone@millennia21.id" }));
    google.users.set("g-out", user({ id: "g-out", primaryEmail: "test_rec_out@elsewhere.org" }));
    void missing;

    const response = await TestRequest.get("/api/admin/google/reconcile", accessToken);
    expect(response.status).toBe(200);
    const data = (await response.json()).data;

    expect(rows(data, "only_in_central")).toEqual(["test_rec_missing@millennia21.id"]);
    expect(rows(data, "only_in_google")).toEqual(["test_rec_orphan@millennia21.id"]);
    expect(rows(data, "not_linked")).toEqual(["test_rec_unlinked@millennia21.id"]);
    expect(rows(data, "email_differs")).toEqual(["test_rec_moved@millennia21.id"]);
    expect(rows(data, "name_differs").sort()).toContain("test_rec_renamed@millennia21.id");
    expect(rows(data, "should_be_suspended")).toEqual(["test_rec_resigned@millennia21.id"]);
    expect(rows(data, "suspended_in_google")).toEqual(["test_rec_held@millennia21.id"]);
    expect(rows(data, "link_broken")).toEqual(["test_rec_gone@millennia21.id"]);
    expect(rows(data, "only_in_central")).not.toContain("test_rec_same@millennia21.id");
    expect(typeof data.generated_at).toBe("string");
    expect(data.groups.only_in_google.truncated).toBe(false);
  });

  it("is for a Super Admin only, and needs the real Google", async () => {
    const dba = await AdminUserTest.createDatabaseAdmin(master.unit.id);
    expect((await TestRequest.get("/api/admin/google/reconcile", dba.accessToken)).status).toBe(403);
    await AdminUserTest.delete();
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    setDirectoryClientForTests(new SimulatedDirectoryClient());
    expect((await TestRequest.get("/api/admin/google/reconcile", accessToken)).status).toBe(400);
  });
});
