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
import { MemoryMailer, setMailerForTests } from "../lib/mailer";
import { SimulatedDirectoryClient } from "../lib/google-workspace/simulated-directory-client";
import {
  DirectoryError,
  type CreateDirectoryUser,
  type DirectoryClient,
  type DirectoryUser,
  type UpdateDirectoryUser,
} from "../lib/google-workspace/directory-client";
import { GoogleWorkspaceService, generateTemporaryPassword, resetSignInEmailLimitForTests, splitName } from "../service/google-workspace-service";
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
      recoveryEmail: input.recoveryEmail ?? null,
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
  async setRecoveryEmail(userKey: string, recoveryEmail: string) {
    const user = await this.findUser(userKey);
    if (!user) throw new DirectoryError("NOT_FOUND", "gone");
    const next = { ...user, recoveryEmail };
    this.users.set(user.id, next);
    return next;
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

  it("makes the Google account of a new employee, with the recovery email and a temporary password shown once", async () => {
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

    // The first password is the one Google got, comes back once, and is not kept anywhere.
    const password = json.data.google.temporary_password as string;
    expect(password).toHaveLength(16);
    expect(google.created[0].password).toBe(password);
    expect(JSON.stringify(person)).not.toContain(password);
    expect(JSON.stringify(await prismaClient.auditLog.findMany())).not.toContain(password);
    const status = await (await TestRequest.get(`/api/admin/employees/${json.data.id}/google`, accessToken)).json();
    expect(JSON.stringify(status)).not.toContain(password);
  });

  it("gives no password for an account that was already in Google", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const existing = await create(accessToken);
    expect(existing.json.data.google.temporary_password).toBeDefined();
    await prismaClient.person.update({
      where: { id: (await personOf(existing.json.data.id)).id },
      data: { google_user_id: null, google_sync_status: GoogleSyncStatus.NONE },
    });
    const response = await TestRequest.post(`/api/admin/employees/${existing.json.data.id}/google/provision`, {}, accessToken);
    const data = (await response.json()).data;
    expect(data.outcome).toBe("linked");
    expect(data.temporary_password).toBeUndefined();
  });

  describe("mailing the first sign-in details", () => {
    let mailer: MemoryMailer;
    beforeEach(() => {
      mailer = new MemoryMailer();
      setMailerForTests(mailer);
      resetSignInEmailLimitForTests();
    });
    afterEach(() => setMailerForTests(null));

    const made = async (token: string) => {
      const { json } = await create(token, { recovery_email: "pribadi.owner@gmail.com" });
      return { id: json.data.id as string, email: json.data.identity.email as string, password: json.data.google.temporary_password as string };
    };
    const send = (id: string, token: string, over: Record<string, unknown> = {}) =>
      TestRequest.post(`/api/admin/employees/${id}/google/send-sign-in`, { to: "pribadi.owner@gmail.com", language: "id", ...over }, token);

    it("sends a mail the server wrote, with the name, email and password, and keeps the password out of the audit", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const account = await made(accessToken);
      const response = await send(account.id, accessToken, { password: account.password });
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({ sent: true });

      expect(mailer.outbox).toHaveLength(1);
      const mail = mailer.outbox[0];
      expect(mail.to).toBe("pribadi.owner@gmail.com");
      expect(mail.text).toContain("Halo Rizqi Sabilla Putra");
      expect(mail.text).toContain(account.email);
      expect(mail.text).toContain(account.password);

      const entries = await prismaClient.auditLog.findMany({ where: { action: AuditAction.GOOGLE_SIGNIN_EMAILED } });
      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries)).not.toContain(account.password);
      expect(JSON.stringify(entries)).not.toContain("pribadi.owner@gmail.com");
      expect(JSON.stringify(entries)).toContain("p***@gmail.com");
    });

    it("writes the mail in English when asked", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const account = await made(accessToken);
      await send(account.id, accessToken, { password: account.password, language: "en" });
      expect(mailer.outbox[0].subject).toBe("Your Millennia Google account is ready");
      expect(mailer.outbox[0].text).toContain("Temporary password:");
    });

    it("says so when the server has no email set up", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const account = await made(accessToken);
      setMailerForTests({ enabled: false, send: async () => {} });
      const response = await send(account.id, accessToken, { password: account.password });
      expect(response.status).toBe(503);
      const status = await (await TestRequest.get(`/api/admin/employees/${account.id}/google`, accessToken)).json();
      expect(status.data.email_enabled).toBe(false);
    });

    it("refuses the account's own address, a bad address or a short password, and an account already in use", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const account = await made(accessToken);
      expect((await send(account.id, accessToken, { password: account.password, to: account.email })).status).toBe(400);
      expect((await send(account.id, accessToken, { password: account.password, to: "not-an-email" })).status).toBe(400);
      expect((await send(account.id, accessToken, { password: "short" })).status).toBe(400);
      expect(mailer.outbox).toHaveLength(0);

      // They have signed in and set their own password: nothing to send any more.
      await prismaClient.person.update({ where: { id: (await personOf(account.id)).id }, data: { google_password_pending: false } });
      expect((await send(account.id, accessToken, { password: account.password })).status).toBe(409);
      // Issued long ago.
      await prismaClient.person.update({
        where: { id: (await personOf(account.id)).id },
        data: { google_password_pending: true, google_password_issued_at: new Date(Date.now() - 3 * 86_400_000) },
      });
      expect((await send(account.id, accessToken, { password: account.password })).status).toBe(409);
      expect(mailer.outbox).toHaveLength(0);
    });

    it("is for the admins who may create the account", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const account = await made(accessToken);
      await AdminUserTest.delete();
      const noWrite = await AdminUserTest.createDatabaseAdmin(master.unit.id, { canWriteEmployeeData: false });
      expect((await send(account.id, noWrite.accessToken, { password: account.password })).status).toBe(403);
      expect(mailer.outbox).toHaveLength(0);
    });

    it("stops one admin after twenty mails an hour", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const account = await made(accessToken);
      for (let i = 0; i < 20; i += 1) {
        expect((await send(account.id, accessToken, { password: account.password })).status).toBe(200);
      }
      expect((await send(account.id, accessToken, { password: account.password })).status).toBe(429);
    });
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

  it("takes another mailbox of the organization as the recovery email, and refuses the account's own address", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const ok = await create(accessToken, { recovery_email: "someone.else@millennia21.id" });
    expect(ok.response.status).toBe(200);
    expect(google.created[0].recoveryEmail).toBe("someone.else@millennia21.id");

    const email = "test_google_selfrec@millennia21.id";
    const own = await create(accessToken, { email, recovery_email: "Test_Google_SelfRec@millennia21.id" });
    expect(own.response.status).toBe(400);
    expect(JSON.stringify(own.json)).toContain("own address");
    expect(await prismaClient.person.count({ where: { email } })).toBe(0);
  });

  it("refuses the account's own address as the recovery email when making or changing it later", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const person = await EmployeeTest.create({
      email: "test_google_ownlater@millennia21.id",
      unitId: master.unit.id,
      jobPositionId: master.position.id,
      jobLevelId: master.level.id,
      buildingId: master.building.id,
    });
    const refused = await TestRequest.post(`/api/admin/employees/${person.employee!.id}/google/provision`, { recovery_email: "test_google_ownlater@millennia21.id" }, accessToken);
    expect(refused.status).toBe(400);
    expect(google.created).toHaveLength(0);

    const { json } = await create(accessToken);
    const own = await personOf(json.data.id);
    const change = await TestRequest.post(`/api/admin/employees/${json.data.id}/google/recovery-email`, { recovery_email: own.email }, accessToken);
    expect(change.status).toBe(400);
    const other = await TestRequest.post(`/api/admin/employees/${json.data.id}/google/recovery-email`, { recovery_email: "colleague@millennia21.id" }, accessToken);
    expect(other.status).toBe(200);
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

  describe("changing the email of someone with a Google account", () => {
    const put = (token: string, id: string, email: string) =>
      TestRequest.patch(`/api/admin/employees/${id}`, { email }, token);

    it("refuses an email Google already has, and lets a free one through", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { json } = await create(accessToken);
      google.users.set("taken", {
        id: "taken", primaryEmail: "test_google_taken@millennia21.id", givenName: "A", familyName: "B",
        suspended: false, isAdmin: false, changePasswordAtNextLogin: false, lastLoginTime: null,
      });
      const refused = await put(accessToken, json.data.id, "test_google_taken@millennia21.id");
      expect(refused.status).toBe(400);
      expect((await personOf(json.data.id)).email).not.toBe("test_google_taken@millennia21.id");

      const allowed = await put(accessToken, json.data.id, "test_google_renamed_ok@millennia21.id");
      expect(allowed.status).toBe(200);
    });

    it("does not ask Google about someone who has no account", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const person = await EmployeeTest.create({
        email: "test_google_nolink2@millennia21.id",
        unitId: master.unit.id,
        jobPositionId: master.position.id,
        jobLevelId: master.level.id,
        buildingId: master.building.id,
      });
      google.users.set("taken2", {
        id: "taken2", primaryEmail: "test_google_taken2@millennia21.id", givenName: "A", familyName: "B",
        suspended: false, isAdmin: false, changePasswordAtNextLogin: false, lastLoginTime: null,
      });
      expect((await put(accessToken, person.employee!.id, "test_google_taken2@millennia21.id")).status).toBe(200);
    });
  });

  describe("an account that is deleted in Google", () => {
    const deleteInGoogle = async (token: string) => {
      const { json } = await create(token);
      const person = await personOf(json.data.id);
      const user = google.users.get(person.google_user_id!)!;
      google.users.delete(user.id);
      google.deleted.set(user.id, { ...user, deletionTime: new Date() });
      await TestRequest.get(`/api/admin/employees/${json.data.id}/google?refresh=true`, token);
      return { id: json.data.id as string, person, user };
    };

    it("refuses a temporary password, a recovery email and suspending until it is restored", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id } = await deleteInGoogle(accessToken);
      const base = `/api/admin/employees/${id}/google`;
      for (const [path, body] of [
        ["reset-password", {}],
        ["recovery-email", { recovery_email: "a@gmail.com" }],
        ["suspend", {}],
        ["unsuspend", {}],
      ] as const) {
        const response = await TestRequest.post(`${base}/${path}`, body, accessToken);
        expect(response.status).toBe(400);
        expect(JSON.stringify(await response.json())).toContain("Restore it first");
      }
      expect(google.passwords).toHaveLength(0);
    });

    it("lets the email change in Central without touching Google, and restoring renames the account", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id, person, user } = await deleteInGoogle(accessToken);
      const updatesBefore = google.updated.length;

      const changed = await TestRequest.patch(`/api/admin/employees/${id}`, { email: "test_google_afterdelete@millennia21.id" }, accessToken);
      expect(changed.status).toBe(200);
      expect(google.updated).toHaveLength(updatesBefore);
      expect((await personOf(id)).google_sync_status).toBe(GoogleSyncStatus.MISSING);

      const restored = await TestRequest.post(`/api/admin/employees/${id}/google/restore`, {}, accessToken);
      expect(restored.status).toBe(200);
      expect(google.users.get(user.id)!.primaryEmail).toBe("test_google_afterdelete@millennia21.id");
      expect((await personOf(id)).google_sync_status).toBe(GoogleSyncStatus.ACTIVE);
      expect(person.id).toBeTruthy();
    });
  });

  describe("accounts that were in Google before Central", () => {
    const gUser = (id: string, email: string, over: Partial<DirectoryUser> = {}): DirectoryUser => ({
      id, primaryEmail: email, givenName: "A", familyName: "B", suspended: false, isAdmin: false,
      changePasswordAtNextLogin: false, lastLoginTime: null, ...over,
    });
    const unlinked = (email: string) =>
      EmployeeTest.create({
        email,
        unitId: master.unit.id,
        jobPositionId: master.position.id,
        jobLevelId: master.level.id,
        buildingId: master.building.id,
      });
    const readStatus = async (token: string, id: string) =>
      (await (await TestRequest.get(`/api/admin/employees/${id}/google`, token)).json()).data;

    it("tells that an unlinked person is already in Google, and links them without a recovery email", async () => {
      google.users.set("old", gUser("old", "test_google_dummy@millennia21.id"));
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const person = await unlinked("test_google_dummy@millennia21.id");
      const status = await readStatus(accessToken, person.employee!.id);
      expect(status).toMatchObject({ linked: false, in_google: true, status: GoogleSyncStatus.NONE });

      const response = await TestRequest.post(`/api/admin/employees/${person.employee!.id}/google/provision`, {}, accessToken);
      expect((await response.json()).data.outcome).toBe("linked");
      expect(google.created).toHaveLength(0);
      expect(await readStatus(accessToken, person.employee!.id)).toMatchObject({ linked: true, in_google: false });
    });

    it("does not call a Workspace admin or an email Google lacks 'in Google'", async () => {
      google.users.set("boss", gUser("boss", "test_google_boss@millennia21.id", { isAdmin: true }));
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const admin = await unlinked("test_google_boss@millennia21.id");
      const absent = await unlinked("test_google_absent@millennia21.id");
      expect((await readStatus(accessToken, admin.employee!.id)).in_google).toBe(false);
      expect((await readStatus(accessToken, absent.employee!.id)).in_google).toBe(false);
    });

    it("shows what linking would do without doing it, then links the matches", async () => {
      google.users.set("g-a", gUser("g-a", "test_google_la@millennia21.id"));
      google.users.set("g-b", gUser("g-b", "test_google_lb@millennia21.id"));
      google.users.set("g-boss", gUser("g-boss", "test_google_lboss@millennia21.id", { isAdmin: true }));
      google.users.set("g-taken", gUser("g-taken", "test_google_ltaken@millennia21.id"));
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const a = await unlinked("test_google_la@millennia21.id");
      await unlinked("test_google_lb@millennia21.id");
      await unlinked("test_google_lboss@millennia21.id");
      await unlinked("test_google_lnone@millennia21.id");
      const taken = await unlinked("test_google_ltaken@millennia21.id");
      const other = await unlinked("test_google_lother@millennia21.id");
      await prismaClient.person.update({ where: { id: other.id }, data: { google_user_id: "g-taken", google_sync_status: GoogleSyncStatus.ACTIVE } });

      const preview = (await (await TestRequest.get("/api/admin/google/link-existing", accessToken)).json()).data;
      expect(preview.applied).toBe(false);
      expect(preview.matches.map((match: { email: string }) => match.email).sort()).toEqual([
        "test_google_la@millennia21.id", "test_google_lb@millennia21.id",
      ]);
      expect(preview.skipped).toMatchObject({ admin: 1, linked_elsewhere: 1 });
      expect((await personOf(a.employee!.id)).google_user_id).toBeNull();

      const done = (await (await TestRequest.post("/api/admin/google/link-existing", {}, accessToken)).json()).data;
      expect(done).toMatchObject({ applied: true, linked: 2 });
      expect((await personOf(a.employee!.id)).google_user_id).toBe("g-a");
      expect((await personOf(taken.employee!.id)).google_user_id).toBeNull();
      expect(await prismaClient.auditLog.count({ where: { action: AuditAction.GOOGLE_ACCOUNT_PROVISION } })).toBe(2);
    });

    it("says what it could and could not find out about an unlinked person", async () => {
      google.users.set("here", gUser("here", "test_google_here@millennia21.id"));
      google.users.set("boss2", gUser("boss2", "test_google_boss2@millennia21.id", { isAdmin: true }));
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const lookupOf = async (email: string) => (await readStatus(accessToken, (await unlinked(email)).employee!.id)).lookup;

      expect(await lookupOf("test_google_here@millennia21.id")).toMatchObject({ state: "found" });
      expect(await lookupOf("test_google_nobody@millennia21.id")).toMatchObject({ state: "absent", message: null });
      expect(await lookupOf("test_google_boss2@millennia21.id")).toMatchObject({ state: "admin" });
      // Outside the test prefix the address is never sent to Google, so nothing is known about it.
      const outside = await lookupOf("dummystaff@millennia21.id");
      expect(outside.state).toBe("blocked");
      expect(outside.message).toContain("test_google");

      google.findUser = async () => {
        throw new DirectoryError("FAILED", "down");
      };
      expect(await lookupOf("test_google_down@millennia21.id")).toMatchObject({ state: "failed" });

      setDirectoryClientForTests(new SimulatedDirectoryClient());
      expect(await lookupOf("test_google_sim@millennia21.id")).toMatchObject({ state: "simulated" });
    });

    it("still refuses to make an account for an address Central may not reach", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const person = await unlinked("dummystaff2@millennia21.id");
      const response = await TestRequest.post(`/api/admin/employees/${person.employee!.id}/google/provision`, { recovery_email: "a@gmail.com" }, accessToken);
      expect(response.status).toBe(400);
      expect(google.created).toHaveLength(0);
    });

    it("counts only working accounts as linked, and says which addresses it could not look at", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const ok = await unlinked("test_google_cok@millennia21.id");
      const gone = await unlinked("test_google_cgone@millennia21.id");
      const broken = await unlinked("test_google_cbroken@millennia21.id");
      await unlinked("dummystaff@millennia21.id");
      await unlinked("test_google_cnone@millennia21.id");
      await prismaClient.person.update({ where: { id: ok.id }, data: { google_user_id: "g-ok", google_sync_status: GoogleSyncStatus.ACTIVE } });
      await prismaClient.person.update({ where: { id: gone.id }, data: { google_user_id: "g-gone", google_sync_status: GoogleSyncStatus.MISSING } });
      await prismaClient.person.update({ where: { id: broken.id }, data: { google_sync_status: GoogleSyncStatus.FAILED } });

      const data = (await (await TestRequest.get("/api/admin/google/link-existing", accessToken)).json()).data;
      expect(data).toMatchObject({ linked_total: 1, missing: 1, failed: 1, suspended: 0, not_checked: 1, not_in_google: 2 });
    });

    it("removes links the simulated Google made, once the real one is used", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const person = await unlinked("asdasd@millennia21.id");
      await prismaClient.person.update({
        where: { id: person.id },
        data: { google_user_id: "simulated-1", google_sync_status: GoogleSyncStatus.ACTIVE, google_synced_at: new Date() },
      });
      const status = await readStatus(accessToken, person.employee!.id);
      expect(status).toMatchObject({ linked: false, status: GoogleSyncStatus.NONE });
      expect(status.lookup.state).toBe("blocked");
      expect((await personOf(person.employee!.id)).google_user_id).toBeNull();

      // The simulated Google keeps its own links.
      setDirectoryClientForTests(new SimulatedDirectoryClient());
      await prismaClient.person.update({ where: { id: person.id }, data: { google_user_id: "simulated-2", google_sync_status: GoogleSyncStatus.ACTIVE } });
      expect((await readStatus(accessToken, person.employee!.id)).linked).toBe(true);
    });

    it("is for Super Admins and needs the real Google", async () => {
      const plain = await AdminUserTest.createDatabaseAdmin(master.unit.id);
      expect((await TestRequest.get("/api/admin/google/link-existing", plain.accessToken)).status).toBe(403);
      expect((await TestRequest.post("/api/admin/google/link-existing", {}, plain.accessToken)).status).toBe(403);

      await AdminUserTest.delete();
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      setDirectoryClientForTests(new SimulatedDirectoryClient());
      expect((await TestRequest.get("/api/admin/google/link-existing", accessToken)).status).toBe(400);
    });
  });

  describe("hints in the lists", () => {
    it("carry the Google problems of an employee and of an intern", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { json } = await create(accessToken, { full_name: "Hint Person" });
      const person = await personOf(json.data.id);

      const list = async () => {
        const body = await (await TestRequest.get("/api/admin/employees?search=Hint Person", accessToken)).json();
        return body.data[0].google_account;
      };
      expect(await list()).toEqual({ status: GoogleSyncStatus.ACTIVE, hints: [] });

      await prismaClient.person.update({ where: { id: person.id }, data: { google_sync_status: GoogleSyncStatus.FAILED, google_last_error: "Google refused" } });
      expect(await list()).toEqual({ status: GoogleSyncStatus.FAILED, hints: [{ code: "FAILED", detail: "Google refused" }] });

      await prismaClient.person.update({ where: { id: person.id }, data: { google_sync_status: GoogleSyncStatus.ACTIVE, google_last_error: null } });
      await prismaClient.employee.update({ where: { id: json.data.id }, data: { status: EmployeeStatus.RESIGNED } });
      expect((await list()).hints.map((hint: { code: string }) => hint.code)).toEqual(["LEFT_STILL_ACTIVE"]);
    });
  });

  describe("who may do what", () => {
    const unlinked = (email: string, unitId: string) =>
      EmployeeTest.create({
        email,
        unitId,
        jobPositionId: master.position.id,
        jobLevelId: master.level.id,
        buildingId: master.building.id,
      });

    it("lets a Database Admin who may write employees make the account of someone in their unit", async () => {
      const person = await unlinked("test_google_dbmake@millennia21.id", master.unit.id);
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(master.unit.id);
      const response = await TestRequest.post(
        `/api/admin/employees/${person.employee!.id}/google/provision`,
        { recovery_email: "dbmake.pribadi@gmail.com" },
        accessToken,
      );
      expect(response.status).toBe(200);
      expect((await response.json()).data.outcome).toBe("created");
      expect(google.created).toHaveLength(1);
    });

    it("turns a Database Admin away without the write permission, or from another unit", async () => {
      const person = await unlinked("test_google_dbno@millennia21.id", master.unit.id);
      const other = await prismaClient.masterUnit.create({ data: { name: `TEST_GOOGLE_OTHER_${Date.now()}` } });
      try {
        const noWrite = await AdminUserTest.createDatabaseAdmin(master.unit.id, { canWriteEmployeeData: false });
        expect(
          (await TestRequest.post(`/api/admin/employees/${person.employee!.id}/google/provision`, { recovery_email: "a@gmail.com" }, noWrite.accessToken)).status,
        ).toBe(403);

        await AdminUserTest.delete();
        const away = await AdminUserTest.createDatabaseAdmin(other.id);
        expect(
          (await TestRequest.post(`/api/admin/employees/${person.employee!.id}/google/provision`, { recovery_email: "a@gmail.com" }, away.accessToken)).status,
        ).toBe(403);
        expect(google.created).toHaveLength(0);
      } finally {
        await AdminUserTest.delete();
        await prismaClient.masterUnit.delete({ where: { id: other.id } }).catch(() => undefined);
      }
    });

    it("keeps suspend, restore and password work from a Database Admin", async () => {
      const { accessToken: superToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { json } = await create(superToken);
      await AdminUserTest.delete();
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(master.unit.id);
      const base = `/api/admin/employees/${json.data.id}/google`;
      for (const path of ["suspend", "unsuspend", "restore", "reset-password"]) {
        expect((await TestRequest.post(`${base}/${path}`, {}, accessToken)).status).toBe(403);
      }
      expect((await TestRequest.post(`${base}/recovery-email`, { recovery_email: "a@gmail.com" }, accessToken)).status).toBe(403);
      expect((await TestRequest.get(`${base}?refresh=true`, accessToken)).status).toBe(200);
    });

    it("leaves password reset and recovery email to the protected Super Admins", async () => {
      const { accessToken: protectedToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { json } = await create(protectedToken);
      await AdminUserTest.delete();
      const plain = await AdminUserTest.createSuperAdmin(master.unit.id, {
        id: "plain-super-id",
        email: "test_plain_super@millennia21.id",
        plain: true,
      });
      const base = `/api/admin/employees/${json.data.id}/google`;
      expect((await TestRequest.post(`${base}/reset-password`, {}, plain.accessToken)).status).toBe(403);
      expect((await TestRequest.post(`${base}/recovery-email`, { recovery_email: "a@gmail.com" }, plain.accessToken)).status).toBe(403);
      // The rest of the account work stays with any Super Admin.
      expect((await TestRequest.post(`${base}/suspend`, {}, plain.accessToken)).status).toBe(200);
      expect((await TestRequest.post(`${base}/unsuspend`, {}, plain.accessToken)).status).toBe(200);

      await AdminUserTest.delete();
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      expect((await TestRequest.post(`${base}/reset-password`, {}, accessToken)).status).toBe(200);
      expect((await TestRequest.post(`${base}/recovery-email`, { recovery_email: "a@gmail.com" }, accessToken)).status).toBe(200);
    });

    it("tells the page what the admin may do", async () => {
      const { accessToken: superToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { json } = await create(superToken);
      const read = async (token: string) =>
        (await (await TestRequest.get(`/api/admin/employees/${json.data.id}/google`, token)).json()).data.can;
      expect(await read(superToken)).toEqual({ create: true, manage: true, takeover: true });

      await AdminUserTest.delete();
      const db = await AdminUserTest.createDatabaseAdmin(master.unit.id);
      expect(await read(db.accessToken)).toEqual({ create: true, manage: false, takeover: false });

      await AdminUserTest.delete();
      const plain = await AdminUserTest.createSuperAdmin(master.unit.id, { id: "plain-super-id", email: "test_plain_super@millennia21.id", plain: true });
      expect(await read(plain.accessToken)).toEqual({ create: true, manage: true, takeover: false });
    });
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

  describe("people who left", () => {
    beforeEach(() => {
      process.env.GOOGLE_SUSPEND_ON_OFFBOARD = "true";
    });
    afterEach(() => {
      delete process.env.GOOGLE_SUSPEND_ON_OFFBOARD;
    });

    const linked = async (token: string) => {
      const { json } = await create(token);
      const person = await personOf(json.data.id);
      return { id: json.data.id as string, person, user: () => google.users.get(person.google_user_id!)! };
    };
    const resign = (employeeId: string) =>
      prismaClient.employee.update({ where: { id: employeeId }, data: { status: EmployeeStatus.RESIGNED } });
    const fresh = (personId: string) => prismaClient.person.findUniqueOrThrow({ where: { id: personId } });
    const post = (path: string, token: string, body: Record<string, unknown> = {}) =>
      TestRequest.post(path, body, token);

    it("locks the account when the person resigns, and opens it when they are active again", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id, person, user } = await linked(accessToken);

      await resign(id);
      expect(await GoogleWorkspaceService.syncAccess(person.id)).toBe(true);
      expect(user().suspended).toBe(true);
      expect(await fresh(person.id)).toMatchObject({ google_sync_status: GoogleSyncStatus.SUSPENDED, google_suspended_by_central: true });
      expect(await prismaClient.auditLog.count({ where: { action: AuditAction.GOOGLE_ACCOUNT_SUSPEND } })).toBe(1);

      await prismaClient.employee.update({ where: { id }, data: { status: EmployeeStatus.ACTIVE } });
      expect(await GoogleWorkspaceService.syncAccess(person.id)).toBe(true);
      expect(user().suspended).toBe(false);
      expect(await fresh(person.id)).toMatchObject({ google_sync_status: GoogleSyncStatus.ACTIVE, google_suspended_by_central: false });
    });

    it("does nothing while the switch is off, for people on leave, or for accounts it did not lock", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id, person, user } = await linked(accessToken);

      await prismaClient.employee.update({ where: { id }, data: { status: EmployeeStatus.ON_LEAVE } });
      expect(await GoogleWorkspaceService.syncAccess(person.id)).toBe(false);
      await prismaClient.employee.update({ where: { id }, data: { status: EmployeeStatus.INACTIVE } });
      expect(await GoogleWorkspaceService.syncAccess(person.id)).toBe(false);

      await resign(id);
      delete process.env.GOOGLE_SUSPEND_ON_OFFBOARD;
      expect(await GoogleWorkspaceService.syncAccess(person.id)).toBe(false);
      expect(user().suspended).toBe(false);

      process.env.GOOGLE_SUSPEND_ON_OFFBOARD = "true";
      // An account an admin suspended by hand is not opened by Central.
      google.users.set(user().id, { ...user(), suspended: true });
      await prismaClient.person.update({ where: { id: person.id }, data: { google_sync_status: GoogleSyncStatus.SUSPENDED } });
      await prismaClient.employee.update({ where: { id }, data: { status: EmployeeStatus.ACTIVE } });
      expect(await GoogleWorkspaceService.syncAccess(person.id)).toBe(false);
      expect(user().suspended).toBe(true);
    });

    it("locks the account on archive and opens it on restore", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id, person, user } = await linked(accessToken);
      const response = await TestRequest.patch(`/api/admin/employees/delete/${id}`, {}, accessToken);
      expect(response.status).toBe(200);
      expect(user().suspended).toBe(true);

      await prismaClient.employee.update({ where: { id }, data: { deleted_at: null, status: EmployeeStatus.ACTIVE } });
      await GoogleWorkspaceService.syncAccess(person.id);
      expect(user().suspended).toBe(false);
    });

    it("keeps the archive when Google fails", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id, person } = await linked(accessToken);
      google.setSuspended = async () => {
        throw new DirectoryError("FAILED", "down");
      };
      expect((await TestRequest.patch(`/api/admin/employees/delete/${id}`, {}, accessToken)).status).toBe(200);
      expect((await prismaClient.employee.findUniqueOrThrow({ where: { id } })).deleted_at).not.toBeNull();
      expect((await fresh(person.id)).google_last_error).toBeTruthy();
    });

    it("refuses to open, reset or make an account for someone who left", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id, person } = await linked(accessToken);
      await resign(id);
      await GoogleWorkspaceService.syncAccess(person.id);

      for (const path of ["unsuspend", "reset-password", "provision"]) {
        const response = await post(`/api/admin/employees/${id}/google/${path}`, accessToken);
        expect(response.status).toBe(400);
        expect(JSON.stringify(await response.json())).toContain("has left");
      }
      expect((await statusOfLeft(accessToken, id))).toMatchObject({ locked: true, locked_reason: "RESIGNED" });
    });

    it("locks again an account someone turned on in Google, on a check and on the sweep", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id, person, user } = await linked(accessToken);
      await resign(id);
      await GoogleWorkspaceService.syncAccess(person.id);

      google.users.set(user().id, { ...user(), suspended: false });
      await GoogleWorkspaceService.refreshStatus(person.id);
      expect(user().suspended).toBe(true);
      const entries = await prismaClient.auditLog.findMany({ where: { action: AuditAction.GOOGLE_ACCOUNT_SUSPEND } });
      expect(entries.some((entry) => JSON.stringify(entry.new_values).includes("reactivated_in_google"))).toBe(true);

      google.users.set(user().id, { ...user(), suspended: false });
      await GoogleWorkspaceService.refreshAllStatuses();
      expect(user().suspended).toBe(true);
    });

    it("leaves an admin of the Workspace alone", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { id, person, user } = await linked(accessToken);
      google.users.set(user().id, { ...user(), isAdmin: true });
      await resign(id);
      expect(await GoogleWorkspaceService.syncAccess(person.id)).toBe(false);
      expect(user().suspended).toBe(false);
    });

    const statusOfLeft = async (token: string, id: string) =>
      (await (await TestRequest.get(`/api/admin/employees/${id}/google`, token)).json()).data;
  });

  describe("recovery email", () => {
    it("shows it hidden and changes it, without keeping it in Central or the audit log", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { json } = await create(accessToken);
      const id = json.data.id as string;
      const shown = await TestRequest.get(`/api/admin/employees/${id}/google/recovery-email`, accessToken);
      expect((await shown.json()).data.recovery_email).toBe("t***@gmail.com");

      const response = await TestRequest.post(`/api/admin/employees/${id}/google/recovery-email`, { recovery_email: "baru.pribadi@gmail.com" }, accessToken);
      expect(response.status).toBe(200);
      const person = await personOf(id);
      expect(google.users.get(person.google_user_id!)!.recoveryEmail).toBe("baru.pribadi@gmail.com");
      expect(JSON.stringify(person)).not.toContain("baru.pribadi");
      const entries = await prismaClient.auditLog.findMany({ where: { action: AuditAction.GOOGLE_ACCOUNT_UPDATE } });
      expect(JSON.stringify(entries)).not.toContain("baru.pribadi");
      expect(JSON.stringify(entries)).toContain("recovery_email_changed");
    });

    it("refuses a non Super Admin and someone without an account", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { json } = await create(accessToken);
      const id = json.data.id as string;
      const bad = await TestRequest.post(`/api/admin/employees/${id}/google/recovery-email`, { recovery_email: "not an email" }, accessToken);
      expect(bad.status).toBe(400);

      const plain = await AdminUserTest.createDatabaseAdmin(master.unit.id);
      expect((await TestRequest.post(`/api/admin/employees/${id}/google/recovery-email`, { recovery_email: "a@gmail.com" }, plain.accessToken)).status).toBe(403);
      expect((await TestRequest.get(`/api/admin/employees/${id}/google/recovery-email`, plain.accessToken)).status).toBe(403);

      const none = await EmployeeTest.create({
        email: "test_google_norec@millennia21.id",
        unitId: master.unit.id,
        jobPositionId: master.position.id,
        jobLevelId: master.level.id,
        buildingId: master.building.id,
      });
      expect((await TestRequest.post(`/api/admin/employees/${none.employee!.id}/google/recovery-email`, { recovery_email: "a@gmail.com" }, accessToken)).status).toBe(404);
    });

    it("refuses for someone who left", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { json } = await create(accessToken);
      await prismaClient.employee.update({ where: { id: json.data.id }, data: { status: EmployeeStatus.RESIGNED } });
      const response = await TestRequest.post(`/api/admin/employees/${json.data.id}/google/recovery-email`, { recovery_email: "a@gmail.com" }, accessToken);
      expect(response.status).toBe(400);
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
