import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  AuditLogTest,
  AcademicYearTest,
  MasterDataTest,
  InternTest,
  StudentTest,
} from "./test-utils";
import {
  AuditAction,
  AuditSource,
  Gender,
  Religion,
  InternStatus,
  type MasterUnit,
  type MasterJobPosition,
  type MasterBuilding,
  ClassTeacherRole,
  StudentSupportRole,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("POST /api/admin/interns", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    building: MasterBuilding;
  };
  let secondUnitId: string;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await InternTest.delete();

    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await MasterDataTest.delete();

    masterData = await MasterDataTest.create();

    const unit2 = await prismaClient.masterUnit.create({
      data: { id: "unit_2_test", name: "Second Unit" },
    });
    secondUnitId = unit2.id;
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await InternTest.delete();

    await prismaClient.masterUnit.deleteMany({ where: { id: "unit_2_test" } });
    await MasterDataTest.delete();
  });

  it("should successfully create an intern when requested by SUPER_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const requestBody = {
      full_name: "Test Intern One",
      nick_name: "Intern One",
      email: "test_intern_1@millennia21.id",
      gender: Gender.MALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      birth_date: new Date("2003-01-01").toISOString(),

      unit_id: masterData.unit.id,
      job_position_id: masterData.position.id,
      building_id: masterData.building.id,
      join_date: new Date("2026-07-01").toISOString(),
      end_date: new Date("2026-12-31").toISOString(),
    };

    const response = await TestRequest.post(
      "/api/admin/interns",
      requestBody,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.identity.email).toBe("test_intern_1@millennia21.id");
    expect(body.data.employment.unit).toBe("TEST_UNIT_SHIELD");
    expect(body.data.employment.job_position).toBe("TEST_POS_TEACHER");
    expect(body.data.employment.is_teaching_position).toBe(false);
    expect(body.data.status).toBe(InternStatus.ACTIVE);

    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: body.data.id },
    });

    expect(auditLog.action).toBe(AuditAction.CREATE_INTERN);
    expect(auditLog.source).toBe(AuditSource.UI);
    expect(auditLog.entity_type).toBe("Intern");
    expect(auditLog.admin_id).toBe(admin.id);
    expect(auditLog.old_values).toBeNull();
  });

  it("should reject creation (400) when birth_date is in the future", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 5);

    const response = await TestRequest.post(
      "/api/admin/interns",
      {
        full_name: "Future Intern",
        nick_name: "Future",
        email: "test_intern_future_birth@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: futureDate.toISOString(),
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-07-01").toISOString(),
        end_date: new Date("2026-12-31").toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("cannot be in the future");
  });

  it("should reject creation (400) when join_date is more than 90 days in the future", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const farFutureJoin = new Date();
    farFutureJoin.setDate(farFutureJoin.getDate() + 200);
    const farFutureEnd = new Date(farFutureJoin);
    farFutureEnd.setMonth(farFutureEnd.getMonth() + 3);

    const response = await TestRequest.post(
      "/api/admin/interns",
      {
        full_name: "Far Future Intern",
        nick_name: "FarFuture",
        email: "test_intern_far_future_join@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        building_id: masterData.building.id,
        join_date: farFutureJoin.toISOString(),
        end_date: farFutureEnd.toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("90 days");
  });

  it("should reject creation (400) when the intern would be younger than 15 at join_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.post(
      "/api/admin/interns",
      {
        full_name: "Toddler Intern",
        nick_name: "Toddler",
        email: "test_intern_toddler@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2020-01-01").toISOString(),
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-07-01").toISOString(),
        end_date: new Date("2026-12-31").toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(400);
    expect(body.errors).toContain("at least 15 years old");
  });

  it("should create without birth_place/birth_date - HR doesn't collect these for interns", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.post(
      "/api/admin/interns",
      {
        full_name: "Test Intern No Birth Info",
        nick_name: "No Birth Info",
        email: "test_intern_no_birth@millennia21.id",
        gender: Gender.FEMALE,
        religion: Religion.ISLAM,

        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-07-01").toISOString(),
        end_date: new Date("2026-12-31").toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);

    const getResponse = await TestRequest.get(
      `/api/admin/interns/${body.data.id}`,
      accessToken,
    );
    const getBody = await getResponse.json();
    // Hidden from the detail response, released only by the audited reveal.
    expect(getBody.data.identity.gender).toBeUndefined();
    const revealResponse = await TestRequest.post(
      `/api/admin/interns/${body.data.id}/sensitive-fields/access`,
      {},
      accessToken,
    );
    const revealed = (await revealResponse.json()).data;
    expect(revealResponse.status).toBe(200);
    expect(revealed.birth_place).toBeNull();
    expect(revealed.birth_date).toBeNull();
    expect(revealed.gender).toBe(Gender.FEMALE);
    expect(revealed.religion).toBe(Religion.ISLAM);
  });

  it("should reject (400) when end_date is not after join_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.post(
      "/api/admin/interns",
      {
        full_name: "Test Intern Bad Dates",
        nick_name: "Bad Dates",
        email: "test_intern_2@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2003-01-01").toISOString(),

        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-07-01").toISOString(),
        end_date: new Date("2026-01-01").toISOString(),
      },
      accessToken,
    );

    expect(response.status).toBe(400);
  });

  it("should reject (403) when requested by VIEWER", async () => {
    const { accessToken } = await AdminUserTest.createViewer(masterData.unit.id);

    const response = await TestRequest.post(
      "/api/admin/interns",
      {
        full_name: "Test Intern Viewer",
        nick_name: "Viewer",
        email: "test_intern_3@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2003-01-01").toISOString(),

        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-07-01").toISOString(),
        end_date: new Date("2026-12-31").toISOString(),
      },
      accessToken,
    );

    expect(response.status).toBe(403);
  });

  it("should reject (403) when DATABASE_ADMIN creates outside their unit scope", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.post(
      "/api/admin/interns",
      {
        full_name: "Test Intern Other Unit",
        nick_name: "Other Unit",
        email: "test_intern_4@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2003-01-01").toISOString(),

        unit_id: secondUnitId,
        job_position_id: masterData.position.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-07-01").toISOString(),
        end_date: new Date("2026-12-31").toISOString(),
      },
      accessToken,
    );

    expect(response.status).toBe(403);
  });

  it("should reject contact PII from DATABASE_ADMIN without employee PII access", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.post(
      "/api/admin/interns",
      {
        full_name: "Restricted Contact Intern",
        nick_name: "Restricted",
        email: "test_intern_restricted_contact@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-07-01").toISOString(),
        end_date: new Date("2026-12-31").toISOString(),
        mobile_phone: "081234567890",
        residential_address: "Restricted address",
      },
      accessToken,
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.errors).toContain("intern contact PII");
  });

  it("should allow contact PII from DATABASE_ADMIN with employee PII access", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
      { canViewEmployeePii: true },
    );

    const response = await TestRequest.post(
      "/api/admin/interns",
      {
        full_name: "Allowed Contact Intern",
        nick_name: "Allowed",
        email: "test_intern_allowed_contact@millennia21.id",
        gender: Gender.FEMALE,
        religion: Religion.ISLAM,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-07-01").toISOString(),
        end_date: new Date("2026-12-31").toISOString(),
        mobile_phone: "081234567890",
        residential_address: "Allowed address",
      },
      accessToken,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.identity.mobile_phone).toBe("6281234567890");
    expect(body.data.identity.residential_address).toBe("Allowed address");
  });
});

