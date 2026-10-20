import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AdminUserTest,
  AuditLogTest,
  EmployeeTest,
  generateEmployeeAccessToken,
  MasterDataTest,
  TestRequest,
} from "./test-utils";
import {
  AuditAction,
  EmploymentType,
  EmployeeStatus,
  Gender,
  GoogleSyncStatus,
  MaritalStatus,
  Religion,
  type MasterBuilding,
  type MasterJobLevel,
  type MasterJobPosition,
  type MasterUnit,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { setDirectoryClientForTests } from "../lib/google-workspace";
import { SimulatedDirectoryClient } from "../lib/google-workspace/simulated-directory-client";
import {
  DirectoryError,
  type CreateDirectoryUser,
  type DirectoryClient,
  type DirectoryUser,
  type UpdateDirectoryUser,
} from "../lib/google-workspace/directory-client";
import { GoogleWorkspaceService, generateTemporaryPassword, splitName } from "../service/google-workspace-service";
import { detectImageMimeType } from "../utils/image-processing";
import sharp from "sharp";

// A Google that lives in memory and remembers what it was asked.
class FakeDirectory implements DirectoryClient {
  readonly mode = "google" as const;
  users = new Map<string, DirectoryUser>();
  created: CreateDirectoryUser[] = [];
  updated: { userKey: string; patch: UpdateDirectoryUser }[] = [];
  passwords: { userKey: string; password: string }[] = [];
  photos: { userKey: string; mimeType: string; size: number }[] = [];
  failCreateWith: DirectoryError | null = null;
  // Users deleted in Google that can still be restored.
  deleted = new Map<string, DirectoryUser>();
  restored: { userId: string; orgUnitPath: string }[] = [];

  async findUser(userKey: string) {
    return [...this.users.values()].find((user) => user.id === userKey || user.primaryEmail === userKey) ?? null;
  }
  async findDeletedUser(email: string, userId?: string | null) {
    return [...this.deleted.values()].find((user) => user.primaryEmail === email || (userId && user.id === userId)) ?? null;
  }
  async listUsers({ deleted }: { deleted: boolean }) {
    return [...(deleted ? this.deleted : this.users).values()];
  }
  async createUser(input: CreateDirectoryUser) {
    // The address of a deleted account is still taken.
    if ([...this.deleted.values()].some((user) => user.primaryEmail === input.primaryEmail)) {
      throw new DirectoryError("EXISTS", "exists");
    }
    if (this.failCreateWith) throw this.failCreateWith;
    this.created.push(input);
    const user: DirectoryUser = {
      id: `g-${this.created.length}`,
      primaryEmail: input.primaryEmail,
      givenName: input.givenName,
      familyName: input.familyName,
      suspended: false,
      isAdmin: false,
      changePasswordAtNextLogin: true, lastLoginTime: null,
    };
    this.users.set(user.id, user);
    return user;
  }
  async updateUser(userKey: string, patch: UpdateDirectoryUser) {
    this.updated.push({ userKey, patch });
    const user = await this.findUser(userKey);
    if (!user) throw new DirectoryError("NOT_FOUND", "gone");
    const next = { ...user, ...patch };
    this.users.set(user.id, next);
    return next;
  }
  async restoreUser(userId: string, orgUnitPath: string) {
    const user = this.deleted.get(userId);
    if (!user) throw new DirectoryError("NOT_FOUND", "gone");
    this.deleted.delete(userId);
    this.restored.push({ userId, orgUnitPath });
    this.users.set(userId, user);
    return user;
  }
  async setSuspended(userKey: string, suspended: boolean) {
    const user = await this.findUser(userKey);
    if (!user) throw new DirectoryError("NOT_FOUND", "gone");
    const next = { ...user, suspended };
    this.users.set(user.id, next);
    return next;
  }
  async resetPassword(userKey: string, password: string) {
    if (!(await this.findUser(userKey))) throw new DirectoryError("NOT_FOUND", "gone");
    this.passwords.push({ userKey, password });
  }
  async setPhoto(userKey: string, photo: Buffer, mimeType: string) {
    this.photos.push({ userKey, mimeType, size: photo.length });
  }
}

describe("google workspace accounts", () => {
  let master: { unit: MasterUnit; position: MasterJobPosition; level: MasterJobLevel; building: MasterBuilding };
  let google: FakeDirectory;
  let seq = 0;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    master = await MasterDataTest.create();
    google = new FakeDirectory();
    setDirectoryClientForTests(google);
    // The fake says it is Google, so outside production the test prefix applies, like for a real one.
    process.env.GOOGLE_WORKSPACE_TEST_PREFIX = "test_google";
  });
  afterEach(async () => {
    delete process.env.GOOGLE_WORKSPACE_TEST_PREFIX;
    setDirectoryClientForTests(null);
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  const body = (over: Record<string, unknown> = {}) => {
    seq += 1;
    return {
      full_name: "Rizqi Sabilla Putra",
      nick_name: "Rizqi",
      email: `test_google_${seq}@millennia21.id`,
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: "1995-01-01T00:00:00.000Z",
      employee_id: `99.99.8${String(seq).padStart(2, "0")}`,
      marital_status: MaritalStatus.SINGLE,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: master.unit.id,
      job_position_id: master.position.id,
      job_level_id: master.level.id,
      building_id: master.building.id,
      join_date: new Date("2026-01-01").toISOString(),
      ...over,
    };
  };
  const create = async (token: string, over: Record<string, unknown> = {}) => {
    const response = await TestRequest.post("/api/admin/employees", body(over), token);
    return { response, json: await response.json() };
  };
  const personOf = (employeeId: string) =>
    prismaClient.person.findFirstOrThrow({ where: { employee: { id: employeeId } } });

  describe("the helpers", () => {
    it("gives Google a given and a family name", () => {
      expect(splitName("Rizqi Sabilla Putra")).toEqual({ givenName: "Rizqi Sabilla", familyName: "Putra" });
      expect(splitName("Dewi")).toEqual({ givenName: "Dewi", familyName: "-" });
    });
    it("makes a different password of the asked length each time", () => {
      const a = generateTemporaryPassword();
      expect(a).toHaveLength(16);
      expect(a).not.toBe(generateTemporaryPassword());
    });
  });

  it("makes the Google account of a new employee, with the recovery email and no known password", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const { response, json } = await create(accessToken, { recovery_email: "rizqi.pribadi@gmail.com" });
    expect(response.status).toBe(200);
    // The form is told what happened to the Google account.
    expect(json.data.google).toMatchObject({ status: "ACTIVE", outcome: "created" });

    expect(google.created).toHaveLength(1);
    expect(google.created[0]).toMatchObject({ givenName: "Rizqi Sabilla", familyName: "Putra", recoveryEmail: "rizqi.pribadi@gmail.com" });
    const person = await personOf(json.data.id);
    expect(person.google_sync_status).toBe(GoogleSyncStatus.ACTIVE);
    expect(person.google_user_id).toBe("g-1");
    // The recovery email went to Google and is nowhere in Central.
    expect(JSON.stringify(person)).not.toContain("rizqi.pribadi@gmail.com");
  });

  it("links the account Google already has to a person who is already in Central", async () => {
    google.users.set("existing", {
      id: "existing", primaryEmail: "test_google_existing@millennia21.id", givenName: "A", familyName: "B",
      suspended: false, isAdmin: false, changePasswordAtNextLogin: false, lastLoginTime: null,
    });
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const person = await EmployeeTest.create({
      email: "test_google_existing@millennia21.id",
      unitId: master.unit.id,
      jobPositionId: master.position.id,
      jobLevelId: master.level.id,
      buildingId: master.building.id,
    });
    const response = await TestRequest.post(`/api/admin/employees/${person.employee!.id}/google/provision`, {}, accessToken);
    expect(response.status).toBe(200);
    expect(google.created).toHaveLength(0);
    expect((await personOf(person.employee!.id)).google_user_id).toBe("existing");
  });

  it("says so when the Google account already belongs to another person in Central", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const first = await EmployeeTest.create({
      email: "test_google_first@millennia21.id",
      unitId: master.unit.id,
      jobPositionId: master.position.id,
      jobLevelId: master.level.id,
      buildingId: master.building.id,
    });
    await prismaClient.person.update({ where: { id: first.id }, data: { google_user_id: "shared", deleted_at: new Date() } });
    const second = await EmployeeTest.create({
      email: "test_google_second@millennia21.id",
      unitId: master.unit.id,
      jobPositionId: master.position.id,
      jobLevelId: master.level.id,
      buildingId: master.building.id,
    });
    google.users.set("shared", {
      id: "shared", primaryEmail: "test_google_second@millennia21.id", givenName: "A", familyName: "B",
      suspended: false, isAdmin: false, changePasswordAtNextLogin: false, lastLoginTime: null,
    });
    const response = await TestRequest.post(`/api/admin/employees/${second.employee!.id}/google/provision`, {}, accessToken);
    const result = (await response.json()).data;
    expect(result.status).toBe("FAILED");
    expect(result.message).toContain("already linked to Test Employee (archived)");
    expect((await prismaClient.person.findUniqueOrThrow({ where: { id: second.id } })).google_user_id).toBeNull();
    expect((await prismaClient.person.findUniqueOrThrow({ where: { id: first.id } })).google_user_id).toBe("shared");
  });

  it("does not call an error of ours a Google problem", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const person = await EmployeeTest.create({
      email: "test_google_boom@millennia21.id",
      unitId: master.unit.id,
      jobPositionId: master.position.id,
      jobLevelId: master.level.id,
      buildingId: master.building.id,
    });
    google.findUser = async () => {
      throw new TypeError("something of ours broke");
    };
    const response = await TestRequest.post(`/api/admin/employees/${person.employee!.id}/google/provision`, {}, accessToken);
    const result = (await response.json()).data;
    expect(result.message).toContain("Unexpected error (TypeError)");
    expect(result.message).not.toContain("could not be reached");
    expect(result.message).not.toContain("something of ours broke");
  });

  it("does not create a person whose email already has a Google account", async () => {
    google.users.set("existing", {
      id: "existing", primaryEmail: "test_google_taken@millennia21.id", givenName: "A", familyName: "B",
      suspended: false, isAdmin: false, changePasswordAtNextLogin: false, lastLoginTime: null,
    });
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const { response, json } = await create(accessToken, { email: "test_google_taken@millennia21.id" });
    expect(response.status).toBe(400);
    expect(JSON.stringify(json)).toContain("already has a Google account");
    expect(await prismaClient.person.count({ where: { email: "test_google_taken@millennia21.id" } })).toBe(0);
  });

  it("keeps the employee and shows a failed status when Google fails", async () => {
    google.failCreateWith = new DirectoryError("DENIED", "Google refused the request (forbidden)");
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const { response, json } = await create(accessToken);
    expect(response.status).toBe(200);
    expect(json.data.google).toMatchObject({ status: "FAILED", outcome: "failed" });
    expect(json.data.google.message).toContain("refused");
    const person = await personOf(json.data.id);
    expect(person.google_sync_status).toBe(GoogleSyncStatus.FAILED);
    expect(person.google_last_error).toContain("refused");

    // Retry from the status screen once Google works.
    google.failCreateWith = null;
    const retry = await TestRequest.post(`/api/admin/employees/${json.data.id}/google/provision`, {}, accessToken);
    expect(retry.status).toBe(200);
    expect((await personOf(json.data.id)).google_sync_status).toBe(GoogleSyncStatus.ACTIVE);
  });

  it("does not create a person on the email of a Workspace admin", async () => {
    google.users.set("boss", {
      id: "boss", primaryEmail: "test_google_boss@millennia21.id", givenName: "A", familyName: "B",
      suspended: false, isAdmin: true, changePasswordAtNextLogin: false, lastLoginTime: null,
    });
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const { response } = await create(accessToken, { email: "test_google_boss@millennia21.id" });
    expect(response.status).toBe(400);
    expect(google.created).toHaveLength(0);
    expect(google.updated).toHaveLength(0);
  });

  it("outside production, does not create a person whose address Google would not take", async () => {
    process.env.GOOGLE_WORKSPACE_TEST_PREFIX = "test.central.";
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const { response, json } = await create(accessToken);
    expect(response.status).toBe(400);
    expect(JSON.stringify(json)).toContain("test.central.");
    expect(google.created).toHaveLength(0);
    expect(await prismaClient.person.count({ where: { email: { startsWith: "test_google_" } } })).toBe(0);
  });

  describe("the email check before create", () => {
    const check = async (token: string, email: string) => {
      const response = await TestRequest.get(`/api/admin/google/email-availability?email=${encodeURIComponent(email)}`, token);
      return { response, json: await response.json() };
    };

    it("says an email is free, taken in Google, taken in Central, or outside the domain", async () => {
      google.users.set("g1", {
        id: "g1", primaryEmail: "test_google_ingoogle@millennia21.id", givenName: "A", familyName: "B",
        suspended: false, isAdmin: false, changePasswordAtNextLogin: false, lastLoginTime: null,
      });
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { json: created } = await create(accessToken, { email: "test_google_incentral@millennia21.id" });
      expect(created.data.id).toBeTruthy();

      expect((await check(accessToken, "test_google_free@millennia21.id")).json.data).toMatchObject({ available: true, reason: "FREE" });
      expect((await check(accessToken, "test_google_ingoogle@millennia21.id")).json.data).toMatchObject({ available: false, reason: "IN_GOOGLE" });
      expect((await check(accessToken, "test_google_incentral@millennia21.id")).json.data).toMatchObject({ available: false, reason: "IN_CENTRAL" });
      expect((await check(accessToken, "someone@gmail.com")).json.data).toMatchObject({ available: false, reason: "INVALID" });
      expect((await check(accessToken, "a+b@millennia21.id")).json.data).toMatchObject({ available: false, reason: "INVALID" });
    });

    it("says outside production which addresses may not be sent to Google", async () => {
      process.env.GOOGLE_WORKSPACE_TEST_PREFIX = "test.central.";
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      expect((await check(accessToken, "test_google_other@millennia21.id")).json.data).toMatchObject({ available: false, reason: "NOT_ALLOWED" });
      expect((await check(accessToken, "test.central.ok@millennia21.id")).json.data).toMatchObject({ available: true, reason: "FREE" });
    });

    it("does not block when Google cannot be asked, or when it is only simulated", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      google.findUser = async () => {
        throw new DirectoryError("FAILED", "down");
      };
      expect((await check(accessToken, "test_google_down@millennia21.id")).json.data).toMatchObject({ available: true, reason: "CHECK_FAILED" });

      setDirectoryClientForTests(new SimulatedDirectoryClient());
      expect((await check(accessToken, "test_google_sim@millennia21.id")).json.data).toMatchObject({ available: true, reason: "NOT_CHECKED" });
    });

    it("is for the admins who can create employees", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      await AdminUserTest.delete();
      const viewer = await AdminUserTest.createViewer(master.unit.id);
      expect((await check(viewer.accessToken, "test_google_x@millennia21.id")).response.status).toBe(403);
      expect(accessToken).toBeTruthy();
    });
  });

  it("refuses a recovery email that is an organization address", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const { response } = await create(accessToken, { recovery_email: "someone@millennia21.id" });
    expect(response.status).toBe(400);
  });

  it("updates the Google account when the name changes, and leaves it alone otherwise", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const { json } = await create(accessToken);
    const id = json.data.id as string;

    await TestRequest.patch(`/api/admin/employees/${id}`, { notes: "nothing about the name" }, accessToken);
    expect(google.updated).toHaveLength(0);

    await TestRequest.patch(`/api/admin/employees/${id}`, { full_name: "Rizqi Putra Baru" }, accessToken);
    expect(google.updated).toHaveLength(1);
    expect(google.updated[0].patch).toMatchObject({ givenName: "Rizqi Putra", familyName: "Baru" });
  });

  describe("reset password", () => {
    it("gives a Super Admin a new password once, and keeps it out of the audit log", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { json } = await create(accessToken);
      const response = await TestRequest.post(`/api/admin/employees/${json.data.id}/google/reset-password`, {}, accessToken);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const { password } = (await response.json()).data;
      expect(password).toHaveLength(16);
      expect(google.passwords[0].password).toBe(password);

      const entries = await prismaClient.auditLog.findMany({ where: { action: AuditAction.GOOGLE_PASSWORD_RESET } });
      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries[0])).not.toContain(password);
    });

    it("is for Super Admins only", async () => {
      const { accessToken: superToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { json } = await create(superToken);
      await AdminUserTest.delete();
      const plain = await AdminUserTest.createDatabaseAdmin(master.unit.id);
      const response = await TestRequest.post(`/api/admin/employees/${json.data.id}/google/reset-password`, {}, plain.accessToken);
      expect(response.status).toBe(403);
      expect(google.passwords).toHaveLength(0);
    });

    it("says the account is missing when the person has none in Google", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const person = await EmployeeTest.create({
        email: "test_google_nolink@millennia21.id",
        unitId: master.unit.id,
        jobPositionId: master.position.id,
        jobLevelId: master.level.id,
        buildingId: master.building.id,
      });
      const response = await TestRequest.post(`/api/admin/employees/${person.employee!.id}/google/reset-password`, {}, accessToken);
      expect(response.status).toBe(404);
    });
  });

  describe("deleted and inactive accounts", () => {
    const gone = (id: string, email: string): DirectoryUser => ({
      id, primaryEmail: email, givenName: "A", familyName: "B", suspended: false, isAdmin: false,
      changePasswordAtNextLogin: false, lastLoginTime: null,
    });
    const linkedPerson = async (token: string) => {
      const { json } = await create(token);
      return { id: json.data.id as string, person: await personOf(json.data.id) };
    };
    const statusOf = async (token: string, id: string, refresh = false) =>
      (await (await TestRequest.get(`/api/admin/employees/${id}/google${refresh ? "?refresh=true" : ""}`, token)).json()).data;

    it("holds an email back whose Google account was deleted less than 20 days ago", async () => {
      google.deleted.set("old", gone("old", "test_google_deleted@millennia21.id"));
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const response = await TestRequest.get("/api/admin/google/email-availability?email=test_google_deleted@millennia21.id", accessToken);
      expect((await response.json()).data).toMatchObject({ available: false, reason: "DELETED_IN_GOOGLE" });

      const created = await create(accessToken, { email: "test_google_deleted@millennia21.id" });
      expect(created.response.status).toBe(400);
      expect(created.json.errors).toContain("deleted less than 20 days ago");
      expect(await prismaClient.person.count({ where: { email: "test_google_deleted@millennia21.id" } })).toBe(0);
    });

    it("explains a refused address when Google shows no such user but will not take it", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const person = await EmployeeTest.create({
        email: "test_google_held@millennia21.id",
        unitId: master.unit.id,
        jobPositionId: master.position.id,
        jobLevelId: master.level.id,
        buildingId: master.building.id,
      });
      google.deleted.set("old", gone("old", "test_google_held@millennia21.id"));
      const response = await TestRequest.post(`/api/admin/employees/${person.employee!.id}/google/provision`, {}, accessToken);
      const { data } = await response.json();
      expect(data.outcome).toBe("failed");
      expect(data.message).toContain("deleted less than 20 days ago");
    });

    it("shows a suspended account, a deleted one, and the account coming back", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id, person } = await linkedPerson(accessToken);
      const user = google.users.get(person.google_user_id!)!;

      google.users.set(user.id, { ...user, suspended: true });
      expect(await statusOf(accessToken, id, true)).toMatchObject({ status: GoogleSyncStatus.SUSPENDED, last_error: "Suspended in Google" });

      google.users.delete(user.id);
      google.deleted.set(user.id, user);
      expect(await statusOf(accessToken, id, true)).toMatchObject({
        status: GoogleSyncStatus.MISSING,
        last_error: "Deleted in Google, can be restored for about 20 days",
        password_state: null,
      });

      google.deleted.delete(user.id);
      expect(await statusOf(accessToken, id, true)).toMatchObject({ status: GoogleSyncStatus.MISSING, last_error: "Not found in Google" });

      google.users.set(user.id, user);
      expect(await statusOf(accessToken, id, true)).toMatchObject({ status: GoogleSyncStatus.ACTIVE, last_error: null });
    });

    it("looks at Google again only after a few minutes, unless a Super Admin asks", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id, person } = await linkedPerson(accessToken);
      const user = google.users.get(person.google_user_id!)!;
      await statusOf(accessToken, id, true);
      google.users.set(user.id, { ...user, suspended: true });

      expect((await statusOf(accessToken, id)).status).toBe(GoogleSyncStatus.ACTIVE);
      await prismaClient.person.update({ where: { id: person.id }, data: { google_checked_at: new Date(Date.now() - 10 * 60 * 1000) } });
      expect((await statusOf(accessToken, id)).status).toBe(GoogleSyncStatus.SUSPENDED);
    });

    it("counts down the days Google keeps a deleted account", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id, person } = await linkedPerson(accessToken);
      const user = google.users.get(person.google_user_id!)!;
      google.users.delete(user.id);
      const deletedAt = new Date(Date.now() - 8 * 86_400_000);
      google.deleted.set(user.id, { ...user, deletionTime: deletedAt });
      const data = await statusOf(accessToken, id, true);
      expect(data.deleted_at).toBe(deletedAt.toISOString());
      expect(data.restorable_until).toBe(new Date(deletedAt.getTime() + 20 * 86_400_000).toISOString());

      google.deleted.set("other", { ...gone("other", "test_google_other_gone@millennia21.id"), deletionTime: deletedAt });
      const check = await TestRequest.get("/api/admin/google/email-availability?email=test_google_other_gone@millennia21.id", accessToken);
      expect((await check.json()).data.message).toContain("deleted 8 days ago, so it cannot be reused yet, and the address is free again in about 12 days");

      google.deleted.delete(user.id);
      google.users.set(user.id, user);
      expect((await statusOf(accessToken, id, true)).restorable_until).toBeNull();
    });

    it("restores the person's own deleted account, and only for a Super Admin", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id, person } = await linkedPerson(accessToken);
      const user = google.users.get(person.google_user_id!)!;
      expect((await TestRequest.post(`/api/admin/employees/${id}/google/restore`, {}, accessToken)).status).toBe(400);

      google.users.delete(user.id);
      google.deleted.set(user.id, { ...user, deletionTime: new Date() });
      await statusOf(accessToken, id, true);

      const plain = await AdminUserTest.createDatabaseAdmin(master.unit.id);
      expect((await TestRequest.post(`/api/admin/employees/${id}/google/restore`, {}, plain.accessToken)).status).toBe(403);
      expect(google.restored).toHaveLength(0);

      const response = await TestRequest.post(`/api/admin/employees/${id}/google/restore`, {}, accessToken);
      expect(response.status).toBe(200);
      expect(google.restored).toEqual([{ userId: user.id, orgUnitPath: "/" }]);
      expect(await statusOf(accessToken, id)).toMatchObject({ status: GoogleSyncStatus.ACTIVE, restorable_until: null });
      expect(await prismaClient.auditLog.count({ where: { action: AuditAction.GOOGLE_ACCOUNT_RESTORE } })).toBe(1);
    });

    it("says so when the deleted account is gone before it is restored", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id, person } = await linkedPerson(accessToken);
      await prismaClient.person.update({ where: { id: person.id }, data: { google_sync_status: GoogleSyncStatus.MISSING } });
      const response = await TestRequest.post(`/api/admin/employees/${id}/google/restore`, {}, accessToken);
      expect(response.status).toBe(404);
    });

    it("suspends and unsuspends, and leaves a Workspace admin alone", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id, person } = await linkedPerson(accessToken);
      const user = google.users.get(person.google_user_id!)!;

      expect((await TestRequest.post(`/api/admin/employees/${id}/google/suspend`, {}, accessToken)).status).toBe(200);
      expect(google.users.get(user.id)!.suspended).toBe(true);
      expect(await statusOf(accessToken, id)).toMatchObject({ status: GoogleSyncStatus.SUSPENDED });

      expect((await TestRequest.post(`/api/admin/employees/${id}/google/unsuspend`, {}, accessToken)).status).toBe(200);
      expect(google.users.get(user.id)!.suspended).toBe(false);
      expect(await statusOf(accessToken, id)).toMatchObject({ status: GoogleSyncStatus.ACTIVE });

      google.users.set(user.id, { ...google.users.get(user.id)!, isAdmin: true });
      expect((await TestRequest.post(`/api/admin/employees/${id}/google/suspend`, {}, accessToken)).status).toBe(400);
    });

    it("still finds a deleted account by its id when its email no longer matches", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id, person } = await linkedPerson(accessToken);
      const user = google.users.get(person.google_user_id!)!;
      google.users.delete(user.id);
      google.deleted.set(user.id, { ...user, primaryEmail: "test_google_renamed@millennia21.id" });
      expect(await statusOf(accessToken, id, true)).toMatchObject({
        status: GoogleSyncStatus.MISSING,
        last_error: "Deleted in Google, can be restored for about 20 days",
      });
    });

    it("does not call an account gone when the deleted list cannot be read", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id, person } = await linkedPerson(accessToken);
      const user = google.users.get(person.google_user_id!)!;
      google.users.delete(user.id);
      google.findDeletedUser = async () => {
        throw new DirectoryError("FAILED", "down");
      };
      expect((await statusOf(accessToken, id, true)).status).toBe(GoogleSyncStatus.ACTIVE);
    });

    it("keeps the last answer when Google cannot be reached", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id } = await linkedPerson(accessToken);
      google.findUser = async () => {
        throw new DirectoryError("FAILED", "down");
      };
      expect((await statusOf(accessToken, id, true)).status).toBe(GoogleSyncStatus.ACTIVE);
    });

    it("says whether the person has set their own password", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id, person } = await linkedPerson(accessToken);
      expect((await statusOf(accessToken, id)).password_state).toBe("PENDING");

      await prismaClient.person.update({
        where: { id: person.id },
        data: { google_password_issued_at: new Date(Date.now() - 8 * 86_400_000), google_checked_at: null },
      });
      expect((await statusOf(accessToken, id)).password_state).toBe("OVERDUE");

      const user = google.users.get(person.google_user_id!)!;
      google.users.set(user.id, { ...user, changePasswordAtNextLogin: false, lastLoginTime: new Date("2026-10-30T08:00:00Z") });
      const done = await statusOf(accessToken, id, true);
      expect(done.password_state).toBe("SET");
      expect(done.last_login_at).toBe("2026-10-30T08:00:00.000Z");

      await TestRequest.post(`/api/admin/employees/${id}/google/reset-password`, {}, accessToken);
      expect((await statusOf(accessToken, id)).password_state).toBe("PENDING");
    });

    it("checks everyone with two list calls and leaves unlinked people alone", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const first = await linkedPerson(accessToken);
      const second = await linkedPerson(accessToken);
      const unlinked = await EmployeeTest.create({
        email: "test_google_sweep_none@millennia21.id",
        unitId: master.unit.id,
        jobPositionId: master.position.id,
        jobLevelId: master.level.id,
        buildingId: master.building.id,
      });
      const a = google.users.get(first.person.google_user_id!)!;
      google.users.set(a.id, { ...a, suspended: true });
      const b = google.users.get(second.person.google_user_id!)!;
      google.users.delete(b.id);
      google.deleted.set(b.id, b);

      let lists = 0;
      const list = google.listUsers.bind(google);
      google.listUsers = async (options) => {
        lists += 1;
        return list(options);
      };
      expect(await GoogleWorkspaceService.refreshAllStatuses()).toBe(2);
      expect(lists).toBe(2);
      expect((await personOf(first.id)).google_sync_status).toBe(GoogleSyncStatus.SUSPENDED);
      expect((await personOf(second.id)).google_sync_status).toBe(GoogleSyncStatus.MISSING);
      expect((await personOf(unlinked.employee!.id)).google_sync_status).toBe(GoogleSyncStatus.NONE);
    });

    it("does nothing against the simulated Google, which forgets its users", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      await linkedPerson(accessToken);
      setDirectoryClientForTests(new SimulatedDirectoryClient());
      expect(await GoogleWorkspaceService.refreshAllStatuses()).toBe(0);
    });
  });

  describe("own photo", () => {
    const png = () => sharp({ create: { width: 300, height: 200, channels: 3, background: "#7e1518" } }).png().toBuffer();

    it("lets the signed-in employee change their own photo, here and in Google", async () => {
      const { accessToken: superToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { json } = await create(superToken);
      const person = await personOf(json.data.id);
      const token = await generateEmployeeAccessToken(json.data.id, person.email);

      const form = new FormData();
      form.append("file", new File([await png()], "me.png", { type: "image/png" }));
      const response = await TestRequest.putMultipart("/api/auth/employee/me/photo", form, token);
      expect(response.status).toBe(200);

      expect((await personOf(json.data.id)).photo_object_key).toContain(`employee-photos/${json.data.id}/`);
      expect(google.photos).toHaveLength(1);
      expect(google.photos[0].mimeType).toBe("image/jpeg");
      expect(await prismaClient.auditLog.count({ where: { action: AuditAction.UPLOAD_OWN_PHOTO } })).toBe(1);
    });

    it("is not open to an admin session", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const form = new FormData();
      form.append("file", new File([await png()], "me.png", { type: "image/png" }));
      const response = await TestRequest.putMultipart("/api/auth/employee/me/photo", form, accessToken);
      expect(response.status).toBe(401);
    });
  });

  it("detects the formats it accepts", async () => {
    expect(detectImageMimeType(await sharp({ create: { width: 2, height: 2, channels: 3, background: "#000" } }).png().toBuffer())).toBe("image/png");
  });
});
