import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  AdminUserTest,
  AuditLogTest,
  EmployeeTest,
  generateEmployeeAccessToken,
  InternTest,
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
import { FakeDirectory } from "./fake-directory";
import {
  DirectoryError,
  type CreateDirectoryUser,
  type DirectoryClient,
  type DirectoryUser,
  type UpdateDirectoryUser,
} from "../lib/google-workspace/directory-client";
import { GoogleWorkspaceService, generateTemporaryPassword, resetCheckCooldownForTests, resetSignInEmailLimitForTests, splitName } from "../service/google-workspace-service";
import { detectImageMimeType } from "../utils/image-processing";
import sharp from "sharp";
import { GoogleAuth } from "../utils/google-auth";

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
    // With email on, a new password is mailed at once and not shown. Most tests read it, so email starts off here.
    const noMail = new MemoryMailer();
    noMail.enabled = false;
    setMailerForTests(noMail);
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
  // The few minutes a new password and a new mail wait for the same person, taken as passed.
  const letTimePass = async (employeeId: string) => {
    const person = await personOf(employeeId);
    resetCheckCooldownForTests();
    const earlier = new Date(Date.now() - 10 * 60_000);
    await prismaClient.person.update({ where: { id: person.id }, data: { google_password_issued_at: earlier } });
    // Checked a minute ago: past the wait, and still fresh enough that the page does not look at Google again by itself.
    await prismaClient.person.update({ where: { id: person.id }, data: { google_checked_at: new Date(Date.now() - 60_000) } });
    await prismaClient.auditLog.updateMany({ where: { entity_id: person.id }, data: { created_at: earlier } });
  };

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

  describe("the wait between the same action for the same person", () => {
    const post = (id: string, path: string, token: string, body: Record<string, unknown> = {}) =>
      TestRequest.post(`/api/admin/employees/${id}/google/${path}`, body, token);
    const statusUrl = (id: string) => `/api/admin/employees/${id}/google`;
    const made = async (token: string) => {
      const { json } = await create(token);
      await letTimePass(json.data.id);
      return json.data.id as string;
    };

    it("does not start the wait when the page looks at Google by itself, only when Check is pressed", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const id = await made(accessToken);
      // The last look is old, so opening the page makes the server look again on its own.
      const person = await personOf(id);
      await prismaClient.person.update({ where: { id: person.id }, data: { google_checked_at: new Date(Date.now() - 10 * 60_000) } });
      const opened = (await (await TestRequest.get(statusUrl(id), accessToken)).json()).data;
      expect(opened.check).toBeUndefined();
      expect(opened.check_available_at).toBeNull();
      expect((await personOf(id)).google_checked_at!.getTime()).toBeGreaterThan(Date.now() - 5000);

      // The first press goes through, the next one is held.
      expect((await TestRequest.get(`${statusUrl(id)}?refresh=true`, accessToken)).status).toBe(200);
      expect((await TestRequest.get(`${statusUrl(id)}?refresh=true`, accessToken)).status).toBe(429);
      // Opening the page again does not extend or restart it.
      const again = (await (await TestRequest.get(statusUrl(id), accessToken)).json()).data;
      expect(Date.parse(again.check_available_at)).toBeGreaterThan(Date.now());
    });

    it("makes Check wait ten seconds, says what it found, and tells the page when it may be pressed again", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const id = await made(accessToken);

      const first = (await (await TestRequest.get(`${statusUrl(id)}?refresh=true`, accessToken)).json()).data;
      expect(first.check).toMatchObject({ outcome: "checked", changes: [] });
      expect(Date.parse(first.check_available_at)).toBeGreaterThan(Date.now());
      expect(first.cooldowns).toEqual({ check: 10, suspend: 30, recovery: 60, password: 120, email: 120 });

      const again = await TestRequest.get(`${statusUrl(id)}?refresh=true`, accessToken);
      expect(again.status).toBe(429);
      expect((await again.json()).errors).toMatch(/Google was checked a moment ago. Wait \d+ more seconds? to check again/);

      // Someone suspended it in Google: the next Check says so.
      const person = await personOf(id);
      google.users.set(person.google_user_id!, { ...google.users.get(person.google_user_id!)!, suspended: true });
      await letTimePass(id);
      const found = (await (await TestRequest.get(`${statusUrl(id)}?refresh=true`, accessToken)).json()).data;
      expect(found.check.changes).toEqual(["Status changed from Linked to Suspended"]);
    });

    it("says honestly when Google is only simulated or cannot be reached", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const id = await made(accessToken);
      const person = await personOf(id);

      setDirectoryClientForTests(new SimulatedDirectoryClient());
      const simulated = (await (await TestRequest.get(`${statusUrl(id)}?refresh=true`, accessToken)).json()).data;
      expect(simulated.check.outcome).toBe("simulated");
      expect(simulated.checked_at).not.toBeNull();
      expect(simulated.check_available_at).not.toBeNull();

      setDirectoryClientForTests(google);
      await letTimePass(id);
      google.findUser = async () => {
        throw new Error("network down");
      };
      const down = (await (await TestRequest.get(`${statusUrl(id)}?refresh=true`, accessToken)).json()).data;
      expect(down.check.outcome).toBe("unreachable");
      expect(down.status).toBe(person.google_sync_status);
    });

    it("makes Suspend and Unsuspend wait thirty seconds", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const id = await made(accessToken);
      expect((await post(id, "suspend", accessToken)).status).toBe(200);
      const quick = await post(id, "unsuspend", accessToken);
      expect(quick.status).toBe(429);
      expect((await quick.json()).errors).toMatch(/suspended or unsuspended a moment ago. Wait \d+ more seconds?/);
      expect(Date.parse((await (await TestRequest.get(statusUrl(id), accessToken)).json()).data.suspend_available_at)).toBeGreaterThan(Date.now());

      await letTimePass(id);
      expect((await post(id, "unsuspend", accessToken)).status).toBe(200);
    });

    it("makes changing the recovery email wait a minute, and only counts that, not other updates", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const id = await made(accessToken);
      expect((await post(id, "recovery-email", accessToken, { recovery_email: "satu@gmail.com" })).status).toBe(200);
      const quick = await post(id, "recovery-email", accessToken, { recovery_email: "dua@gmail.com" });
      expect(quick.status).toBe(429);
      expect((await quick.json()).errors).toMatch(/recovery email was changed a moment ago. Wait \d+ more seconds?/);
      expect(google.users.get((await personOf(id)).google_user_id!)!.recoveryEmail).toBe("satu@gmail.com");

      await letTimePass(id);
      expect((await post(id, "recovery-email", accessToken, { recovery_email: "dua@gmail.com" })).status).toBe(200);
    });

    it("remembers the wait after a restart, because it is read from the audit log", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const id = await made(accessToken);
      expect((await post(id, "suspend", accessToken)).status).toBe(200);
      // A new process has no memory; the audit entry is what is left.
      expect(await prismaClient.auditLog.count({ where: { action: AuditAction.GOOGLE_ACCOUNT_SUSPEND, entity_id: (await personOf(id)).id } })).toBe(1);
      expect((await post(id, "unsuspend", accessToken)).status).toBe(429);
    });
  });

  describe("a protected admin as an employee", () => {
    const PROTECTED_EMAIL = "test_superadmin@millennia21.id";

    it("says a protected address is fine to save, without Google", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const response = await TestRequest.get(`/api/admin/google/email-availability?email=${encodeURIComponent(PROTECTED_EMAIL)}`, accessToken);
      expect((await response.json()).data).toMatchObject({ available: true, reason: "PROTECTED" });
    });

    it("creates the employee with no recovery email and no Google account, and links the admin to it", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { response, json } = await create(accessToken, { email: PROTECTED_EMAIL });
      expect(response.status).toBe(200);
      expect(json.data.google).toBeUndefined();
      expect(google.created).toHaveLength(0);
      expect((await personOf(json.data.id)).google_user_id).toBeNull();

      const admin = await prismaClient.adminUser.findFirstOrThrow({ where: { email: PROTECTED_EMAIL } });
      expect(admin.person_id).toBe((await personOf(json.data.id)).id);
    });

    it("links the Google account of the admin who makes their own record, without changing it", async () => {
      // Outside production only addresses with the test prefix reach Google, like for everyone.
      process.env.GOOGLE_WORKSPACE_TEST_PREFIX = "test_super";
      google.users.set("own-1", {
        id: "own-1", primaryEmail: PROTECTED_EMAIL, givenName: "Super", familyName: "Admin",
        suspended: false, isAdmin: true, changePasswordAtNextLogin: false, lastLoginTime: null,
      });
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { response, json } = await create(accessToken, { email: PROTECTED_EMAIL });
      expect(response.status).toBe(200);
      expect(json.data.google).toMatchObject({ status: "ACTIVE", outcome: "linked" });
      expect(await personOf(json.data.id)).toMatchObject({ google_user_id: "own-1", google_keeps_name: true });
      expect(google.created).toHaveLength(0);
      expect(google.updated).toHaveLength(0);
      expect(google.passwords).toHaveLength(0);
    });

    it("does not link it when somebody else makes the record", async () => {
      google.users.set("own-1", {
        id: "own-1", primaryEmail: PROTECTED_EMAIL, givenName: "Super", familyName: "Admin",
        suspended: false, isAdmin: true, changePasswordAtNextLogin: false, lastLoginTime: null,
      });
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const other = await prismaClient.adminUser.findFirstOrThrow({ where: { email: PROTECTED_EMAIL } });
      await prismaClient.adminUser.update({ where: { id: other.id }, data: { email: "test_other_admin@millennia21.id" } });
      const before = process.env.PROTECTED_SUPER_ADMIN_EMAILS;
      process.env.PROTECTED_SUPER_ADMIN_EMAILS = `${before ?? ""},${PROTECTED_EMAIL}`;
      try {
        const { response, json } = await create(accessToken, { email: PROTECTED_EMAIL });
        expect(response.status).toBe(200);
        expect(json.data.google).toBeUndefined();
        expect((await personOf(json.data.id)).google_user_id).toBeNull();
      } finally {
        process.env.PROTECTED_SUPER_ADMIN_EMAILS = before;
      }
    });

    it("links the account when the protected admin signs in, whoever made the record, and does not for anyone else", async () => {
      process.env.GOOGLE_WORKSPACE_TEST_PREFIX = "test_super";
      google.users.set("own-1", {
        id: "own-1", primaryEmail: PROTECTED_EMAIL, givenName: "Super", familyName: "Admin",
        suspended: false, isAdmin: true, changePasswordAtNextLogin: false, lastLoginTime: null,
      });
      await AdminUserTest.createSuperAdmin(master.unit.id);
      await EmployeeTest.create({
        email: PROTECTED_EMAIL,
        unitId: master.unit.id,
        jobPositionId: master.position.id,
        jobLevelId: master.level.id,
        buildingId: master.building.id,
      });
      expect((await prismaClient.person.findFirstOrThrow({ where: { email: PROTECTED_EMAIL } })).google_user_id).toBeNull();

      const spy = spyOn(GoogleAuth, "verifyCode").mockResolvedValue({
        google_id: "x", email: "test_google_lain@millennia21.id", name: "Lain", avatar_url: "",
      });
      await TestRequest.post("/api/auth/google", { code: "X" });
      expect((await prismaClient.person.findFirstOrThrow({ where: { email: PROTECTED_EMAIL } })).google_user_id).toBeNull();

      spy.mockResolvedValue({ google_id: "own-1", email: PROTECTED_EMAIL, name: "Super Admin", avatar_url: "" });
      await TestRequest.post("/api/auth/google", { code: "X" });
      spy.mockRestore();
      const person = await prismaClient.person.findFirstOrThrow({ where: { email: PROTECTED_EMAIL } });
      expect(person).toMatchObject({ google_user_id: "own-1", google_sync_status: GoogleSyncStatus.ACTIVE });
      expect(google.created).toHaveLength(0);
      expect(google.updated).toHaveLength(0);
      expect(google.passwords).toHaveLength(0);
    });

    it("says why a protected admin that is not linked yet is not looked up", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { json } = await create(accessToken, { email: PROTECTED_EMAIL });
      const status = await TestRequest.get(`/api/admin/employees/${json.data.id}/google`, accessToken);
      expect((await status.json()).data.lookup).toMatchObject({ state: "blocked", message: expect.stringContaining("linked when its owner signs in") });
    });

    it("does not make a Google account even when a recovery email is sent for it", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { response, json } = await create(accessToken, { email: PROTECTED_EMAIL, recovery_email: "rizqi.pribadi@gmail.com" });
      expect(response.status).toBe(200);
      expect(json.data.google).toBeUndefined();
      expect(google.created).toHaveLength(0);
    });

    it("still asks for a recovery email for everyone else", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const response = await TestRequest.post("/api/admin/employees", body({ recovery_email: undefined }), accessToken);
      expect(response.status).toBe(400);
    });
  });

  describe("the password is mailed at once", () => {
    let mailer: MemoryMailer;
    beforeEach(() => {
      mailer = new MemoryMailer();
      setMailerForTests(mailer);
      resetSignInEmailLimitForTests();
      resetCheckCooldownForTests();
    });
    afterEach(() => setMailerForTests(null));

    it("sends a new employee's first password to the recovery email and does not give it to the admin", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { response, json } = await create(accessToken, { recovery_email: "rizqi.pribadi@gmail.com" });
      expect(response.status).toBe(200);
      expect(json.data.google).toMatchObject({ status: "ACTIVE", outcome: "created", delivered_to: "r***@gmail.com" });
      expect(json.data.google.temporary_password).toBeUndefined();
      expect(mailer.outbox).toHaveLength(1);
      expect(mailer.outbox[0].to).toBe("rizqi.pribadi@gmail.com");
      expect(mailer.outbox[0].text).toContain(google.created[0].password);
      expect(JSON.stringify(await prismaClient.auditLog.findMany())).not.toContain(google.created[0].password);
    });

    it("shows the password to the admin instead when the mail cannot be sent", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      mailer.send = async () => {
        throw new Error("smtp down");
      };
      const { json } = await create(accessToken, { recovery_email: "rizqi.pribadi@gmail.com" });
      expect(json.data.google).toMatchObject({ status: "ACTIVE", outcome: "created" });
      expect(json.data.google.temporary_password).toBe(google.created[0].password);
      expect(json.data.google.delivered_to).toBeUndefined();
    });

    it("says why the password is shown instead: email off, nobody to send to, a limit, or a failed mail", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const notSent = async () => (await create(accessToken, { recovery_email: "rizqi.pribadi@gmail.com" })).json.data.google.not_sent;

      mailer.enabled = false;
      expect(await notSent()).toBe("EMAIL_OFF");
      mailer.enabled = true;

      const send = mailer.send.bind(mailer);
      mailer.send = async () => {
        throw new Error("smtp down");
      };
      expect(await notSent()).toBe("FAILED");
      mailer.send = send;

      // A second mail for the same person right after the first waits, which is the same answer as the hourly limit.
      const { json } = await create(accessToken, { recovery_email: "rizqi.pribadi@gmail.com" });
      expect(json.data.google.delivered_to).toBe("r***@gmail.com");
      const admin = await prismaClient.adminUser.findFirstOrThrow({ where: { email: "test_superadmin@millennia21.id" } });
      const again = await GoogleWorkspaceService.deliverPassword(json.data.id ? (await personOf(json.data.id)).id : "", { to: "rizqi.pribadi@gmail.com", password: "Abcdefgh12345678" }, admin);
      expect(again).toEqual({ not_sent: "LIMIT" });
    });

    it("says there is nobody to send a reset to when Google holds no recovery email", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      mailer.enabled = false;
      const { json } = await create(accessToken, { recovery_email: "rizqi.pribadi@gmail.com" });
      mailer.enabled = true;
      const person = await personOf(json.data.id);
      google.users.set(person.google_user_id!, { ...google.users.get(person.google_user_id!)!, recoveryEmail: null });
      await letTimePass(json.data.id);
      const response = await TestRequest.post(`/api/admin/employees/${json.data.id}/google/reset-password`, {}, accessToken);
      expect((await response.json()).data).toMatchObject({ not_sent: "NO_RECIPIENT" });
    });

    it("tells the page whether the first details were ever mailed", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const sentStatus = async (id: string) =>
        (await (await TestRequest.get(`/api/admin/employees/${id}/google`, accessToken)).json()).data.details_sent;

      const mailed = await create(accessToken, { recovery_email: "rizqi.pribadi@gmail.com" });
      expect(await sentStatus(mailed.json.data.id)).toBe(true);

      mailer.enabled = false;
      const notMailed = await create(accessToken, { recovery_email: "rizqi.pribadi@gmail.com" });
      mailer.enabled = true;
      expect(await sentStatus(notMailed.json.data.id)).toBe(false);
    });

    it("mails a reset password to the recovery email Google holds, and shows it only when it cannot", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      mailer.enabled = false;
      const { json } = await create(accessToken, { recovery_email: "rizqi.pribadi@gmail.com" });
      mailer.enabled = true;
      await letTimePass(json.data.id);

      const sent = await TestRequest.post(`/api/admin/employees/${json.data.id}/google/reset-password`, {}, accessToken);
      expect(sent.status).toBe(200);
      expect((await sent.json()).data).toEqual({ sent_to: "r***@gmail.com" });
      expect(mailer.outbox).toHaveLength(1);
      expect(mailer.outbox[0].to).toBe("rizqi.pribadi@gmail.com");
      expect(mailer.outbox[0].subject).toContain("direset");
      expect(mailer.outbox[0].text).toContain(google.passwords[0].password);

      await letTimePass(json.data.id);
      mailer.enabled = false;
      const shown = await TestRequest.post(`/api/admin/employees/${json.data.id}/google/reset-password`, {}, accessToken);
      expect((await shown.json()).data).toEqual({ password: google.passwords[1].password, not_sent: "EMAIL_OFF" });
    });
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
      // Made with email off, so the password comes back to be sent by hand in these tests.
      mailer.enabled = false;
      const { json } = await create(token, { recovery_email: "pribadi.owner@gmail.com" });
      mailer.enabled = true;
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

    it("sends to the recovery email Google holds when no address is given, without the browser ever having it", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const account = await made(accessToken);
      const response = await TestRequest.post(
        `/api/admin/employees/${account.id}/google/send-sign-in`,
        { language: "id", password: account.password },
        accessToken,
      );
      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).not.toContain("pribadi.owner");
      expect(mailer.outbox).toHaveLength(1);
      expect(mailer.outbox[0].to).toBe("pribadi.owner@gmail.com");
      const entries = await prismaClient.auditLog.findMany({ where: { action: AuditAction.GOOGLE_SIGNIN_EMAILED } });
      expect(JSON.stringify(entries)).not.toContain("pribadi.owner@gmail.com");
    });

    it("says so, and sends nothing, when Google has no recovery email and no address was given", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const account = await made(accessToken);
      const person = await personOf(account.id);
      google.users.set(person.google_user_id!, { ...google.users.get(person.google_user_id!)!, recoveryEmail: null });
      const response = await TestRequest.post(
        `/api/admin/employees/${account.id}/google/send-sign-in`,
        { language: "id", password: account.password },
        accessToken,
      );
      expect(response.status).toBe(409);
      expect((await response.json()).errors).toContain("no recovery email");
      expect(mailer.outbox).toHaveLength(0);
      // An address typed by the admin still works.
      expect((await send(account.id, accessToken, { password: account.password })).status).toBe(200);
    });

    it("makes the same person wait a few minutes between mails, and between new passwords, saying for how long", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const account = await made(accessToken);
      const base = `/api/admin/employees/${account.id}/google`;

      // A password was just made with the account, so another cannot be made yet.
      const tooSoon = await TestRequest.post(`${base}/reset-password`, {}, accessToken);
      expect(tooSoon.status).toBe(429);
      expect((await tooSoon.json()).errors).toMatch(/Wait \d+ more (seconds?|minutes) to make another/);

      expect((await send(account.id, accessToken, { password: account.password })).status).toBe(200);
      const again = await send(account.id, accessToken, { password: account.password });
      expect(again.status).toBe(429);
      expect((await again.json()).errors).toMatch(/Wait .* to send them again/);
      expect(mailer.outbox).toHaveLength(1);

      // The page is told when each is allowed again, so it can keep the buttons off.
      const status = (await (await TestRequest.get(base, accessToken)).json()).data;
      expect(Date.parse(status.password_available_at)).toBeGreaterThan(Date.now());
      expect(Date.parse(status.email_available_at)).toBeGreaterThan(Date.now());

      await letTimePass(account.id);
      expect((await send(account.id, accessToken, { password: account.password })).status).toBe(200);
      const after = (await (await TestRequest.get(base, accessToken)).json()).data;
      expect(after.password_available_at).toBeNull();
      expect(after.email_available_at).not.toBeNull();
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
        await letTimePass(account.id);
        await prismaClient.person.update({ where: { id: (await personOf(account.id)).id }, data: { google_password_issued_at: new Date(Date.now() - 60_000) } });
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

  it("tells an archived person's email from an active one when it is checked", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const person = await EmployeeTest.create({
      email: "test_google_arsip@millennia21.id",
      unitId: master.unit.id,
      jobPositionId: master.position.id,
      jobLevelId: master.level.id,
      buildingId: master.building.id,
    });
    const check = async () =>
      (await (await TestRequest.get("/api/admin/google/email-availability?email=test_google_arsip@millennia21.id", accessToken)).json()).data;
    expect(await check()).toMatchObject({ available: false, reason: "IN_CENTRAL", message: "This email is already used in Central" });
    await prismaClient.employee.update({ where: { id: person.employee!.id }, data: { status: EmployeeStatus.ARCHIVED } });
    expect(await check()).toMatchObject({ available: false, reason: "IN_CENTRAL", message: "Used by an archived person. Restore them instead" });
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
      await letTimePass(json.data.id);
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
      await letTimePass(json.data.id);
      expect((await TestRequest.post(`${base}/unsuspend`, {}, plain.accessToken)).status).toBe(200);

      await AdminUserTest.delete();
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      await letTimePass(json.data.id);
      expect((await TestRequest.post(`${base}/reset-password`, {}, accessToken)).status).toBe(200);
      expect((await TestRequest.post(`${base}/recovery-email`, { recovery_email: "a@gmail.com" }, accessToken)).status).toBe(200);
    });

    it("tells the page what the admin may do", async () => {
      const { accessToken: superToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { json } = await create(superToken);
      const read = async (token: string) =>
        (await (await TestRequest.get(`/api/admin/employees/${json.data.id}/google`, token)).json()).data.can;
      expect(await read(superToken)).toEqual({ create: true, link_existing: true, manage: true, takeover: true });

      await AdminUserTest.delete();
      const db = await AdminUserTest.createDatabaseAdmin(master.unit.id);
      expect(await read(db.accessToken)).toEqual({ create: true, link_existing: true, manage: false, takeover: false });

      await AdminUserTest.delete();
      const plain = await AdminUserTest.createSuperAdmin(master.unit.id, { id: "plain-super-id", email: "test_plain_super@millennia21.id", plain: true });
      expect(await read(plain.accessToken)).toEqual({ create: true, link_existing: true, manage: true, takeover: false });
    });
  });

  describe("reset password", () => {
    it("gives a Super Admin a new password once, and keeps it out of the audit log", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { json } = await create(accessToken);
      await letTimePass(json.data.id);
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
    const statusOf = async (token: string, id: string, refresh = false) => {
      // Pressing Check waits a few seconds for the same person; these tests press it as often as they like.
      if (refresh) await letTimePass(id);
      return (await (await TestRequest.get(`/api/admin/employees/${id}/google${refresh ? "?refresh=true" : ""}`, token)).json()).data;
    };

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

      await letTimePass(id);
      expect((await TestRequest.post(`/api/admin/employees/${id}/google/unsuspend`, {}, accessToken)).status).toBe(200);
      expect(google.users.get(user.id)!.suspended).toBe(false);
      expect(await statusOf(accessToken, id)).toMatchObject({ status: GoogleSyncStatus.ACTIVE });

      await letTimePass(id);
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

      await letTimePass(id);
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

    describe("hint and adding one", () => {
      const withoutRecovery = async (token: string) => {
        const { json } = await create(token);
        const person = await personOf(json.data.id);
        google.users.set(person.google_user_id!, { ...google.users.get(person.google_user_id!)!, recoveryEmail: null });
        return { id: json.data.id as string, googleId: person.google_user_id! };
      };

      it("gives the admin who may create the account only a hidden hint, or null", async () => {
        const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
        const { json } = await create(accessToken, { recovery_email: "rizqi.pribadi@gmail.com" });
        await AdminUserTest.delete();
        const dbAdmin = await AdminUserTest.createDatabaseAdmin(master.unit.id);
        const hint = await TestRequest.get(`/api/admin/employees/${json.data.id}/google/recovery-hint`, dbAdmin.accessToken);
        expect(hint.status).toBe(200);
        expect(hint.headers.get("cache-control")).toBe("no-store");
        expect((await hint.json()).data).toEqual({ hint: "r***@gmail.com" });
      });

      it("returns null when the account has none, and turns away an admin who may not create", async () => {
        const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
        const none = await withoutRecovery(accessToken);
        expect((await (await TestRequest.get(`/api/admin/employees/${none.id}/google/recovery-hint`, accessToken)).json()).data).toEqual({ hint: null });
        await AdminUserTest.delete();
        const noWrite = await AdminUserTest.createDatabaseAdmin(master.unit.id, { canWriteEmployeeData: false });
        expect((await TestRequest.get(`/api/admin/employees/${none.id}/google/recovery-hint`, noWrite.accessToken)).status).toBe(403);
      });

      it("lets whoever may create the account add one when it is empty, but not replace one that is there", async () => {
        const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
        const none = await withoutRecovery(accessToken);
        await AdminUserTest.delete();
        const dbAdmin = await AdminUserTest.createDatabaseAdmin(master.unit.id);
        const url = `/api/admin/employees/${none.id}/google/recovery-email`;
        expect((await TestRequest.post(url, { recovery_email: "baru.pribadi@gmail.com" }, dbAdmin.accessToken)).status).toBe(200);
        expect(google.users.get(none.googleId)!.recoveryEmail).toBe("baru.pribadi@gmail.com");
        const entries = await prismaClient.auditLog.findMany({ where: { action: AuditAction.GOOGLE_ACCOUNT_UPDATE } });
        expect(JSON.stringify(entries)).toContain("recovery_email_set");
        expect(JSON.stringify(entries)).not.toContain("baru.pribadi");

        // Now there is one: replacing it is for the protected Super Admins only.
        await letTimePass(none.id);
        const second = await TestRequest.post(url, { recovery_email: "lain@gmail.com" }, dbAdmin.accessToken);
        expect(second.status).toBe(403);
        expect(google.users.get(none.googleId)!.recoveryEmail).toBe("baru.pribadi@gmail.com");
        await AdminUserTest.delete();
        const protectedAdmin = await AdminUserTest.createSuperAdmin(master.unit.id);
        await letTimePass(none.id);
        expect((await TestRequest.post(url, { recovery_email: "lain@gmail.com" }, protectedAdmin.accessToken)).status).toBe(200);
        expect(google.users.get(none.googleId)!.recoveryEmail).toBe("lain@gmail.com");
      });

      it("refuses the account's own address as the one to add", async () => {
        const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
        const none = await withoutRecovery(accessToken);
        const own = (await personOf(none.id)).email;
        await AdminUserTest.delete();
        const dbAdmin = await AdminUserTest.createDatabaseAdmin(master.unit.id);
        expect((await TestRequest.post(`/api/admin/employees/${none.id}/google/recovery-email`, { recovery_email: own }, dbAdmin.accessToken)).status).toBe(400);
      });
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

  describe("an email Google already has", () => {
    const existing = (email: string) =>
      google.users.set("old-1", {
        id: "old-1", primaryEmail: email, givenName: "Lama", familyName: "Sekali",
        suspended: false, isAdmin: false, changePasswordAtNextLogin: false, lastLoginTime: null,
      });

    it("is refused for a new employee unless a Super Admin chooses to wait for the owner to sign in", async () => {
      existing("test_google_lama@millennia21.id");
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const refused = await create(accessToken, { email: "test_google_lama@millennia21.id", recovery_email: "lama@gmail.com" });
      expect(refused.response.status).toBe(400);

      const { response, json } = await create(accessToken, { email: "test_google_lama@millennia21.id", claim_existing_google: true });
      expect(response.status).toBe(200);
      expect(json.data.google).toMatchObject({ status: "PENDING_CLAIM", outcome: "waiting" });
      expect(google.created).toHaveLength(0);
      const person = await personOf(json.data.id);
      expect(person.google_sync_status).toBe(GoogleSyncStatus.PENDING_CLAIM);
      expect(person.google_user_id).toBeNull();
    });

    it("is not claimable by a Database Admin, nor when Google has no such account", async () => {
      existing("test_google_lama@millennia21.id");
      const dba = await AdminUserTest.createDatabaseAdmin(master.unit.id);
      const denied = await create(dba.accessToken, { email: "test_google_lama@millennia21.id", claim_existing_google: true });
      expect(denied.response.status).toBe(403);

      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const empty = await create(accessToken, { email: "test_google_nobody@millennia21.id", claim_existing_google: true });
      expect(empty.response.status).toBe(400);
    });

    it("is linked only when its owner signs in, and no admin action can link it before that", async () => {
      existing("test_google_lama@millennia21.id");
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { json } = await create(accessToken, { email: "test_google_lama@millennia21.id", claim_existing_google: true });
      const id = json.data.id as string;
      const person = await personOf(id);

      // Not by the admin: the bulk link skips it and provision refuses it.
      const linked = await GoogleWorkspaceService.linkExisting({ link: true });
      expect(linked.matches.find((match) => match.person_id === person.id)).toBeUndefined();
      expect((await TestRequest.post(`/api/admin/employees/${id}/google/provision`, {}, accessToken)).status).toBe(400);
      expect((await personOf(id)).google_user_id).toBeNull();

      // Someone else signing in does not claim it.
      const spy = spyOn(GoogleAuth, "verifyCode").mockResolvedValue({
        google_id: "g-1", email: "test_google_lain@millennia21.id", name: "Lain", avatar_url: "",
      });
      await TestRequest.post("/api/auth/google", { code: "X" });
      expect((await personOf(id)).google_sync_status).toBe(GoogleSyncStatus.PENDING_CLAIM);

      // The owner does.
      spy.mockResolvedValue({ google_id: "old-1", email: "test_google_lama@millennia21.id", name: "Lama", avatar_url: "" });
      await TestRequest.post("/api/auth/google", { code: "X" });
      spy.mockRestore();
      const after = await personOf(id);
      expect(after).toMatchObject({ google_sync_status: GoogleSyncStatus.ACTIVE, google_user_id: "old-1" });
      expect(google.created).toHaveLength(0);
      expect(google.passwords).toHaveLength(0);
    });
  });

  describe("an account that waits for its owner", () => {
    let mailer: MemoryMailer;
    beforeEach(() => {
      mailer = new MemoryMailer();
      setMailerForTests(mailer);
      resetSignInEmailLimitForTests();
      resetCheckCooldownForTests();
    });
    afterEach(() => setMailerForTests(null));

    const waiting = async (token: string, userOver: Record<string, unknown> = {}) => {
      google.users.set("old-1", {
        id: "old-1", primaryEmail: "test_google_lama@millennia21.id", givenName: "Rizqi Sabilla", familyName: "Putra",
        suspended: false, isAdmin: false, changePasswordAtNextLogin: false, lastLoginTime: null,
        recoveryEmail: "lama.pribadi@gmail.com", ...userOver,
      } as DirectoryUser);
      const { json } = await create(token, { email: "test_google_lama@millennia21.id", claim_existing_google: true });
      return json.data.id as string;
    };
    const reset = (id: string, token: string) => TestRequest.post(`/api/admin/employees/${id}/google/reset-waiting`, { language: "id" }, token);

    it("gets a new password mailed to the recovery email Google holds, never shown and never sent to its own mailbox", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const id = await waiting(accessToken);
      const response = await reset(id, accessToken);
      expect(response.status).toBe(200);
      const data = (await response.json()).data;
      expect(data).toEqual({ sent_to: "l***@gmail.com" });
      expect(google.passwords).toHaveLength(1);
      expect(mailer.outbox).toHaveLength(1);
      expect(mailer.outbox[0].to).toBe("lama.pribadi@gmail.com");
      expect(mailer.outbox[0].text).toContain(google.passwords[0].password);
      expect(JSON.stringify(await prismaClient.auditLog.findMany())).not.toContain(google.passwords[0].password);
      // Still waiting: only signing in links it.
      expect((await personOf(id)).google_sync_status).toBe(GoogleSyncStatus.PENDING_CLAIM);
    });

    it("is left alone when the name in Google is not the name here, has no recovery email, or email is off", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const id = await waiting(accessToken, { givenName: "Orang", familyName: "Lain" });
      expect((await reset(id, accessToken)).status).toBe(409);
      google.users.set("old-1", { ...google.users.get("old-1")!, givenName: "Rizqi Sabilla", familyName: "Putra", recoveryEmail: null });
      expect((await reset(id, accessToken)).status).toBe(409);
      google.users.set("old-1", { ...google.users.get("old-1")!, recoveryEmail: "lama.pribadi@gmail.com" });
      mailer.enabled = false;
      expect((await reset(id, accessToken)).status).toBe(503);
      expect(google.passwords).toHaveLength(0);
      expect(mailer.outbox).toHaveLength(0);
    });

    it("is not reset by a Database Admin, by a second press in the wait, or when the account is not waiting", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const id = await waiting(accessToken);
      const dba = await AdminUserTest.createDatabaseAdmin(master.unit.id);
      expect((await reset(id, dba.accessToken)).status).toBe(403);
      expect((await reset(id, accessToken)).status).toBe(200);
      expect((await reset(id, accessToken)).status).toBe(429);

      const { json } = await create(accessToken, { recovery_email: "biasa@gmail.com" });
      expect((await reset(json.data.id, accessToken)).status).toBe(400);
    });

    it("keeps the name Google has once claimed, while the email still follows Central", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const id = await waiting(accessToken, { givenName: "Nama", familyName: "Lama" });
      const spy = spyOn(GoogleAuth, "verifyCode").mockResolvedValue({
        google_id: "old-1", email: "test_google_lama@millennia21.id", name: "Nama Lama", avatar_url: "",
      });
      await TestRequest.post("/api/auth/google", { code: "X" });
      spy.mockRestore();
      expect((await personOf(id)).google_keeps_name).toBe(true);

      await GoogleWorkspaceService.syncProfile((await personOf(id)).id);
      expect(google.users.get("old-1")).toMatchObject({ givenName: "Nama", familyName: "Lama" });

      // A person made the usual way still has the name Central holds.
      const { json } = await create(accessToken, { recovery_email: "biasa@gmail.com" });
      await GoogleWorkspaceService.syncProfile((await personOf(json.data.id)).id);
      expect([...google.users.values()].find((user) => user.primaryEmail.startsWith("test_google_") && user.givenName === "Rizqi Sabilla")).toBeTruthy();
    });
  });

  describe("an intern", () => {
    const internBody = (over: Record<string, unknown> = {}) => ({
      full_name: "Intan Magang",
      nick_name: "Intan",
      email: "test_google_test_intern_a@millennia21.id",
      gender: Gender.FEMALE,
      religion: Religion.ISLAM,
      unit_id: master.unit.id,
      job_position_id: master.position.id,
      building_id: master.building.id,
      join_date: new Date("2026-07-01").toISOString(),
      end_date: new Date("2026-12-31").toISOString(),
      ...over,
    });
    const make = (token: string, over: Record<string, unknown> = {}) =>
      TestRequest.postRaw("/api/admin/interns", internBody(over), token);
    const existing = (email: string) =>
      google.users.set("old-i", {
        id: "old-i", primaryEmail: email, givenName: "Intan", familyName: "Magang",
        suspended: false, isAdmin: false, changePasswordAtNextLogin: false, lastLoginTime: null,
      });
    afterEach(async () => {
      await InternTest.delete();
    });

    it("waits for its owner when a Super Admin chooses so for an email Google already has, and is linked at sign-in", async () => {
      existing("test_google_test_intern_a@millennia21.id");
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      expect((await make(accessToken, { recovery_email: "intan@gmail.com" })).status).toBe(400);

      const dba = await AdminUserTest.createDatabaseAdmin(master.unit.id);
      expect((await make(dba.accessToken, { claim_existing_google: true })).status).toBe(403);

      const response = await make(accessToken, { claim_existing_google: true });
      expect(response.status).toBe(200);
      expect((await response.json()).data.google).toMatchObject({ status: "PENDING_CLAIM", outcome: "waiting" });
      expect(google.created).toHaveLength(0);

      const spy = spyOn(GoogleAuth, "verifyCode").mockResolvedValue({
        google_id: "old-i", email: "test_google_test_intern_a@millennia21.id", name: "Intan Magang", avatar_url: "",
      });
      await TestRequest.post("/api/auth/google", { code: "X" });
      spy.mockRestore();
      const person = await prismaClient.person.findFirstOrThrow({ where: { email: "test_google_test_intern_a@millennia21.id" } });
      expect(person).toMatchObject({ google_sync_status: GoogleSyncStatus.ACTIVE, google_user_id: "old-i", google_keeps_name: true });
    });

    it("is saved with no recovery email for a protected address, and linked when the admin makes their own", async () => {
      process.env.GOOGLE_WORKSPACE_TEST_PREFIX = "test_super";
      google.users.set("own-1", {
        id: "own-1", primaryEmail: "test_superadmin@millennia21.id", givenName: "Super", familyName: "Admin",
        suspended: false, isAdmin: true, changePasswordAtNextLogin: false, lastLoginTime: null,
      });
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const response = await make(accessToken, { email: "test_superadmin@millennia21.id" });
      expect(response.status).toBe(200);
      expect((await response.json()).data.google).toMatchObject({ status: "ACTIVE", outcome: "linked" });
      expect(google.created).toHaveLength(0);
      expect(google.passwords).toHaveLength(0);
      const intern = await prismaClient.intern.findFirstOrThrow({ where: { person: { email: "test_superadmin@millennia21.id" } } });
      await prismaClient.internMutationHistory.deleteMany({ where: { intern_id: intern.id } });
      await prismaClient.intern.delete({ where: { id: intern.id } });
      await prismaClient.person.delete({ where: { id: intern.person_id } });
    });
  });

  it("detects the formats it accepts", async () => {
    expect(detectImageMimeType(await sharp({ create: { width: 2, height: 2, channels: 3, background: "#000" } }).png().toBuffer())).toBe("image/png");
  });
});