describe("GET /api/admin/interns/:id/teaching-assignments", () => {
  async function cleanupTeachingAssignments() {
    await prismaClient.classTeacherAssignment.deleteMany({
      where: { intern: { email: { contains: "test_intern_" } } },
    });
    await prismaClient.class.deleteMany({
      where: { name: { startsWith: "TEST_Intern_History_" } },
    });
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_INTERN_HISTORY_GRADE_" } },
    });
    await InternTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(cleanupTeachingAssignments);
  afterEach(cleanupTeachingAssignments);

  it("should return the intern's class assignment history", async () => {
    const masterData = await MasterDataTest.create();
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const intern = await InternTest.create({
      email: "test_intern_teaching_history@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });
    await prismaClient.intern.update({
      where: { id: intern.id },
      data: { end_date: new Date("2027-06-30") },
    });
    const academicYearId = await StudentTest.resolveAcademicYearId();
    const grade = await prismaClient.grade.create({
      data: {
        name: `TEST_INTERN_HISTORY_GRADE_${Date.now()}`,
        level: 9000 + Math.floor(Math.random() * 1000),
        unit_id: masterData.unit.id,
      },
    });
    const klass = await prismaClient.class.create({
      data: {
        name: `TEST_Intern_History_${Date.now()}`,
        grade_id: grade.id,
        academic_year_id: academicYearId,
      },
    });
    await prismaClient.classTeacherAssignment.create({
      data: {
        class_id: klass.id,
        start_date: new Date(),
        intern_id: intern.id,
        role: ClassTeacherRole.SUBJECT_TEACHER,
        subject: "Art",
      },
    });

    const response = await TestRequest.get(
      `/api/admin/interns/${intern.id}/teaching-assignments`,
      accessToken,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].class.id).toBe(klass.id);
    expect(body.data[0].role).toBe(ClassTeacherRole.SUBJECT_TEACHER);
    expect(body.data[0].subject).toBe("Art");

  });

  it("should return 404 for a nonexistent intern", async () => {
    const masterData = await MasterDataTest.create();
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const response = await TestRequest.get(
      "/api/admin/interns/nonexistent-id/teaching-assignments",
      accessToken,
    );

    expect(response.status).toBe(404);
  });

  it("should hide an out-of-unit intern's teaching history from DATABASE_ADMIN", async () => {
    const masterData = await MasterDataTest.create();
    const otherUnit = await prismaClient.masterUnit.create({
      data: { name: `TEST_INTERN_HISTORY_OTHER_${Date.now()}` },
    });
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );
    const intern = await InternTest.create({
      email: "test_intern_teaching_history_scoped@millennia21.id",
      unitId: otherUnit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });

    const response = await TestRequest.get(
      `/api/admin/interns/${intern.id}/teaching-assignments`,
      accessToken,
    );
    expect(response.status).toBe(404);
  });

  it("should reject teaching history without employee view permission", async () => {
    const masterData = await MasterDataTest.create();
    const { accessToken } = await AdminUserTest.createViewer(masterData.unit.id, {
      canViewEmployeeData: false,
    });
    const intern = await InternTest.create({
      email: "test_intern_teaching_history_no_view@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });

    const response = await TestRequest.get(
      `/api/admin/interns/${intern.id}/teaching-assignments`,
      accessToken,
    );
    expect(response.status).toBe(403);
  });
});

describe("Intern student support lifecycle guards", () => {
  async function cleanup() {
    await prismaClient.studentSupportAssignment.deleteMany({
      where: { intern: { email: { contains: "test_intern_" } } },
    });
    await StudentTest.delete();
    await InternTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(cleanup);
  afterEach(cleanup);

  async function createAssignedIntern() {
    const masterData = await MasterDataTest.create();
    const position = await prismaClient.masterJobPosition.upsert({
      where: { name: "Special Education Teacher" },
      update: { is_teaching_position: true },
      create: { name: "Special Education Teacher", is_teaching_position: true },
    });
    const intern = await InternTest.create({
      email: "test_intern_lifecycle_support@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: position.id,
      buildingId: masterData.building.id,
    });
    await prismaClient.intern.update({
      where: { id: intern.id },
      data: { end_date: new Date("2027-06-30") },
    });
    const student = await StudentTest.create({
      email: "test_intern_lifecycle_student@millennia21.id",
      nis: "9790001",
    });
    await prismaClient.studentSupportAssignment.create({
      data: {
        student_id: student.student!.id,
        intern_id: intern.id,
        role: StudentSupportRole.SPECIAL_ED,
      },
    });
    return { intern, masterData };
  }

  it("blocks archive while an active support assignment remains", async () => {
    const { intern, masterData } = await createAssignedIntern();
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);

    const response = await TestRequest.patch(
      `/api/admin/interns/delete/${intern.id}`,
      {},
      accessToken,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).errors).toContain("active student support assignment");
  });

  it("blocks completion while an active support assignment remains", async () => {
    const { intern, masterData } = await createAssignedIntern();
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);

    const response = await TestRequest.patch(
      `/api/admin/interns/${intern.id}`,
      { status: InternStatus.COMPLETED },
      accessToken,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).errors).toContain("active student support assignment");
  });
});

