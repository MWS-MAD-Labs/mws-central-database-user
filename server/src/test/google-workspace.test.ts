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
import {
  DirectoryError,
  type CreateDirectoryUser,
  type DirectoryClient,
  type DirectoryUser,
  type UpdateDirectoryUser,
} from "../lib/google-workspace/directory-client";
import { generateTemporaryPassword, splitName } from "../service/google-workspace-service";
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

  async findUser(userKey: string) {
    return [...this.users.values()].find((user) => user.id === userKey || user.primaryEmail === userKey) ?? null;
  }
  async createUser(input: CreateDirectoryUser) {
    if (this.failCreateWith) throw this.failCreateWith;
    this.created.push(input);
    const user: DirectoryUser = {
      id: `g-${this.created.length}`,
      primaryEmail: input.primaryEmail,
      givenName: input.givenName,
      familyName: input.familyName,
      suspended: false,
      isAdmin: false,
      changePasswordAtNextLogin: true,
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

    expect(google.created).toHaveLength(1);
    expect(google.created[0]).toMatchObject({ givenName: "Rizqi Sabilla", familyName: "Putra", recoveryEmail: "rizqi.pribadi@gmail.com" });
    const person = await personOf(json.data.id);
    expect(person.google_sync_status).toBe(GoogleSyncStatus.ACTIVE);
    expect(person.google_user_id).toBe("g-1");
    // The recovery email went to Google and is nowhere in Central.
    expect(JSON.stringify(person)).not.toContain("rizqi.pribadi@gmail.com");
  });

  it("links the account Google already has instead of making another", async () => {
    google.users.set("existing", {
      id: "existing", primaryEmail: "test_google_existing@millennia21.id", givenName: "A", familyName: "B",
      suspended: false, isAdmin: false, changePasswordAtNextLogin: false,
    });
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const { json } = await create(accessToken, { email: "test_google_existing@millennia21.id" });
    expect(google.created).toHaveLength(0);
    expect((await personOf(json.data.id)).google_user_id).toBe("existing");
  });

  it("keeps the employee and shows a failed status when Google fails", async () => {
    google.failCreateWith = new DirectoryError("DENIED", "Google refused the request (forbidden)");
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const { response, json } = await create(accessToken);
    expect(response.status).toBe(200);
    const person = await personOf(json.data.id);
    expect(person.google_sync_status).toBe(GoogleSyncStatus.FAILED);
    expect(person.google_last_error).toContain("refused");

    // Retry from the status screen once Google works.
    google.failCreateWith = null;
    const retry = await TestRequest.post(`/api/admin/employees/${json.data.id}/google/provision`, {}, accessToken);
    expect(retry.status).toBe(200);
    expect((await personOf(json.data.id)).google_sync_status).toBe(GoogleSyncStatus.ACTIVE);
  });

  it("does not touch a Workspace admin account", async () => {
    google.users.set("boss", {
      id: "boss", primaryEmail: "test_google_boss@millennia21.id", givenName: "A", familyName: "B",
      suspended: false, isAdmin: true, changePasswordAtNextLogin: false,
    });
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const { json } = await create(accessToken, { email: "test_google_boss@millennia21.id" });
    expect((await personOf(json.data.id)).google_sync_status).toBe(GoogleSyncStatus.FAILED);
    expect(google.created).toHaveLength(0);
    expect(google.updated).toHaveLength(0);
  });

  it("outside production, only sends test addresses to a Google that is real", async () => {
    process.env.GOOGLE_WORKSPACE_TEST_PREFIX = "test.central.";
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const { json } = await create(accessToken);
    expect(google.created).toHaveLength(0);
    const person = await personOf(json.data.id);
    expect(person.google_sync_status).toBe(GoogleSyncStatus.NONE);
    // Asked for by hand, it says why.
    const retry = await TestRequest.post(`/api/admin/employees/${json.data.id}/google/provision`, { recovery_email: "me@gmail.com" }, accessToken);
    expect(retry.status).toBe(400);
    expect(JSON.stringify(await retry.json())).toContain("test.central.");
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
