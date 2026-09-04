import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  AdminUserTest,
  AcademicYearTest,
  AuditLogTest,
  MasterDataTest,
  StudentTest,
} from "./test-utils";
import { AuditAction, Gender, Religion } from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("Student Mutation History", () => {
  let studentId: string;
  let gradeId: string;
  let secondGradeId: string;
  let academicYearId: string;
  let secondAcademicYearId: string;
  let superAdminToken: string;

  async function cleanup() {
    await AuditLogTest.delete();
    await StudentTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_STU_HIST_GRADE" } },
    });
    await prismaClient.academicYear.deleteMany({
      where: { name: { in: ["2099/2100", "2100/2101", "2101/2102"] } },
    });
  }

  beforeEach(async () => {
    await cleanup();
    const masterData = await MasterDataTest.create();

    const grade = await prismaClient.grade.create({
      data: {
        name: "TEST_STU_HIST_GRADE1",
        level: 9201,
        unit_id: masterData.unit.id,
      },
    });
    gradeId = grade.id;
    // Lower level than gradeId - join_grade must never exceed current_grade
    // (current_grade_id stays on gradeId throughout this test), so the
    // "change join_grade" tests need somewhere valid to move it to.
    const secondGrade = await prismaClient.grade.create({
      data: {
        name: "TEST_STU_HIST_GRADE0",
        level: 9200,
        unit_id: masterData.unit.id,
      },
    });
    secondGradeId = secondGrade.id;

    const academicYear = await prismaClient.academicYear.create({
      data: { name: "2099/2100", start_date: new Date("2099-07-01") },
    });
    academicYearId = academicYear.id;
    // COMPLETED, not the schema default UPCOMING - most of this file's
    // join_grade edits leave current_grade fixed one level above join_grade,
    // which tooFarAheadMessage (checked on update() too, now) needs at least
    // one elapsed academic year after the effective join year to justify.
    // This file isn't testing that check, so give it something to find -
    // one COMPLETED year after each of academicYearId and secondAcademicYearId
    // (whichever a test moves join_academic_year_id to).
    const secondAcademicYear = await prismaClient.academicYear.create({
      data: {
        name: "2100/2101",
        start_date: new Date("2100-07-01"),
        status: "COMPLETED",
      },
    });
    await prismaClient.academicYear.create({
      data: {
        name: "2101/2102",
        start_date: new Date("2101-07-01"),
        status: "COMPLETED",
      },
    });
    secondAcademicYearId = secondAcademicYear.id;

    const { accessToken } = await AdminUserTest.createSuperAdmin(
      masterData.unit.id,
    );
    superAdminToken = accessToken;

    const response = await TestRequest.post(
      "/api/admin/students",
      {
        full_name: "Test Student History",
        nick_name: "Stu History",
        email: "test_stu_history@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2012-01-01").toISOString(),
        nis: "9200001",
        entry_type: "PSB",
        current_grade_id: gradeId,
        join_academic_year_id: academicYearId,
        join_grade_id: gradeId,
      },
      accessToken,
    );
    const body = await response.json();
    studentId = body.data.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should seed one baseline history row per tracked field on create", async () => {
    const rows = await prismaClient.studentMutationHistory.findMany({
      where: { student_id: studentId },
    });

    expect(rows.length).toBe(3);
    const fields = rows.map((r) => r.field as string).sort();
    expect(fields).toEqual(
      ["ENTRY_TYPE", "JOIN_ACADEMIC_YEAR", "JOIN_GRADE"].sort(),
    );
    for (const row of rows) {
      expect(row.end_date).toBeNull();
      expect(row.previous_history_id).toBeNull();
    }
  });

  it("should create a new history row and close the previous one when join_grade_id changes", async () => {
    const response = await TestRequest.patch(
      `/api/admin/students/${studentId}`,
      { join_grade_id: secondGradeId },
      superAdminToken,
    );
    expect(response.status).toBe(200);

    const rows = await prismaClient.studentMutationHistory.findMany({
      where: { student_id: studentId, field: "JOIN_GRADE" },
      orderBy: { created_at: "asc" },
    });

    expect(rows.length).toBe(2);
    expect(rows[0].join_grade_id).toBe(gradeId);
    expect(rows[0].end_date).not.toBeNull();
    expect(rows[1].join_grade_id).toBe(secondGradeId);
    expect(rows[1].end_date).toBeNull();
    expect(rows[1].previous_history_id).toBe(rows[0].id);

    // Unrelated fields shouldn't grow a second row.
    const entryTypeRows = await prismaClient.studentMutationHistory.findMany({
      where: { student_id: studentId, field: "ENTRY_TYPE" },
    });
    expect(entryTypeRows.length).toBe(1);
  });

  it("should create two separate rows when join_grade_id and join_academic_year_id change in the same update() call", async () => {
    const response = await TestRequest.patch(
      `/api/admin/students/${studentId}`,
      {
        join_grade_id: secondGradeId,
        join_academic_year_id: secondAcademicYearId,
      },
      superAdminToken,
    );
    expect(response.status).toBe(200);

    const gradeRows = await prismaClient.studentMutationHistory.findMany({
      where: { student_id: studentId, field: "JOIN_GRADE" },
    });
    const yearRows = await prismaClient.studentMutationHistory.findMany({
      where: { student_id: studentId, field: "JOIN_ACADEMIC_YEAR" },
    });

    expect(gradeRows.length).toBe(2);
    expect(yearRows.length).toBe(2);
  });

  it("should self-heal a legacy student with zero tracked history: the first real update seeds a genesis row too", async () => {
    // Simulates data that predates mutation-history tracking - a real
    // student row with a real live value, but zero StudentMutationHistory
    // rows for it (create()'s own seeding never ran).
    const legacyPerson = await prismaClient.person.create({
      data: {
        full_name: "Legacy Student",
        nick_name: "Legacy",
        email: "test_stu_legacy_no_history@millennia21.id",
        person_type: "STUDENT",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2012-01-01"),
        student: {
          create: {
            nis: "9200099",
            current_grade_id: gradeId,
            join_grade_id: gradeId,
            join_academic_year_id: academicYearId,
            entry_type: "PSB",
          },
        },
      },
      include: { student: true },
    });
    const legacyStudentId = legacyPerson.student!.id;

    const preUpdateHistoryCount = await prismaClient.studentMutationHistory.count(
      { where: { student_id: legacyStudentId } },
    );
    expect(preUpdateHistoryCount).toBe(0);

    const response = await TestRequest.patch(
      `/api/admin/students/${legacyStudentId}`,
      { join_grade_id: secondGradeId },
      superAdminToken,
    );
    expect(response.status).toBe(200);

    const rows = await prismaClient.studentMutationHistory.findMany({
      where: { student_id: legacyStudentId, field: "JOIN_GRADE" },
      orderBy: { created_at: "asc" },
    });
    logger.debug(rows);

    // Two rows now, not one - the synthesized genesis (the old join grade,
    // immediately closed) plus the real new one, linked together.
    expect(rows.length).toBe(2);
    expect(rows[0].join_grade_id).toBe(gradeId);
    expect(rows[0].previous_history_id).toBeNull();
    expect(rows[0].end_date).not.toBeNull();
    expect(rows[1].join_grade_id).toBe(secondGradeId);
    expect(rows[1].previous_history_id).toBe(rows[0].id);
    expect(rows[1].end_date).toBeNull();

    // Confirms this isn't just cosmetic - rollback (previously impossible
    // for this student's JOIN_GRADE field, since nothing was ever tracked)
    // now actually works.
    const rollbackResponse = await TestRequest.patch(
      `/api/admin/students/${legacyStudentId}/mutation-history/${rows[1].id}/rollback`,
      {},
      superAdminToken,
    );
    const rollbackBody = await rollbackResponse.json();
    logger.debug(rollbackBody);
    expect(rollbackResponse.status).toBe(200);

    const rolledBackStudent = await prismaClient.student.findUniqueOrThrow({
      where: { id: legacyStudentId },
    });
    expect(rolledBackStudent.join_grade_id).toBe(gradeId);
  });

  it("should not synthesize a genesis row for a field that's never actually changed", async () => {
    const gradeRows = await prismaClient.studentMutationHistory.findMany({
      where: { student_id: studentId, field: "JOIN_GRADE" },
    });
    expect(gradeRows.length).toBe(1);

    const response = await TestRequest.patch(
      `/api/admin/students/${studentId}`,
      { full_name: "Renamed Student" },
      superAdminToken,
    );
    expect(response.status).toBe(200);

    const gradeRowsAfter = await prismaClient.studentMutationHistory.findMany(
      { where: { student_id: studentId, field: "JOIN_GRADE" } },
    );
    expect(gradeRowsAfter.length).toBe(1);
  });

  describe("GET /api/admin/students/:id/mutation-history", () => {
    it("should list history with can_rollback true only on the current, non-baseline row", async () => {
      await TestRequest.patch(
        `/api/admin/students/${studentId}`,
        { join_grade_id: secondGradeId },
        superAdminToken,
      );

      const response = await TestRequest.get(
        `/api/admin/students/${studentId}/mutation-history`,
        superAdminToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      const gradeEntries = body.data.filter(
        (e: { field: string }) => e.field === "JOIN_GRADE",
      );
      expect(gradeEntries.length).toBe(2);
      const current = gradeEntries.find(
        (e: { end_date: null }) => e.end_date === null,
      );
      const closed = gradeEntries.find(
        (e: { end_date: null }) => e.end_date !== null,
      );
      expect(current.can_rollback).toBe(true);
      expect(current.value).toBe("TEST_STU_HIST_GRADE0");
      expect(closed.can_rollback).toBe(false);

      const entryTypeEntry = body.data.find(
        (e: { field: string }) => e.field === "ENTRY_TYPE",
      );
      expect(entryTypeEntry.can_rollback).toBe(false); // baseline row, no previous
    });

    it("should reject (401) with no access token", async () => {
      const response = await TestRequest.get(
        `/api/admin/students/${studentId}/mutation-history`,
      );
      expect(response.status).toBe(401);
    });
  });

  describe("PATCH /api/admin/students/:id/mutation-history/:historyId/rollback", () => {
    it("should restore the previous value on the live student record and audit it", async () => {
      const admin = await prismaClient.adminUser.findUniqueOrThrow({
        where: { email: "test_superadmin@millennia21.id" },
      });
      await TestRequest.patch(
        `/api/admin/students/${studentId}`,
        { join_grade_id: secondGradeId },
        superAdminToken,
      );

      const currentRow =
        await prismaClient.studentMutationHistory.findFirstOrThrow({
          where: { student_id: studentId, field: "JOIN_GRADE", end_date: null },
        });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/mutation-history/${currentRow.id}/rollback`,
        {},
        superAdminToken,
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data).toBe(true);

      const student = await prismaClient.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      expect(student.join_grade_id).toBe(gradeId);

      const rolledBack = await prismaClient.studentMutationHistory.findUnique(
        { where: { id: currentRow.id } },
      );
      expect(rolledBack?.deleted_at).not.toBeNull();

      const reactivated = await prismaClient.studentMutationHistory.findFirst(
        {
          where: { student_id: studentId, field: "JOIN_GRADE", deleted_at: null },
        },
      );
      expect(reactivated?.join_grade_id).toBe(gradeId);
      expect(reactivated?.end_date).toBeNull();

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: {
          action: AuditAction.ROLLBACK_STUDENT_MUTATION,
          admin_id: admin.id,
        },
      });
      expect(auditLog.entity_type).toBe("Student");
      expect(auditLog.entity_id).toBe(studentId);
    });

    it("should reject (400) rolling back a baseline row with no previous_history_id", async () => {
      const baselineRow =
        await prismaClient.studentMutationHistory.findFirstOrThrow({
          where: { student_id: studentId, field: "JOIN_GRADE" },
        });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/mutation-history/${baselineRow.id}/rollback`,
        {},
        superAdminToken,
      );

      expect(response.status).toBe(400);
    });

    it("should reject (400) rolling back an already-closed (non-current) row", async () => {
      await TestRequest.patch(
        `/api/admin/students/${studentId}`,
        { join_grade_id: secondGradeId },
        superAdminToken,
      );
      const closedRow =
        await prismaClient.studentMutationHistory.findFirstOrThrow({
          where: {
            student_id: studentId,
            field: "JOIN_GRADE",
            end_date: { not: null },
          },
        });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/mutation-history/${closedRow.id}/rollback`,
        {},
        superAdminToken,
      );

      expect(response.status).toBe(400);
    });

    it("should restore the grade-consistency override reason that was in effect when the rolled-back-to value was active", async () => {
      // gradeId (level 9201) as join_grade_id vs secondGradeId (level 9200,
      // lower) as current_grade_id triggers the "current grade cannot be
      // lower than join grade" check - the exact real-world case this test
      // reproduces (a Super-Admin-approved "Sheet mismatch" import).
      const mismatchedStudent = await TestRequest.post(
        "/api/admin/students",
        {
          full_name: "Test Mismatch Rollback",
          nick_name: "Mismatch",
          email: "test_stu_mismatch_rollback@millennia21.id",
          gender: Gender.MALE,
          religion: Religion.ISLAM,
          birth_place: "Jakarta",
          birth_date: new Date("2012-01-01").toISOString(),
          nis: "9200088",
          entry_type: "PSB",
          current_grade_id: secondGradeId,
          join_academic_year_id: academicYearId,
          join_grade_id: gradeId,
          override_too_far_ahead_reason: "Sheet mismatch",
        },
        superAdminToken,
      );
      expect(mismatchedStudent.status).toBe(200);
      const mismatchedStudentId = (await mismatchedStudent.json()).data.id;

      const created = await prismaClient.student.findUniqueOrThrow({
        where: { id: mismatchedStudentId },
      });
      expect(created.grade_consistency_override_reason).toBe(
        "Sheet mismatch",
      );

      // Fix it: move join_grade_id down to match current_grade_id - this
      // self-clears the override reason on the live record (correct), and
      // used to lose it for good even if later rolled back (the bug).
      const fixResponse = await TestRequest.patch(
        `/api/admin/students/${mismatchedStudentId}`,
        { join_grade_id: secondGradeId },
        superAdminToken,
      );
      expect(fixResponse.status).toBe(200);

      const fixed = await prismaClient.student.findUniqueOrThrow({
        where: { id: mismatchedStudentId },
      });
      expect(fixed.grade_consistency_override_reason).toBeNull();

      const currentRow =
        await prismaClient.studentMutationHistory.findFirstOrThrow({
          where: {
            student_id: mismatchedStudentId,
            field: "JOIN_GRADE",
            end_date: null,
          },
        });

      const rollbackResponse = await TestRequest.patch(
        `/api/admin/students/${mismatchedStudentId}/mutation-history/${currentRow.id}/rollback`,
        {},
        superAdminToken,
      );
      expect(rollbackResponse.status).toBe(200);

      const rolledBack = await prismaClient.student.findUniqueOrThrow({
        where: { id: mismatchedStudentId },
      });
      expect(rolledBack.join_grade_id).toBe(gradeId);
      expect(rolledBack.grade_consistency_override_reason).toBe(
        "Sheet mismatch",
      );
    });

    it("should reject (403) for VIEWER", async () => {
      const { accessToken } = await AdminUserTest.createViewer();
      const currentRow =
        await prismaClient.studentMutationHistory.findFirstOrThrow({
          where: { student_id: studentId, field: "JOIN_GRADE" },
        });

      const response = await TestRequest.patch(
        `/api/admin/students/${studentId}/mutation-history/${currentRow.id}/rollback`,
        {},
        accessToken,
      );

      expect(response.status).toBe(403);
    });
  });
});