describe("Intern PC mentorship lifecycle guards", () => {
  async function cleanup() {
    await prismaClient.pcActivityRoom.deleteMany({
      where: { units: { some: { unit: { name: { startsWith: "TEST_" } } } } },
    });
    await prismaClient.masterPCActivity.deleteMany({
      where: { name: "TEST_PC_LIFECYCLE" },
    });
    await AcademicYearTest.delete();
    await InternTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }
  beforeEach(cleanup);
  afterEach(cleanup);

  async function createMentorIntern() {
    const masterData = await MasterDataTest.create();
    await prismaClient.masterJobPosition.update({
      where: { id: masterData.position.id },
      data: { is_teaching_position: true },
    });
    const intern = await InternTest.create({
      email: "test_intern_pc_lifecycle@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });
    await prismaClient.intern.update({
      where: { id: intern.id },
      data: {
        end_date: new Date("2027-06-30"),
        is_pc_mentor_eligible: true,
      },
    });
    const activity = await prismaClient.masterPCActivity.create({
      data: { name: "TEST_PC_LIFECYCLE" },
    });
    const academicYear = await AcademicYearTest.create();
    const room = await prismaClient.pcActivityRoom.create({
      data: {
        activity_id: activity.id,
        academic_year_id: academicYear.id,
        day: "MONDAY",
        duration_type: "SEMESTER",
        start_date: academicYear.start_date,
        end_date: academicYear.end_date!,
        created_by: "test",
        units: { create: { unit_id: masterData.unit.id } },
      },
    });
    await prismaClient.pcActivityRoomMentorAssignment.create({
      data: { room_id: room.id, intern_id: intern.id },
    });
    return { intern, masterData };
  }

  it("blocks archive while an active mentorship remains", async () => {
    const { intern, masterData } = await createMentorIntern();
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const response = await TestRequest.patch(
      `/api/admin/interns/delete/${intern.id}`,
      {},
      accessToken,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).errors).toContain("active PC activity mentorship");
  });

  it("blocks completion while an active mentorship remains", async () => {
    const { intern, masterData } = await createMentorIntern();
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const response = await TestRequest.patch(
      `/api/admin/interns/${intern.id}`,
      { status: InternStatus.COMPLETED },
      accessToken,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).errors).toContain("active PC activity mentorship");
  });
});

