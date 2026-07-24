import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  MasterDataTest,
  StudentTest,
  ClassTest,
  EnrollmentTest,
  HealthRecordTest,
  HealthNoteTest,
  ConsentTest,
  ApiClientTest,
  AuditLogTest,
} from "./test-utils";
import {
  AuditAction,
  ClassStatus,
  ConsentStatus,
  ConsentType,
  EnrollmentStatus,
  HealthNoteCategory,
  StudentStatus,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

const READ_SCOPE = "students:read";
const HISTORY_SCOPE = "students:academic_history:read";
const HEALTH_SCOPE = "students:health:read";
const CONSENT_SCOPE = "students:consent:read";

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function cleanup() {
  await AuditLogTest.delete();
  await ConsentTest.delete();
  await HealthNoteTest.delete();
  await HealthRecordTest.delete();
  await EnrollmentTest.delete();
  await ApiClientTest.delete();
  await StudentTest.delete();
  await prismaClient.class.deleteMany({
    where: { name: { startsWith: "TEST_STUAPI_" } },
  });
  await prismaClient.grade.deleteMany({
    where: { name: { startsWith: "TEST_STUAPI_" } },
  });
  await prismaClient.academicYear.deleteMany({
    where: { name: { startsWith: "TEST_STUAPI_" } },
  });
  await MasterDataTest.delete();
}

describe("Student internal API", () => {
  let gradeId: string;
  let academicYearId: string;
  let classId: string;

  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();

    const grade = await prismaClient.grade.create({
      data: { name: "TEST_STUAPI_GRADE", level: 9401 },
    });
    gradeId = grade.id;

    const year = await prismaClient.academicYear.create({
      data: { name: "TEST_STUAPI_YEAR", status: "UPCOMING" },
    });
    academicYearId = year.id;

    const klass = await ClassTest.create({
      name: "TEST_STUAPI_CLASS",
      gradeId,
      academicYearId,
      status: ClassStatus.ACTIVE,
    });
    classId = klass.id;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("GET /api/internal/students/lookup", () => {
    it("should return a minimal active student profile for a valid token with the right scope", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      const person = await StudentTest.create({
        email: "lookup_me@millennia21.id",
        nis: "9500101",
        status: StudentStatus.ACTIVE,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
        currentClassId: classId,
      });

      const response = await TestRequest.get(
        "/api/internal/students/lookup?nis=9500101",
        undefined,
        authHeader(token),
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(person.student!.id);
      expect(body.data.nis).toBe("9500101");
      expect(body.data.current_grade).toBe("TEST_STUAPI_GRADE");
      expect(body.data.current_class).toBe("TEST_STUAPI_CLASS");
      expect(body.data.status).toBe(StudentStatus.ACTIVE);

      // Lean contract - no sensitive/admin-only fields leak through.
      expect(body.data.gender).toBeUndefined();
      expect(body.data.religion).toBeUndefined();
      expect(body.data.birth_date).toBeUndefined();
      expect(body.data.parents).toBeUndefined();
    });

    it("should also accept lookup by email", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      await StudentTest.create({
        email: "lookup_by_email@millennia21.id",
        nis: "9500102",
        status: StudentStatus.ACTIVE,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });

      const response = await TestRequest.get(
        "/api/internal/students/lookup?email=lookup_by_email@millennia21.id",
        undefined,
        authHeader(token),
      );
      expect(response.status).toBe(200);
    });

    it("should record last_used_at on the calling client after a successful request", async () => {
      const { client, token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      await StudentTest.create({
        email: "track_usage@millennia21.id",
        nis: "9500103",
        status: StudentStatus.ACTIVE,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });

      expect(client.last_used_at).toBeNull();

      await TestRequest.get(
        "/api/internal/students/lookup?nis=9500103",
        undefined,
        authHeader(token),
      );

      const updated = await prismaClient.apiClient.findUnique({
        where: { id: client.id },
      });
      expect(updated?.last_used_at).not.toBeNull();
    });

    it("should reject if no Authorization header is provided", async () => {
      const response = await TestRequest.get(
        "/api/internal/students/lookup?nis=9500104",
      );
      expect(response.status).toBe(401);
    });

    it("should reject a client that lacks the students:read scope", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: ["some_other:scope"],
      });

      const response = await TestRequest.get(
        "/api/internal/students/lookup?nis=9500105",
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.errors).toContain("students:read");
    });

    it("should reject if neither nis nor email query parameter is given", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });

      const response = await TestRequest.get(
        "/api/internal/students/lookup",
        undefined,
        authHeader(token),
      );

      expect(response.status).toBe(400);
    });

    it("should return 404 for a nis with no matching active student", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });

      const response = await TestRequest.get(
        "/api/internal/students/lookup?nis=9999999",
        undefined,
        authHeader(token),
      );

      expect(response.status).toBe(404);
    });

    it("should return 404 for a student that is not ACTIVE", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      await StudentTest.create({
        email: "registered_lookup@millennia21.id",
        nis: "9500106",
        status: StudentStatus.REGISTERED,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });

      const response = await TestRequest.get(
        "/api/internal/students/lookup?nis=9500106",
        undefined,
        authHeader(token),
      );

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/internal/students/:id/academic-history", () => {
    it("should return enrollment history for a client with the history scope", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [HISTORY_SCOPE],
      });
      const person = await StudentTest.create({
        email: "history_me@millennia21.id",
        nis: "9500201",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });
      await EnrollmentTest.create({
        studentId: person.student!.id,
        classId,
        academicYearId,
        gradeLevel: "TEST_STUAPI_GRADE",
        classNameSnapshot: "TEST_STUAPI_CLASS",
        status: EnrollmentStatus.ACTIVE,
      });

      const response = await TestRequest.get(
        `/api/internal/students/${person.student!.id}/academic-history`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].class_name).toBe("TEST_STUAPI_CLASS");
      expect(body.data[0].enrollment_status).toBe(EnrollmentStatus.ACTIVE);
    });

    it("should reject a client that lacks the academic_history scope", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      const person = await StudentTest.create({
        email: "history_forbidden@millennia21.id",
        nis: "9500202",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });

      const response = await TestRequest.get(
        `/api/internal/students/${person.student!.id}/academic-history`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.errors).toContain("students:academic_history:read");
    });

    it("should return 404 for a nonexistent student", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [HISTORY_SCOPE],
      });

      const response = await TestRequest.get(
        "/api/internal/students/nonexistent-id/academic-history",
        undefined,
        authHeader(token),
      );

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/internal/students/:id/health", () => {
    it("should return health data for a client with the health scope, and audit the access", async () => {
      const { client, token } = await ApiClientTest.createWithToken({
        scopeNames: [HEALTH_SCOPE],
      });
      const person = await StudentTest.create({
        email: "health_me@millennia21.id",
        nis: "9500301",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });
      await HealthRecordTest.create({
        studentId: person.student!.id,
        bloodType: "AB",
        needsAssistance: true,
      });
      await HealthNoteTest.create({
        studentId: person.student!.id,
        category: HealthNoteCategory.HEALTH_INFO,
        description: "Peanut allergy",
      });

      const response = await TestRequest.get(
        `/api/internal/students/${person.student!.id}/health`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.blood_type).toBe("AB");
      expect(body.data.needs_assistance).toBe(true);
      expect(body.data.notes.length).toBe(1);
      expect(body.data.notes[0].description).toBe("Peanut allergy");

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: {
          action: AuditAction.ACCESS_HEALTH_DATA,
          api_client_id: client.id,
        },
      });
      expect(auditLog.entity_type).toBe("Student");
      expect(auditLog.entity_id).toBe(person.student!.id);
    });

    it("should reject a client that lacks the health scope", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      const person = await StudentTest.create({
        email: "health_forbidden@millennia21.id",
        nis: "9500302",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });

      const response = await TestRequest.get(
        `/api/internal/students/${person.student!.id}/health`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.errors).toContain("students:health:read");
    });

    it("should audit a health access attempt even when the student is not found", async () => {
      const { client, token } = await ApiClientTest.createWithToken({
        scopeNames: [HEALTH_SCOPE],
      });

      const response = await TestRequest.get(
        "/api/internal/students/nonexistent-id/health",
        undefined,
        authHeader(token),
      );

      expect(response.status).toBe(404);

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: {
          action: AuditAction.ACCESS_HEALTH_DATA,
          api_client_id: client.id,
        },
      });
      expect(auditLog.new_values).toMatchObject({ found: false });
    });
  });

  describe("GET /api/internal/students (list)", () => {
    it("should return a paginated, lean list of students with the success envelope", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      await StudentTest.create({
        email: "list_one@millennia21.id",
        nis: "9500401",
        status: StudentStatus.ACTIVE,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
        currentClassId: classId,
      });
      await StudentTest.create({
        email: "list_two@millennia21.id",
        nis: "9500402",
        status: StudentStatus.ACTIVE,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });

      const response = await TestRequest.get(
        `/api/internal/students?current_grade_id=${gradeId}`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(2);
      expect(body.paging.total_item).toBe(2);
      expect(body.data[0].email).toBeDefined();
      expect(body.data[0].gender).toBeUndefined();
    });

    it("should default to ACTIVE students only when no status filter is given", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      await StudentTest.create({
        email: "default_active@millennia21.id",
        nis: "9500420",
        status: StudentStatus.ACTIVE,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });
      await StudentTest.create({
        email: "default_registered@millennia21.id",
        nis: "9500421",
        status: StudentStatus.REGISTERED,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });

      const response = await TestRequest.get(
        `/api/internal/students?current_grade_id=${gradeId}`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].nis).toBe("9500420");
    });

    it("should return non-ACTIVE students when status is explicitly requested", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      await StudentTest.create({
        email: "explicit_registered@millennia21.id",
        nis: "9500422",
        status: StudentStatus.REGISTERED,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });

      const response = await TestRequest.get(
        `/api/internal/students?current_grade_id=${gradeId}&status=REGISTERED`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].nis).toBe("9500422");
    });

    it("should filter by status", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      await StudentTest.create({
        email: "list_active@millennia21.id",
        nis: "9500403",
        status: StudentStatus.ACTIVE,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
        currentClassId: classId,
      });
      await StudentTest.create({
        email: "list_registered@millennia21.id",
        nis: "9500404",
        status: StudentStatus.REGISTERED,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });

      const response = await TestRequest.get(
        `/api/internal/students?status=ACTIVE&current_grade_id=${gradeId}`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].nis).toBe("9500403");
    });

    it("should filter by current_grade_id", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      const otherGrade = await prismaClient.grade.create({
        data: { name: "TEST_STUAPI_OTHER_GRADE", level: 9402 },
      });
      await StudentTest.create({
        email: "grade_a@millennia21.id",
        nis: "9500405",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });
      await StudentTest.create({
        email: "grade_b@millennia21.id",
        nis: "9500406",
        currentGradeId: otherGrade.id,
        joinGradeId: otherGrade.id,
        joinAcademicYearId: academicYearId,
      });

      const response = await TestRequest.get(
        `/api/internal/students?current_grade_id=${gradeId}`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].nis).toBe("9500405");
    });

    it("should filter by current_class_id", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      const otherClass = await ClassTest.create({
        name: "TEST_STUAPI_OTHER_CLASS",
        gradeId,
        academicYearId,
        status: ClassStatus.ACTIVE,
      });
      await StudentTest.create({
        email: "class_a@millennia21.id",
        nis: "9500407",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
        currentClassId: classId,
      });
      await StudentTest.create({
        email: "class_b@millennia21.id",
        nis: "9500408",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
        currentClassId: otherClass.id,
      });

      const response = await TestRequest.get(
        `/api/internal/students?current_class_id=${classId}`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].nis).toBe("9500407");
    });

    it("should filter by academic_year_id via the student's active enrollment", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      const otherYear = await prismaClient.academicYear.create({
        data: { name: "TEST_STUAPI_OTHER_YEAR", status: "UPCOMING" },
      });
      const enrolledPerson = await StudentTest.create({
        email: "enrolled_this_year@millennia21.id",
        nis: "9500409",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });
      await EnrollmentTest.create({
        studentId: enrolledPerson.student!.id,
        classId,
        academicYearId,
        gradeLevel: "TEST_STUAPI_GRADE",
        status: EnrollmentStatus.ACTIVE,
      });
      // Joined this year on paper, but never actually enrolled in it - the
      // academic_year_id filter is about active enrollment, not join year.
      await StudentTest.create({
        email: "joined_but_not_enrolled@millennia21.id",
        nis: "9500410",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });

      const response = await TestRequest.get(
        `/api/internal/students?academic_year_id=${academicYearId}`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].nis).toBe("9500409");

      // Sanity: the other year has nobody actively enrolled in it.
      const otherYearResponse = await TestRequest.get(
        `/api/internal/students?academic_year_id=${otherYear.id}`,
        undefined,
        authHeader(token),
      );
      const otherYearBody = await otherYearResponse.json();
      expect(otherYearBody.data.length).toBe(0);
    });

    it("should exclude soft-deleted students", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      const kept = await StudentTest.create({
        email: "list_kept@millennia21.id",
        nis: "9500411",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });
      const deleted = await StudentTest.create({
        email: "list_deleted@millennia21.id",
        nis: "9500412",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });
      await prismaClient.student.update({
        where: { id: deleted.student!.id },
        data: { deleted_at: new Date() },
      });

      const response = await TestRequest.get(
        `/api/internal/students?current_grade_id=${gradeId}`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].id).toBe(kept.student!.id);
    });

    it("should reject a page size above the cap", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });

      const response = await TestRequest.get(
        "/api/internal/students?size=500",
        undefined,
        authHeader(token),
      );

      expect(response.status).toBe(400);
    });

    it("should reject a client that lacks the students:read scope", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: ["some_other:scope"],
      });

      const response = await TestRequest.get(
        "/api/internal/students",
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.errors).toContain("students:read");
    });

    it("should reject if no Authorization header is provided", async () => {
      const response = await TestRequest.get("/api/internal/students");
      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/internal/students/:id/consent-status", () => {
    it("should return consent status entries for a client with the consent scope", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [CONSENT_SCOPE],
      });
      const person = await StudentTest.create({
        email: "consent_me@millennia21.id",
        nis: "9500501",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });
      await ConsentTest.create({
        studentId: person.student!.id,
        consentType: ConsentType.MEDIA_CONSENT,
        status: ConsentStatus.SIGNED,
      });
      await ConsentTest.create({
        studentId: person.student!.id,
        consentType: ConsentType.PARENT_CONSENT,
        status: ConsentStatus.PENDING,
      });

      const response = await TestRequest.get(
        `/api/internal/students/${person.student!.id}/consent-status`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(2);
      const media = body.data.find(
        (entry: { consent_type: string }) =>
          entry.consent_type === ConsentType.MEDIA_CONSENT,
      );
      expect(media.status).toBe(ConsentStatus.SIGNED);
      // Lean contract - no attachment metadata, no id/timestamps.
      expect(media.attachments).toBeUndefined();
      expect(media.id).toBeUndefined();
    });

    it("should exclude soft-deleted consent records", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [CONSENT_SCOPE],
      });
      const person = await StudentTest.create({
        email: "consent_softdeleted@millennia21.id",
        nis: "9500503",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });
      await ConsentTest.create({
        studentId: person.student!.id,
        consentType: ConsentType.MEDIA_CONSENT,
        status: ConsentStatus.SIGNED,
      });
      await ConsentTest.create({
        studentId: person.student!.id,
        consentType: ConsentType.PARENT_CONSENT,
        status: ConsentStatus.PENDING,
        deletedAt: new Date(),
      });

      const response = await TestRequest.get(
        `/api/internal/students/${person.student!.id}/consent-status`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].consent_type).toBe(ConsentType.MEDIA_CONSENT);
    });

    it("should reject a client that lacks the students:consent:read scope", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      const person = await StudentTest.create({
        email: "consent_forbidden@millennia21.id",
        nis: "9500502",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });

      const response = await TestRequest.get(
        `/api/internal/students/${person.student!.id}/consent-status`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.errors).toContain("students:consent:read");
    });

    it("should return 404 for a nonexistent student and still audit the attempt", async () => {
      const { client, token } = await ApiClientTest.createWithToken({
        scopeNames: [CONSENT_SCOPE],
      });

      const response = await TestRequest.get(
        "/api/internal/students/nonexistent-id/consent-status",
        undefined,
        authHeader(token),
      );

      expect(response.status).toBe(404);

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: {
          action: AuditAction.API_ACCESS,
          api_client_id: client.id,
        },
      });
      expect(auditLog.new_values).toMatchObject({
        resource: "ConsentStatus",
        found: false,
      });
    });
  });
});
