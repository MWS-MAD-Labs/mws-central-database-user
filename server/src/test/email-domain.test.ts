import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { assertDomainCanReceiveEmail, setEmailDomainResolverForTests, type DomainAnswer } from "../utils/email-domain";
import { AdminUserTest, AuditLogTest, EmployeeTest, MasterDataTest, TestRequest } from "./test-utils";
import { Gender, Religion, EmploymentType, EmployeeStatus, MaritalStatus } from "../generated/prisma/client";
import { setMailerForTests, MemoryMailer } from "../lib/mailer";
import { setDirectoryClientForTests } from "../lib/google-workspace";
import { FakeDirectory } from "./fake-directory";

describe("the domain of an email that is not ours", () => {
  const answers = new Map<string, DomainAnswer>([["gmail.com", "yes"], ["gmial.com", "no"], ["slow.example", "unknown"]]);
  let calls = 0;
  beforeEach(() => {
    calls = 0;
    setEmailDomainResolverForTests(async (domain) => {
      calls += 1;
      return answers.get(domain) ?? "yes";
    });
  });
  afterEach(() => setEmailDomainResolverForTests(null));

  it("is refused when it certainly cannot receive mail, and let through when it can or nobody knows", async () => {
    await expect(assertDomainCanReceiveEmail("budi@gmial.com")).rejects.toThrow("cannot receive email");
    await expect(assertDomainCanReceiveEmail("budi@gmail.com")).resolves.toBeUndefined();
    await expect(assertDomainCanReceiveEmail("budi@slow.example")).resolves.toBeUndefined();
  });

  it("asks once per domain for a while", async () => {
    await assertDomainCanReceiveEmail("a@gmail.com");
    await assertDomainCanReceiveEmail("b@gmail.com");
    expect(calls).toBe(1);
  });

  describe("on the forms", () => {
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
      process.env.GOOGLE_WORKSPACE_TEST_PREFIX = "test_google";
      const off = new MemoryMailer();
      off.enabled = false;
      setMailerForTests(off);
    });
    afterEach(async () => {
      delete process.env.GOOGLE_WORKSPACE_TEST_PREFIX;
      setDirectoryClientForTests(null);
      setMailerForTests(null);
      await AuditLogTest.delete();
      await AdminUserTest.delete();
      await EmployeeTest.delete();
      await MasterDataTest.delete();
    });

    const employee = (over: Record<string, unknown> = {}) => ({
      full_name: "Rizqi Sabilla Putra", nick_name: "Rizqi", email: "test_google_mx@millennia21.id", gender: Gender.MALE,
      religion: Religion.ISLAM, birth_place: "Jakarta", birth_date: "1995-01-01T00:00:00.000Z", employee_id: "99.99.801",
      marital_status: MaritalStatus.SINGLE, status: EmployeeStatus.ACTIVE, employment_type: EmploymentType.PERMANENT,
      unit_id: master.unit.id, job_position_id: master.position.id, job_level_id: master.level.id, building_id: master.building.id,
      join_date: new Date("2026-01-01").toISOString(), ...over,
    });

    it("refuses a recovery email with a made-up domain and saves nothing", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const refused = await TestRequest.post("/api/admin/employees", employee({ recovery_email: "budi@gmial.com" }), accessToken);
      expect(refused.status).toBe(400);
      expect(JSON.stringify(await refused.json())).toContain("gmial.com");
      expect(google.created).toHaveLength(0);

      const ok = await TestRequest.post("/api/admin/employees", employee({ recovery_email: "budi@gmail.com" }), accessToken);
      expect(ok.status).toBe(200);
    });
  });
});
