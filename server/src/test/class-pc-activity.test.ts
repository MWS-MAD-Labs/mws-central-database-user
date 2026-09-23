import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ClassStatus } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import {
  AcademicYearTest,
  AdminUserTest,
  AuditLogTest,
  ClassTest,
  GradeTest,
  MasterDataTest,
  PCActivityTest,
  StudentTest,
  TestRequest,
} from "./test-utils";

describe("Class PC Activity assignment", () => {
  async function cleanup() {
    // Broad @millennia21.id match (not just this file's own fixtures) -
    // StudentTest.delete()'s hard delete will FK-fail on any leftover
    // passion_connection_activities row for any test/manual-QA student.
    await PCActivityTest.delete();
    await prismaClient.classPassionConnectionActivity.deleteMany({
      where: { class: { name: { startsWith: "TEST_CLASS_PC_" } } },
    });
    await prismaClient.masterPCActivity.deleteMany({
      where: { name: { startsWith: "TEST_CLASS_PC_ACTIVITY_" } },
    });
    await AuditLogTest.delete();
    await ClassTest.delete();
    await StudentTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
    await AcademicYearTest.delete();
  }

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();
  });
  afterEach(cleanup);

  async function setup() {
    const gradeOne = await GradeTest.getByName("Grade 1");
    const academicYear = await AcademicYearTest.create();
    const academicYearId = academicYear.id;
    const klass = await ClassTest.create({
      name: `TEST_CLASS_PC_${Date.now()}`,
      gradeId: gradeOne.id,
      academicYearId,
      status: ClassStatus.ACTIVE,
    });
    const activity = await prismaClient.masterPCActivity.create({
      data: { name: `TEST_CLASS_PC_ACTIVITY_${Date.now()}` },
    });
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    return { klass, activity, accessToken };
  }

  it("assigns an activity to a class and lists it back", async () => {
    const { klass, activity, accessToken } = await setup();

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/pc-activities`,
      { activity_id: activity.id, day: "MONDAY" },
      accessToken,
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.activity_id).toBe(activity.id);
    expect(body.data.enrolled_count).toBe(0);
    expect(body.data.mentor_id).toBeNull();

    const listResponse = await TestRequest.get(
      `/api/admin/classes/${klass.id}/pc-activities`,
      accessToken,
    );
    const listBody = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0].id).toBe(body.data.id);
  });

  it("rejects (400) assigning an activity restricted to a different unit", async () => {
    const { klass, accessToken } = await setup();
    const otherUnit = await prismaClient.masterUnit.create({
      data: { name: `TEST_CLASS_PC_OTHER_UNIT_${Date.now()}` },
    });
    const restricted = await prismaClient.masterPCActivity.create({
      data: {
        name: `TEST_CLASS_PC_ACTIVITY_RESTRICTED_${Date.now()}`,
        units: { create: { unit_id: otherUnit.id } },
      },
    });

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/pc-activities`,
      { activity_id: restricted.id, day: "MONDAY" },
      accessToken,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errors).toContain("only available to");
    await prismaClient.masterUnit.delete({ where: { id: otherUnit.id } });
  });

  it("rejects (400) registering the same activity/day/year for a class twice", async () => {
    const { klass, activity, accessToken } = await setup();
    await TestRequest.post(
      `/api/admin/classes/${klass.id}/pc-activities`,
      { activity_id: activity.id, day: "MONDAY" },
      accessToken,
    );

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/pc-activities`,
      { activity_id: activity.id, day: "MONDAY" },
      accessToken,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errors).toContain("already registered");
  });

  it("bulk-enrolls students from the class roster and reports a per-item failure for a student off the roster", async () => {
    const { klass, activity, accessToken } = await setup();
    const onRoster = await StudentTest.create({
      email: "test_class_pc_on_roster@millennia21.id",
      currentClassId: klass.id,
    });
    const offRoster = await StudentTest.create({
      email: "test_class_pc_off_roster@millennia21.id",
    });

    const assignResponse = await TestRequest.post(
      `/api/admin/classes/${klass.id}/pc-activities`,
      { activity_id: activity.id, day: "TUESDAY" },
      accessToken,
    );
    const assignBody = await assignResponse.json();
    const classActivityId = assignBody.data.id;

    const response = await TestRequest.post(
      `/api/admin/classes/${klass.id}/pc-activities/${classActivityId}/students/bulk`,
      { student_ids: [onRoster.student!.id, offRoster.student!.id] },
      accessToken,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.success_count).toBe(1);
    expect(body.data.failed_count).toBe(1);
    const failedItem = body.data.items.find(
      (item: { status: string }) => item.status === "FAILED",
    );
    expect(failedItem.id).toBe(offRoster.student!.id);
    expect(failedItem.error).toContain("roster");

    const listResponse = await TestRequest.get(
      `/api/admin/classes/${klass.id}/pc-activities`,
      accessToken,
    );
    const listBody = await listResponse.json();
    expect(listBody.data[0].enrolled_count).toBe(1);
  });

  it("blocks removing an offering with enrolled students, then allows it once they're gone", async () => {
    const { klass, activity, accessToken } = await setup();
    const student = await StudentTest.create({
      email: "test_class_pc_remove_flow@millennia21.id",
      currentClassId: klass.id,
    });

    const assignResponse = await TestRequest.post(
      `/api/admin/classes/${klass.id}/pc-activities`,
      { activity_id: activity.id, day: "WEDNESDAY" },
      accessToken,
    );
    const classActivityId = (await assignResponse.json()).data.id;

    await TestRequest.post(
      `/api/admin/classes/${klass.id}/pc-activities/${classActivityId}/students/bulk`,
      { student_ids: [student.student!.id] },
      accessToken,
    );

    const blockedResponse = await TestRequest.delete(
      `/api/admin/classes/${klass.id}/pc-activities/${classActivityId}`,
      accessToken,
    );
    expect(blockedResponse.status).toBe(400);

    const enrollment = await prismaClient.passionConnectionActivity.findFirstOrThrow({
      where: { student_id: student.student!.id, class_activity_id: classActivityId },
    });
    await prismaClient.passionConnectionActivity.update({
      where: { id: enrollment.id },
      data: { deleted_at: new Date() },
    });

    const okResponse = await TestRequest.delete(
      `/api/admin/classes/${klass.id}/pc-activities/${classActivityId}`,
      accessToken,
    );
    expect(okResponse.status).toBe(200);
  });

  it("roster-status excludes an already-enrolled student and flags a conflict from a different offering on a different day", async () => {
    const { klass, activity, accessToken } = await setup();
    const otherActivity = await prismaClient.masterPCActivity.create({
      data: { name: `TEST_CLASS_PC_ACTIVITY_OTHER_${Date.now()}` },
    });
    const enrolledStudent = await StudentTest.create({
      email: "test_class_pc_rs_enrolled@millennia21.id",
      currentClassId: klass.id,
    });
    const conflictedStudent = await StudentTest.create({
      email: "test_class_pc_rs_conflict@millennia21.id",
      currentClassId: klass.id,
    });
    const freeStudent = await StudentTest.create({
      email: "test_class_pc_rs_free@millennia21.id",
      currentClassId: klass.id,
    });

    const mondayOffering = (
      await (
        await TestRequest.post(
          `/api/admin/classes/${klass.id}/pc-activities`,
          { activity_id: activity.id, day: "MONDAY" },
          accessToken,
        )
      ).json()
    ).data;
    // Deliberately a DIFFERENT day - one PC activity per student per
    // academic year now, so this must still count as a conflict.
    const otherTuesdayOffering = (
      await (
        await TestRequest.post(
          `/api/admin/classes/${klass.id}/pc-activities`,
          { activity_id: otherActivity.id, day: "TUESDAY" },
          accessToken,
        )
      ).json()
    ).data;

    await TestRequest.post(
      `/api/admin/classes/${klass.id}/pc-activities/${mondayOffering.id}/students/bulk`,
      { student_ids: [enrolledStudent.student!.id] },
      accessToken,
    );
    await TestRequest.post(
      `/api/admin/classes/${klass.id}/pc-activities/${otherTuesdayOffering.id}/students/bulk`,
      { student_ids: [conflictedStudent.student!.id] },
      accessToken,
    );

    const response = await TestRequest.get(
      `/api/admin/classes/${klass.id}/pc-activities/${mondayOffering.id}/roster-status`,
      accessToken,
    );
    const body = await response.json();
    expect(response.status).toBe(200);

    type RosterStatusEntry = {
      student_id: string;
      already_enrolled: boolean;
      other_activity: { activity_name: string; day: string; class_activity_id: string | null } | null;
    };
    const statusById = new Map<string, RosterStatusEntry>(
      body.data.map((entry: RosterStatusEntry) => [entry.student_id, entry]),
    );
    expect(statusById.get(enrolledStudent.student!.id)!.already_enrolled).toBe(true);
    expect(statusById.get(enrolledStudent.student!.id)!.other_activity).toBeNull();

    expect(statusById.get(conflictedStudent.student!.id)!.already_enrolled).toBe(false);
    expect(statusById.get(conflictedStudent.student!.id)!.other_activity!.activity_name).toBe(
      otherActivity.name,
    );
    expect(statusById.get(conflictedStudent.student!.id)!.other_activity!.day).toBe("TUESDAY");

    expect(statusById.get(freeStudent.student!.id)!.already_enrolled).toBe(false);
    expect(statusById.get(freeStudent.student!.id)!.other_activity).toBeNull();
  });

  it("rejects (400) enrolling a student who already has a PC activity on a different day this year", async () => {
    const { klass, activity, accessToken } = await setup();
    const otherActivity = await prismaClient.masterPCActivity.create({
      data: { name: `TEST_CLASS_PC_ACTIVITY_OTHER_${Date.now()}` },
    });
    const student = await StudentTest.create({
      email: "test_class_pc_one_per_year@millennia21.id",
      currentClassId: klass.id,
    });

    const mondayOffering = (
      await (
        await TestRequest.post(
          `/api/admin/classes/${klass.id}/pc-activities`,
          { activity_id: activity.id, day: "MONDAY" },
          accessToken,
        )
      ).json()
    ).data;
    const tuesdayOffering = (
      await (
        await TestRequest.post(
          `/api/admin/classes/${klass.id}/pc-activities`,
          { activity_id: otherActivity.id, day: "TUESDAY" },
          accessToken,
        )
      ).json()
    ).data;

    const first = await TestRequest.post(
      `/api/admin/classes/${klass.id}/pc-activities/${mondayOffering.id}/students/bulk`,
      { student_ids: [student.student!.id] },
      accessToken,
    );
    expect((await first.json()).data.success_count).toBe(1);

    const second = await TestRequest.post(
      `/api/admin/classes/${klass.id}/pc-activities/${tuesdayOffering.id}/students/bulk`,
      { student_ids: [student.student!.id] },
      accessToken,
    );
    const secondBody = await second.json();
    expect(secondBody.data.failed_count).toBe(1);
    expect(secondBody.data.items[0].error).toContain("already has a PC activity");
  });

  it("lists enrolled students including removed ones, and flags a student who left the class", async () => {
    const { klass, activity, accessToken } = await setup();
    const gradeOne = await GradeTest.getByName("Grade 1");
    const academicYearId = await StudentTest.resolveAcademicYearId();
    const otherClass = await ClassTest.create({
      name: `TEST_CLASS_PC_OTHER_${Date.now()}`,
      gradeId: gradeOne.id,
      academicYearId,
      status: ClassStatus.ACTIVE,
    });
    const staying = await StudentTest.create({
      email: "test_class_pc_es_staying@millennia21.id",
      currentClassId: klass.id,
    });
    const leaving = await StudentTest.create({
      email: "test_class_pc_es_leaving@millennia21.id",
      currentClassId: klass.id,
    });
    const removed = await StudentTest.create({
      email: "test_class_pc_es_removed@millennia21.id",
      currentClassId: klass.id,
    });

    const offering = (
      await (
        await TestRequest.post(
          `/api/admin/classes/${klass.id}/pc-activities`,
          { activity_id: activity.id, day: "THURSDAY" },
          accessToken,
        )
      ).json()
    ).data;

    await TestRequest.post(
      `/api/admin/classes/${klass.id}/pc-activities/${offering.id}/students/bulk`,
      { student_ids: [staying.student!.id, leaving.student!.id, removed.student!.id] },
      accessToken,
    );

    // Simulate leaving.student having been promoted/transferred elsewhere.
    await prismaClient.student.update({
      where: { id: leaving.student!.id },
      data: { current_class_id: otherClass.id },
    });
    const removedEnrollment = await prismaClient.passionConnectionActivity.findFirstOrThrow({
      where: { student_id: removed.student!.id, class_activity_id: offering.id },
    });
    await prismaClient.passionConnectionActivity.update({
      where: { id: removedEnrollment.id },
      data: { deleted_at: new Date() },
    });

    const response = await TestRequest.get(
      `/api/admin/classes/${klass.id}/pc-activities/${offering.id}/students`,
      accessToken,
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(3);

    type EnrolledStudentEntry = {
      student_id: string;
      deleted_at: string | null;
      still_on_roster: boolean;
    };
    const byStudentId = new Map<string, EnrolledStudentEntry>(
      body.data.map((entry: EnrolledStudentEntry) => [entry.student_id, entry]),
    );
    expect(byStudentId.get(staying.student!.id)!.deleted_at).toBeNull();
    expect(byStudentId.get(staying.student!.id)!.still_on_roster).toBe(true);

    expect(byStudentId.get(leaving.student!.id)!.deleted_at).toBeNull();
    expect(byStudentId.get(leaving.student!.id)!.still_on_roster).toBe(false);

    expect(byStudentId.get(removed.student!.id)!.deleted_at).not.toBeNull();

    // enrolled_count on the offering card should only count staying -
    // leaving kept an active row (never auto-removed) but left the roster,
    // and removed was explicitly soft-deleted above.
    const listResponse = await TestRequest.get(
      `/api/admin/classes/${klass.id}/pc-activities`,
      accessToken,
    );
    const listBody = await listResponse.json();
    expect(
      listBody.data.find((item: { id: string }) => item.id === offering.id).enrolled_count,
    ).toBe(1);
  });
});
