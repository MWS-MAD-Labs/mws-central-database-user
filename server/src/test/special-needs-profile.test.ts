import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { AdminUserTest, AuditLogTest, EmployeeTest, MasterDataTest, GradeTest, StudentTest, TestRequest } from "./test-utils";
import { prismaClient } from "../lib/prisma";
import { StudentSupportRole } from "../generated/prisma/client";
import { SpecialNeedsProfileValidation } from "../validation/special-needs-profile-validation";

const profile = (over: Record<string, unknown> = {}) => ({
  needs: [
    { need_type: "LEARNING", description: "Reads below grade level." },
    { need_type: "SENSORY", description: "Is sensitive to noise." },
  ],
  learning_support_summary: "Short steps and visual cues.",
  accommodations: "Quiet corner for tests.",
  has_professional_report: true,
  report_date: "2025-03-01",
  identified_date: "2024-09-01",
  ...over,
});

describe("Special Needs profile", () => {
  let studentId: string;
  const url = () => `/api/admin/students/${studentId}/special-needs-profile`;

  async function cleanup() {
    await AuditLogTest.delete();
    await StudentTest.delete();
    await EmployeeTest.delete();
    await AdminUserTest.delete();
    await GradeTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();
    const person = await StudentTest.create({ email: "test_sn_profile@millennia21.id", nis: "9500101" });
    studentId = person.student!.id;
  });

  afterEach(cleanup);

  it("saves the profile and marks the student Special Needs in one step", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();

    const response = await TestRequest.put(url(), profile(), accessToken);

    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data).toMatchObject({ student_id: studentId, needs: profile().needs, report_date: "2025-03-01", has_professional_report: true });
    expect(await prismaClient.student.findUnique({ where: { id: studentId }, select: { sn: true } })).toEqual({ sn: true });
  });

  it("updates the same profile instead of adding another, and records both changes", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await TestRequest.put(url(), profile(), accessToken);

    const response = await TestRequest.put(url(), profile({ needs: [{ need_type: "COMMUNICATION", description: "Needs communication support." }] }), accessToken);

    expect(response.status).toBe(200);
    expect(await prismaClient.studentSpecialNeedsProfile.count({ where: { student_id: studentId } })).toBe(1);
    const actions = (await prismaClient.auditLog.findMany({ where: { entity_type: "StudentSpecialNeedsProfile" }, select: { action: true } })).map((row) => row.action).sort();
    expect(actions).toEqual(["CREATE_SPECIAL_NEEDS_PROFILE", "UPDATE_SPECIAL_NEEDS_PROFILE"]);
  });

  it("keeps the free text out of the audit log", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await TestRequest.put(url(), profile(), accessToken);

    const log = await prismaClient.auditLog.findFirstOrThrow({ where: { action: "CREATE_SPECIAL_NEEDS_PROFILE" } });

    expect(JSON.stringify(log.new_values)).not.toContain("Reads below grade level");
    expect(JSON.stringify(log.new_values)).not.toContain("Quiet corner");
  });

  it("reads the profile back, and says 404 when there is none", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    expect((await TestRequest.get(url(), accessToken)).status).toBe(404);

    await TestRequest.put(url(), profile(), accessToken);
    const response = await TestRequest.get(url(), accessToken);

    expect(response.status).toBe(200);
    expect((await response.json()).data.needs).toEqual(profile().needs);
  });

  describe("validation", () => {
    let accessToken: string;
    beforeEach(async () => {
      accessToken = (await AdminUserTest.createSuperAdmin()).accessToken;
    });

    const rejects = async (body: Record<string, unknown>) => {
      const response = await TestRequest.put(url(), body, accessToken);
      expect(response.status).toBe(400);
      expect(await prismaClient.studentSpecialNeedsProfile.count({ where: { student_id: studentId } })).toBe(0);
    };

    it("needs at least one need type, with no repeats and no unknown value", async () => {
      await rejects(profile({ needs: [] }));
      await rejects(profile({ needs: [{ need_type: "LEARNING", description: "One" }, { need_type: "LEARNING", description: "Two" }] }));
      await rejects(profile({ needs: [{ need_type: "MAGIC", description: "Unknown" }] }));
    });

    it("needs a description, and keeps every text within its limit", async () => {
      await rejects(profile({ needs: [{ need_type: "LEARNING", description: "   " }] }));
      await rejects(profile({ needs: [{ need_type: "LEARNING", description: "x".repeat(1001) }] }));
      await rejects(profile({ learning_support_summary: "x".repeat(501) }));
      await rejects(profile({ accommodations: "x".repeat(1001) }));
    });

    it("accepts the texts at exactly their limit", async () => {
      const response = await TestRequest.put(url(), profile({ needs: [{ need_type: "LEARNING", description: "x".repeat(1000) }], learning_support_summary: "y".repeat(500), accommodations: "z".repeat(1000) }), accessToken);
      expect(response.status).toBe(200);
    });

    it("rejects dates in the future, a report date without a report, and any unknown field", async () => {
      await rejects(profile({ identified_date: "2999-01-01" }));
      await rejects(profile({ has_professional_report: false, report_date: "2025-03-01" }));
      await rejects(profile({ surprise: true }));
    });
  });

  describe("who may write", () => {
    it("refuses a viewer, and a database admin without student write permission", async () => {
      const viewer = await AdminUserTest.createViewer();
      expect((await TestRequest.put(url(), profile(), viewer.accessToken)).status).toBe(403);
      const noWrite = await AdminUserTest.createDatabaseAdmin(undefined, { canWriteStudentData: false, canViewSensitiveData: true, canViewAllUnits: true });
      expect((await TestRequest.put(url(), profile(), noWrite.accessToken)).status).toBe(403);
    });

    it("refuses a database admin who may not see sensitive data, for write and read", async () => {
      const { accessToken } = await AdminUserTest.createDatabaseAdmin(undefined, { canViewSensitiveData: false, canViewAllUnits: true });
      expect((await TestRequest.put(url(), profile(), accessToken)).status).toBe(403);
      expect((await TestRequest.get(url(), accessToken)).status).toBe(403);
    });

    it("answers 404 for a student that does not exist", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      expect((await TestRequest.put("/api/admin/students/nope/special-needs-profile", profile(), accessToken)).status).toBe(404);
    });
  });

  describe("removing", () => {
    const remove = (token: string) => TestRequest.patch(`${url()}/delete`, {}, token);

    it("clears the status with the profile, and a later save restores the same row", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await TestRequest.put(url(), profile(), accessToken);

      expect((await remove(accessToken)).status).toBe(200);
      expect(await prismaClient.student.findUnique({ where: { id: studentId }, select: { sn: true } })).toEqual({ sn: false });
      expect((await TestRequest.get(url(), accessToken)).status).toBe(404);

      expect((await TestRequest.put(url(), profile(), accessToken)).status).toBe(200);
      expect(await prismaClient.studentSpecialNeedsProfile.count({ where: { student_id: studentId } })).toBe(1);
      expect(await prismaClient.student.findUnique({ where: { id: studentId }, select: { sn: true } })).toEqual({ sn: true });
    });

    it("is refused while an SE Teacher is still assigned", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await TestRequest.put(url(), profile(), accessToken);
      const unit = await prismaClient.masterUnit.findFirstOrThrow({ where: { name: { startsWith: "TEST_" } } });
      const position = await prismaClient.masterJobPosition.findFirstOrThrow({ where: { name: { startsWith: "TEST_" } } });
      const building = await prismaClient.masterBuilding.findFirstOrThrow({ where: { name: { startsWith: "TEST_" } } });
      const level = await prismaClient.masterJobLevel.create({ data: { name: `TEST_LVL_SN_${Date.now()}`, is_teaching_role: true } });
      const person = await EmployeeTest.create({ email: "test_sn_teacher@millennia21.id", unitId: unit.id, jobPositionId: position.id, jobLevelId: level.id, buildingId: building.id });
      await prismaClient.studentSupportAssignment.create({ data: { student_id: studentId, employee_id: person.employee!.id, role: StudentSupportRole.SPECIAL_ED } });

      const response = await remove(accessToken);

      expect(response.status).toBe(400);
      expect(await prismaClient.student.findUnique({ where: { id: studentId }, select: { sn: true } })).toEqual({ sn: true });
      expect(await prismaClient.studentSpecialNeedsProfile.count({ where: { student_id: studentId, deleted_at: null } })).toBe(1);
    });
  });

  it("rejects sn on a generic student update; removal goes through the profile endpoint", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    await TestRequest.put(url(), profile(), accessToken);

    const response = await TestRequest.patch(`/api/admin/students/${studentId}`, { sn: false }, accessToken);

    expect(response.status).toBe(400);
    expect(await prismaClient.student.findUnique({ where: { id: studentId }, select: { sn: true } })).toEqual({ sn: true });
    expect(await prismaClient.studentSpecialNeedsProfile.count({ where: { student_id: studentId, deleted_at: null } })).toBe(1);
  });

  describe("dates follow the school day in WIB", () => {
    afterEach(() => setSystemTime());

    const check = (identified_date: string) =>
      SpecialNeedsProfileValidation.SAVE.safeParse({
        student_id: "s",
        profile: { needs: [{ need_type: "LEARNING", description: "d" }], identified_date },
      }).success;

    it("accepts today in WIB while UTC is still yesterday, and refuses the day after", () => {
      // 18:00 UTC on 9 November is 01:00 on 10 November in WIB.
      setSystemTime(new Date("2026-11-09T18:00:00Z"));

      expect(check("2026-11-10")).toBe(true);
      expect(check("2026-11-11")).toBe(false);
    });
  });

  describe("atomic student edit", () => {
    it("creates, updates, and removes the profile through PATCH student", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const create = await TestRequest.patch(
        `/api/admin/students/${studentId}`,
        { full_name: "Profiled Student", special_needs_profile: profile() },
        accessToken,
      );
      expect(create.status).toBe(200);
      const first = await prismaClient.studentSpecialNeedsProfile.findUniqueOrThrow({ where: { student_id: studentId } });
      expect(first.deleted_at).toBeNull();
      expect(await prismaClient.student.findUnique({ where: { id: studentId }, select: { sn: true } })).toEqual({ sn: true });

      const update = await TestRequest.patch(
        `/api/admin/students/${studentId}`,
        { special_needs_profile: profile({ needs: [{ need_type: "COMMUNICATION", description: "Needs communication support." }] }) },
        accessToken,
      );
      expect(update.status).toBe(200);
      const second = await prismaClient.studentSpecialNeedsProfile.findUniqueOrThrow({ where: { student_id: studentId }, include: { needs: true } });
      expect(second.id).toBe(first.id);
      expect(second.needs.map((need) => need.need_type)).toEqual(["COMMUNICATION"]);

      const removeResponse = await TestRequest.patch(
        `/api/admin/students/${studentId}`,
        { special_needs_profile: null },
        accessToken,
      );
      expect(removeResponse.status).toBe(200);
      expect(await prismaClient.student.findUnique({ where: { id: studentId }, select: { sn: true } })).toEqual({ sn: false });
      expect(await prismaClient.studentSpecialNeedsProfile.count({ where: { student_id: studentId, deleted_at: null } })).toBe(0);
    });

    it("rolls back the student change when active support blocks profile removal", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      await TestRequest.put(url(), profile(), accessToken);
      const unit = await prismaClient.masterUnit.findFirstOrThrow({ where: { name: { startsWith: "TEST_" } } });
      const position = await prismaClient.masterJobPosition.findFirstOrThrow({ where: { name: { startsWith: "TEST_" } } });
      const building = await prismaClient.masterBuilding.findFirstOrThrow({ where: { name: { startsWith: "TEST_" } } });
      const level = await prismaClient.masterJobLevel.create({ data: { name: `TEST_LVL_SN_ATOMIC_${Date.now()}`, is_teaching_role: true } });
      const teacher = await EmployeeTest.create({ email: "test_sn_atomic_teacher@millennia21.id", unitId: unit.id, jobPositionId: position.id, jobLevelId: level.id, buildingId: building.id });
      await prismaClient.studentSupportAssignment.create({ data: { student_id: studentId, employee_id: teacher.employee!.id, role: StudentSupportRole.SPECIAL_ED } });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}`,
        { full_name: "Must Roll Back", special_needs_profile: null },
        accessToken,
      );

      expect(response.status).toBe(400);
      expect((await prismaClient.person.findFirstOrThrow({ where: { student: { id: studentId } }, select: { full_name: true } })).full_name).toBe("Test Student");
      expect(await prismaClient.studentSpecialNeedsProfile.count({ where: { student_id: studentId, deleted_at: null } })).toBe(1);
    });

    it("requires sensitive access only when the profile field is present", async () => {
      const ordinary = await AdminUserTest.createDatabaseAdmin(undefined, { canViewSensitiveData: false, canViewAllUnits: true });
      expect((await TestRequest.patch(`/api/admin/students/${studentId}`, { previous_school: "Updated School" }, ordinary.accessToken)).status).toBe(200);
      expect((await TestRequest.patch(`/api/admin/students/${studentId}`, { special_needs_profile: profile() }, ordinary.accessToken)).status).toBe(403);
      expect((await TestRequest.patch(`/api/admin/students/${studentId}`, { special_needs_profile: null }, ordinary.accessToken)).status).toBe(403);
    });
  });
});