describe("Intern mutation history", () => {
  async function cleanup() {
    await prismaClient.internMutationHistory.deleteMany({
      where: { intern: { email: { contains: "test_intern_" } } },
    });
    await InternTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }
  beforeEach(cleanup);
  afterEach(cleanup);

  it("seeds four baseline rows when an intern is created", async () => {
    const masterData = await MasterDataTest.create();
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const response = await TestRequest.post(
      "/api/admin/interns",
      {
        full_name: "Test Intern History",
        nick_name: "History",
        email: "test_intern_history_create@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        building_id: masterData.building.id,
        join_date: "2026-07-01T00:00:00.000Z",
        end_date: "2027-06-30T00:00:00.000Z",
      },
      accessToken,
    );
    const body = await response.json();
    const history = await prismaClient.internMutationHistory.findMany({
      where: { intern_id: body.data.id },
    });
    expect(history).toHaveLength(4);
    expect(new Set(history.map((row) => row.field))).toEqual(
      new Set(["UNIT", "JOB_POSITION", "BUILDING", "STATUS"]),
    );
  });

  it("records changes and rolls the current field back", async () => {
    const masterData = await MasterDataTest.create();
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const intern = await InternTest.create({
      email: "test_intern_history_rollback@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });
    const otherBuilding = await prismaClient.masterBuilding.create({
      data: { name: `TEST_INTERN_HISTORY_BUILDING_${Date.now()}` },
    });
    await TestRequest.patch(
      `/api/admin/interns/${intern.id}`,
      { building_id: otherBuilding.id },
      accessToken,
    );

    const historyResponse = await TestRequest.get(
      `/api/admin/interns/${intern.id}/mutation-history`,
      accessToken,
    );
    const historyBody = await historyResponse.json();
    const current = historyBody.data.find(
      (row: { field: string; end_date: string | null }) =>
        row.field === "BUILDING" && row.end_date === null,
    );
    expect(current.value).toBe(otherBuilding.name);
    expect(current.can_rollback).toBe(true);

    const rollback = await TestRequest.patch(
      `/api/admin/interns/${intern.id}/mutation-history/${current.id}/rollback`,
      {},
      accessToken,
    );
    expect(rollback.status).toBe(200);
    const restored = await prismaClient.intern.findUniqueOrThrow({
      where: { id: intern.id },
    });
    expect(restored.building_id).toBe(masterData.building.id);
    const audit = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.ROLLBACK_INTERN_MUTATION },
    });
    expect(audit.entity_type).toBe("Intern");
  });

  it("rejects rollback of a genesis row and viewer rollback", async () => {
    const masterData = await MasterDataTest.create();
    const superAdmin = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const intern = await InternTest.create({
      email: "test_intern_history_denied@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });
    const genesis = await prismaClient.internMutationHistory.create({
      data: {
        intern_id: intern.id,
        field: "STATUS",
        status: InternStatus.ACTIVE,
        start_date: intern.join_date,
      },
    });
    const genesisRollback = await TestRequest.patch(
      `/api/admin/interns/${intern.id}/mutation-history/${genesis.id}/rollback`,
      {},
      superAdmin.accessToken,
    );
    expect(genesisRollback.status).toBe(400);

    const { accessToken: viewerToken } = await AdminUserTest.createViewer();
    const viewerRollback = await TestRequest.patch(
      `/api/admin/interns/${intern.id}/mutation-history/${genesis.id}/rollback`,
      {},
      viewerToken,
    );
    expect(viewerRollback.status).toBe(403);
  });

  it("rejects mutation history without employee view permission", async () => {
    const masterData = await MasterDataTest.create();
    const { accessToken } = await AdminUserTest.createViewer(masterData.unit.id, {
      canViewEmployeeData: false,
    });
    const intern = await InternTest.create({
      email: "test_intern_history_no_view@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });

    const response = await TestRequest.get(
      `/api/admin/interns/${intern.id}/mutation-history`,
      accessToken,
    );
    expect(response.status).toBe(403);
  });

  it("blocks eligibility-changing rollback while an active workforce assignment remains", async () => {
    const masterData = await MasterDataTest.create();
    const superAdmin = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const intern = await InternTest.create({
      email: "test_intern_history_guard@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });
    const otherUnit = await prismaClient.masterUnit.create({
      data: { name: `TEST_HISTORY_OTHER_UNIT_${Date.now()}` },
    });
    const previous = await prismaClient.internMutationHistory.create({
      data: {
        intern_id: intern.id,
        field: "UNIT",
        unit_id: otherUnit.id,
        start_date: new Date("2025-01-01"),
        end_date: new Date("2026-01-01"),
      },
    });
    const current = await prismaClient.internMutationHistory.create({
      data: {
        intern_id: intern.id,
        field: "UNIT",
        unit_id: masterData.unit.id,
        start_date: new Date("2026-01-01"),
        previous_history_id: previous.id,
      },
    });
    const student = await StudentTest.create({
      email: "test_intern_history_guard_student@millennia21.id",
      nis: "9790002",
    });
    await prismaClient.studentSupportAssignment.create({
      data: {
        student_id: student.student!.id,
        intern_id: intern.id,
        role: StudentSupportRole.SPECIAL_ED,
      },
    });

    const response = await TestRequest.patch(
      `/api/admin/interns/${intern.id}/mutation-history/${current.id}/rollback`,
      {},
      superAdmin.accessToken,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).errors).toContain("active workforce assignment");
  });

  it("records archive and restore as status mutation periods", async () => {
    const masterData = await MasterDataTest.create();
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const intern = await InternTest.create({
      email: "test_intern_history_archive_restore@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });
    // Restore derives status from end_date - keep it unexpired so an
    // archive/restore cycle lands back on ACTIVE.
    await prismaClient.intern.update({
      where: { id: intern.id },
      data: { end_date: new Date("2027-06-30") },
    });

    expect(
      (await TestRequest.patch(`/api/admin/interns/delete/${intern.id}`, {}, accessToken)).status,
    ).toBe(200);
    expect(
      (await TestRequest.patch(`/api/admin/interns/restore/${intern.id}`, {}, accessToken)).status,
    ).toBe(200);

    const rows = await prismaClient.internMutationHistory.findMany({
      where: { intern_id: intern.id, field: "STATUS", deleted_at: null },
      orderBy: { start_date: "asc" },
    });
    expect(rows.map((row) => row.status)).toEqual([
      InternStatus.TERMINATED,
      InternStatus.ACTIVE,
    ]);
    expect(rows[0].end_date).not.toBeNull();
    expect(rows[1].end_date).toBeNull();
  });
});

describe("Intern restore assignment semantics", () => {
  async function cleanup() {
    await InternTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }
  beforeEach(cleanup);
  afterEach(cleanup);

  it("does not reactivate ended or removed workforce assignments on restore", async () => {
    const masterData = await MasterDataTest.create();
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const intern = await InternTest.create({
      email: "test_intern_restore_assignments@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });
    const academicYear = await prismaClient.academicYear.findFirstOrThrow();
    const grade = await StudentTest.resolveGradeId();
    const klass = await prismaClient.class.create({
      data: {
        name: `TEST_Restore_Assignments_${Date.now()}`,
        grade_id: grade,
        academic_year_id: academicYear.id,
      },
    });
    const classAssignment = await prismaClient.classTeacherAssignment.create({
      data: {
        class_id: klass.id,
        start_date: academicYear.start_date,
        intern_id: intern.id,
        role: ClassTeacherRole.SUBJECT_TEACHER,
        end_date: new Date(),
      },
    });
    const student = await StudentTest.create({
      email: "test_intern_restore_student@millennia21.id",
      nis: "9790003",
    });
    const supportAssignment = await prismaClient.studentSupportAssignment.create({
      data: {
        student_id: student.student!.id,
        intern_id: intern.id,
        role: StudentSupportRole.SPECIAL_ED,
        deleted_at: new Date(),
      },
    });

    await TestRequest.patch(`/api/admin/interns/delete/${intern.id}`, {}, accessToken);
    const restore = await TestRequest.patch(
      `/api/admin/interns/restore/${intern.id}`,
      {},
      accessToken,
    );
    expect(restore.status).toBe(200);

    const [restoredClass, restoredSupport] = await Promise.all([
      prismaClient.classTeacherAssignment.findUniqueOrThrow({
        where: { id: classAssignment.id },
      }),
      prismaClient.studentSupportAssignment.findUniqueOrThrow({
        where: { id: supportAssignment.id },
      }),
    ]);
    expect(restoredClass.end_date).not.toBeNull();
    expect(restoredSupport.deleted_at).not.toBeNull();
  });
});

describe("Intern class assignment lifecycle guards", () => {
  async function cleanup() {
    await InternTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }
  beforeEach(cleanup);
  afterEach(cleanup);

  async function createAssignedIntern() {
    const masterData = await MasterDataTest.create();
    await prismaClient.masterJobPosition.update({
      where: { id: masterData.position.id },
      data: { is_teaching_position: true },
    });
    const intern = await InternTest.create({
      email: "test_intern_class_guard@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });
    const academicYear = await prismaClient.academicYear.findFirstOrThrow();
    const gradeId = await StudentTest.resolveGradeId();
    const klass = await prismaClient.class.create({
      data: {
        name: `TEST_Intern_Class_Guard_${Date.now()}`,
        grade_id: gradeId,
        academic_year_id: academicYear.id,
      },
    });
    await prismaClient.classTeacherAssignment.create({
      data: {
        class_id: klass.id,
        start_date: academicYear.start_date,
        intern_id: intern.id,
        role: ClassTeacherRole.SUBJECT_TEACHER,
      },
    });
    return { intern, masterData };
  }

  it("serializes concurrent assignment and completion into a consistent state", async () => {
    const masterData = await MasterDataTest.create();
    await prismaClient.masterJobPosition.update({
      where: { id: masterData.position.id },
      data: { is_teaching_position: true },
    });
    const intern = await InternTest.create({
      email: "test_intern_class_guard_concurrent@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });
    await prismaClient.intern.update({
      where: { id: intern.id },
      data: { end_date: new Date("2027-06-30") },
    });
    const academicYear = await prismaClient.academicYear.findFirstOrThrow();
    const klass = await prismaClient.class.create({
      data: {
        name: `TEST_Intern_Class_Concurrent_${Date.now()}`,
        grade_id: await StudentTest.resolveGradeId(),
        academic_year_id: academicYear.id,
      },
    });
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);

    const [assignment, completion] = await Promise.all([
      TestRequest.post(
        `/api/admin/classes/${klass.id}/teachers`,
        { intern_id: intern.id, role: ClassTeacherRole.SUBJECT_TEACHER, subject: "Art" },
        accessToken,
      ),
      TestRequest.patch(
        `/api/admin/interns/${intern.id}`,
        { status: InternStatus.COMPLETED },
        accessToken,
      ),
    ]);
    expect([assignment.status, completion.status].sort()).toEqual([200, 400]);

    const [currentIntern, activeAssignments] = await Promise.all([
      prismaClient.intern.findUniqueOrThrow({ where: { id: intern.id } }),
      prismaClient.classTeacherAssignment.count({
        where: { intern_id: intern.id, end_date: null, deleted_at: null },
      }),
    ]);
    expect(
      currentIntern.status === InternStatus.ACTIVE || activeAssignments === 0,
    ).toBe(true);
  });

  it("blocks completion while an active class assignment remains", async () => {
    const { intern, masterData } = await createAssignedIntern();
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const response = await TestRequest.patch(
      `/api/admin/interns/${intern.id}`,
      { status: InternStatus.COMPLETED },
      accessToken,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).errors).toContain("active class assignment");
  });

  it("blocks archive while an active class assignment remains", async () => {
    const { intern, masterData } = await createAssignedIntern();
    const { accessToken } = await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const response = await TestRequest.patch(
      `/api/admin/interns/delete/${intern.id}`,
      {},
      accessToken,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).errors).toContain("active class assignment");
  });
});

describe("PATCH /api/admin/interns/:id", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await InternTest.delete();
    await MasterDataTest.delete();

    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await InternTest.delete();
    await MasterDataTest.delete();
  });

  it("should update status and notes", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const intern = await InternTest.create({
      email: "test_intern_update@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });

    const response = await TestRequest.patch(
      `/api/admin/interns/${intern.id}`,
      { status: InternStatus.COMPLETED, notes: "Finished the internship" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe(InternStatus.COMPLETED);
    expect(body.data.notes).toBe("Finished the internship");
  });

  it("should reject contact PII updates without employee PII access", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );
    const intern = await InternTest.create({
      email: "test_intern_update_restricted_contact@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });

    const response = await TestRequest.patch(
      `/api/admin/interns/${intern.id}`,
      { mobile_phone: "081234567890" },
      accessToken,
    );

    expect(response.status).toBe(403);
    expect((await response.json()).errors).toContain("intern contact PII");
  });
});

describe("GET /api/admin/interns", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await InternTest.delete();
    await MasterDataTest.delete();

    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await InternTest.delete();
    await MasterDataTest.delete();
  });

  it("should list and get intern detail", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const intern = await InternTest.create({
      email: "test_intern_get@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });

    const searchResponse = await TestRequest.get(
      "/api/admin/interns",
      accessToken,
    );
    const searchBody = await searchResponse.json();
    expect(searchResponse.status).toBe(200);
    expect(
      searchBody.data.some((item: { id: string }) => item.id === intern.id),
    ).toBe(true);

    const getResponse = await TestRequest.get(
      `/api/admin/interns/${intern.id}`,
      accessToken,
    );
    const getBody = await getResponse.json();
    expect(getResponse.status).toBe(200);
    expect(getBody.data.identity.email).toBe("test_intern_get@millennia21.id");
    expect(getBody.data.identity.gender).toBeUndefined();
    expect(getBody.data.identity.can_view_pii).toBe(true);
  });

  it("should audit the reveal and refuse it without employee PII access", async () => {
    const intern = await InternTest.create({
      email: "test_intern_reveal@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const withoutPii = await AdminUserTest.createDatabaseAdmin(masterData.unit.id, {
      id: "test-intern-reveal-no-pii",
      email: "test_intern_reveal_no_pii@millennia21.id",
    });

    const ok = await TestRequest.post(
      `/api/admin/interns/${intern.id}/sensitive-fields/access`,
      {},
      accessToken,
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.gender).toBe(Gender.MALE);
    const log = await prismaClient.auditLog.findFirst({
      where: { action: "ACCESS_EMPLOYEE_PII", entity_type: "Intern", entity_id: intern.id },
    });
    expect(log).not.toBeNull();

    const denied = await TestRequest.post(
      `/api/admin/interns/${intern.id}/sensitive-fields/access`,
      {},
      withoutPii.accessToken,
    );
    expect(denied.status).toBe(403);
  });

  it("should hide contact PII from DATABASE_ADMIN without employee PII access", async () => {
    const intern = await InternTest.create({
      email: "test_intern_hidden_contact@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
      mobilePhone: "081234567890",
      residentialAddress: "Hidden address",
    });
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );

    const getResponse = await TestRequest.get(
      `/api/admin/interns/${intern.id}`,
      accessToken,
    );
    const getBody = await getResponse.json();
    const listResponse = await TestRequest.get("/api/admin/interns", accessToken);
    const listBody = await listResponse.json();
    const listedIntern = listBody.data.find((item: { id: string }) => item.id === intern.id);

    expect(getResponse.status).toBe(200);
    expect(getBody.data.identity.mobile_phone).toBeUndefined();
    expect(getBody.data.identity.residential_address).toBeUndefined();
    expect(listedIntern.identity.mobile_phone).toBeUndefined();
    expect(listedIntern.identity.residential_address).toBeUndefined();
  });
});

describe("DELETE/RESTORE /api/admin/interns", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await InternTest.delete();
    await MasterDataTest.delete();

    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await InternTest.delete();
    await MasterDataTest.delete();
  });

  it("should soft-delete then restore an intern, SUPER_ADMIN only", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    const intern = await InternTest.create({
      email: "test_intern_delete@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });
    await prismaClient.intern.update({
      where: { id: intern.id },
      data: { end_date: new Date("2027-06-30") },
    });

    const removeResponse = await TestRequest.patch(
      `/api/admin/interns/delete/${intern.id}`,
      {},
      accessToken,
    );
    expect(removeResponse.status).toBe(200);

    const deleted = await prismaClient.intern.findUniqueOrThrow({
      where: { id: intern.id },
    });
    expect(deleted.deleted_at).not.toBeNull();
    expect(deleted.status).toBe(InternStatus.TERMINATED);

    const restoreResponse = await TestRequest.patch(
      `/api/admin/interns/restore/${intern.id}`,
      {},
      accessToken,
    );
    expect(restoreResponse.status).toBe(200);

    const restored = await prismaClient.intern.findUniqueOrThrow({
      where: { id: intern.id },
    });
    expect(restored.deleted_at).toBeNull();
    expect(restored.status).toBe(InternStatus.ACTIVE);
  });

  it("should reject (403) delete when requested by DATABASE_ADMIN", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
    );
    const intern = await InternTest.create({
      email: "test_intern_delete_forbidden@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      buildingId: masterData.building.id,
    });

    const response = await TestRequest.patch(
      `/api/admin/interns/delete/${intern.id}`,
      {},
      accessToken,
    );

    expect(response.status).toBe(403);
  });
});
