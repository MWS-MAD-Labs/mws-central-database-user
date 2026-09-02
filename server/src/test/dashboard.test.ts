import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AcademicYearTest,
  AdminUserTest,
  ClassTest,
  EmployeeTest,
  GradeTest,
  MasterDataTest,
  StudentTest,
  TestRequest,
} from "./test-utils";
import {
  ClassStatus,
  EmployeeStatus,
  Gender,
  type MasterBuilding,
  type MasterJobLevel,
  type MasterJobPosition,
  type MasterUnit,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";

describe("GET /api/dashboard/summary", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await cleanup();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns aggregate dashboard data for admin users", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    await seedDashboardRecords();

    const response = await TestRequest.get("/api/dashboard/summary", accessToken);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.totals.employees).toBeGreaterThanOrEqual(2);
    expect(body.data.totals.students).toBeGreaterThanOrEqual(1);
    expect(body.data.totals.classes).toBeGreaterThanOrEqual(1);
    expect(body.data.employees.by_gender.MALE).toBeGreaterThanOrEqual(1);
    expect(body.data.employees.by_gender.FEMALE).toBeGreaterThanOrEqual(1);
    expect(body.data.students.by_gender.FEMALE).toBeGreaterThanOrEqual(1);
    expect(body.data.employees.birthdays_this_month.length).toBeGreaterThan(0);
  });

  it("returns aggregate dashboard data for active employees", async () => {
    const { accessToken } = await EmployeeTest.createWithToken({
      email: "dashboard_employee@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
    });
    await seedDashboardRecords();

    const response = await TestRequest.get("/api/dashboard/summary", accessToken);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.totals.employees).toBeGreaterThanOrEqual(2);
    expect(body.data.employees.birthdays_this_month[0]).not.toHaveProperty(
      "mobile_phone",
    );
  });

  it("should count a mixed-age class toward every grade it teaches, not just its primary one", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );

    const primaryGrade = await prismaClient.grade.create({
      data: { name: "TEST_DASHBOARD_MIXED_PRIMARY", level: -9913 },
    });
    const additionalGrade = await prismaClient.grade.create({
      data: { name: "TEST_DASHBOARD_MIXED_ADDITIONAL", level: -9914 },
    });
    const academicYear = await AcademicYearTest.create();
    const mixedClass = await ClassTest.create({
      name: "TEST_DASHBOARD_MIXED_CLASS",
      gradeId: primaryGrade.id,
      academicYearId: academicYear.id,
      status: ClassStatus.ACTIVE,
    });
    await prismaClient.classAdditionalGrade.create({
      data: { class_id: mixedClass.id, grade_id: additionalGrade.id },
    });

    const response = await TestRequest.get("/api/dashboard/summary", accessToken);
    const body = await response.json();

    expect(response.status).toBe(200);
    const byGrade = body.data.classes.by_grade;
    const primaryEntry = byGrade.find(
      (entry: { grade_id: string }) => entry.grade_id === primaryGrade.id,
    );
    const additionalEntry = byGrade.find(
      (entry: { grade_id: string }) => entry.grade_id === additionalGrade.id,
    );
    expect(primaryEntry?.total).toBe(1);
    expect(additionalEntry?.total).toBe(1);
  });

  it("rejects unauthenticated requests", async () => {
    const response = await TestRequest.get("/api/dashboard/summary");
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.errors).toBeDefined();
  });

  async function seedDashboardRecords() {
    const now = new Date();
    const birthdayThisMonth = new Date(1992, now.getMonth(), 12);

    const employee = await EmployeeTest.create({
      email: "dashboard_birthday@millennia21.id",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
      status: EmployeeStatus.ACTIVE,
    });
    await prismaClient.person.update({
      where: { id: employee.id },
      data: { gender: Gender.FEMALE, birth_date: birthdayThisMonth },
    });

    await EmployeeTest.create({
      email: "dashboard_employee_male@millennia21.id",
      employeeId: "99.99.912",
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
      status: EmployeeStatus.ACTIVE,
    });

    const grade = await prismaClient.grade.create({
      data: { name: "TEST_DASHBOARD_GRADE", level: -9912 },
    });
    const academicYear = await AcademicYearTest.create();
    const klass = await ClassTest.create({
      name: "TEST_DASHBOARD_CLASS",
      gradeId: grade.id,
      academicYearId: academicYear.id,
      status: ClassStatus.ACTIVE,
    });

    const student = await StudentTest.create({
      email: "dashboard_student@millennia21.id",
      currentGradeId: grade.id,
      joinGradeId: grade.id,
      joinAcademicYearId: academicYear.id,
      currentClassId: klass.id,
    });
    await prismaClient.person.update({
      where: { id: student.id },
      data: { gender: Gender.FEMALE, birth_date: new Date("2015-01-01") },
    });
  }
});

async function cleanup() {
  await StudentTest.delete();
  await ClassTest.delete();
  await GradeTest.delete();
  await AcademicYearTest.delete();
  await AdminUserTest.delete();
  await EmployeeTest.delete();
  await MasterDataTest.delete();
}
