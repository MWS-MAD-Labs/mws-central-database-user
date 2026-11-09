import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import {
  TestRequest,
  MasterDataTest,
  StudentTest,
  ClassTest,
  EmployeeTest,
  EnrollmentTest,
  HealthRecordTest,
  HealthNoteTest,
  ConsentTest,
  ParentGuardianTest,
  PCActivityTest,
  ApiClientTest,
  AuditLogTest,
} from "./test-utils";
import {
  AcademicYearStatus,
  AuditAction,
  ClassStatus,
  ClassTeacherRole,
  ConsentStatus,
  ConsentType,
  EnrollmentStatus,
  Gender,
  HealthNoteCategory,
  ParentType,
  PCDay,
  StudentStatus,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

const READ_SCOPE = "students:read";
const HISTORY_SCOPE = "students:academic_history:read";
const HEALTH_SCOPE = "students:health:read";
const CONSENT_SCOPE = "students:consent:read";
const SUPPORT_CONTACTS_SCOPE = "students:support_contacts:read";
const ROSTER_EXPORT_SCOPE = "students:roster_export:read";
const SPECIAL_EDUCATION_SCOPE = "students:special_education:read";
const GUARDIANS_SCOPE = "students:guardians:read";

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function cleanup() {
  await AuditLogTest.delete();
  // Roster export is the only SyncLog writer in this suite.
  await prismaClient.syncLog.deleteMany({});
  await ConsentTest.delete();
  await HealthNoteTest.delete();
  await HealthRecordTest.delete();
  await ParentGuardianTest.delete();
  await PCActivityTest.delete();
  await EnrollmentTest.delete();
  await ApiClientTest.delete();
  await StudentTest.delete();
  await prismaClient.class.deleteMany({
    where: { name: { startsWith: "TEST_STUAPI_" } },
  });
  // After class deleteMany (cascades class_teacher_assignments) - Employee
  // still FK-referenced by any assignment row while its class exists.
  await EmployeeTest.delete();
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
  let unitId: string;
  let jobPositionId: string;
  let jobLevelId: string;
  let buildingId: string;

  beforeEach(async () => {
    await cleanup();
    const masterData = await MasterDataTest.create();
    unitId = masterData.unit.id;
    jobPositionId = masterData.position.id;
    jobLevelId = masterData.level.id;
    buildingId = masterData.building.id;

    const grade = await prismaClient.grade.create({
      data: { name: "TEST_STUAPI_GRADE", level: 9401 },
    });
    gradeId = grade.id;

    const year = await prismaClient.academicYear.create({
      data: {
        name: "TEST_STUAPI_YEAR",
        status: "UPCOMING",
        start_date: new Date("2100-01-01"),
      },
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
      // Person.id - the id mws-hub's SSO relay token now carries as `sub`,
      // distinct from the Student.id above.
      expect(body.data.person_id).toBe(person.id);
      expect(body.data.nis).toBe("9500101");
      expect(body.data.current_grade).toBe("TEST_STUAPI_GRADE");
      expect(body.data.current_class).toBe("TEST_STUAPI_CLASS");
      // Ids next to the names, so a consumer can match classes without the names.
      expect(body.data.current_class_id).toBe(classId);
      expect(body.data.current_grade_id).toBe(gradeId);
      expect(body.data.status).toBe(StudentStatus.ACTIVE);
      expect(body.data.gender).toBe(Gender.MALE);

      // Lean contract - no sensitive/admin-only fields leak through.
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

    // Legacy mixed-case emails must resolve case-insensitively.
    it("matches an email lookup regardless of case difference from how it's stored", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      await StudentTest.create({
        email: "Lookup_Case@millennia21.id",
        nis: "9500110",
        status: StudentStatus.ACTIVE,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });

      const response = await TestRequest.get(
        "/api/internal/students/lookup?email=lookup_case@millennia21.id",
        undefined,
        authHeader(token),
      );
      const body = await response.json();
      logger.debug(body);

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

    // Lets a caller that already resolved someone once (e.g. mws-hub
    // re-verifying a session) look them up again by the stable internal id
    // instead of email, which Central allows editing - see
    // StudentApiValidation.LOOKUP.
    it("should also accept lookup by internal id", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      const person = await StudentTest.create({
        email: "lookup_by_internal_id@millennia21.id",
        nis: "9500110",
        status: StudentStatus.ACTIVE,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
        currentClassId: classId,
      });

      const response = await TestRequest.get(
        `/api/internal/students/lookup?id=${person.student!.id}`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.id).toBe(person.student!.id);
      expect(body.data.email).toBe("lookup_by_internal_id@millennia21.id");
    });

    it("should keep resolving by id even after the student's email changes", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      const person = await StudentTest.create({
        email: "before_rename@millennia21.id",
        nis: "9500111",
        status: StudentStatus.ACTIVE,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
        currentClassId: classId,
      });

      await prismaClient.person.update({
        where: { id: person.id },
        data: { email: "after_rename@millennia21.id" },
      });

      const response = await TestRequest.get(
        `/api/internal/students/lookup?id=${person.student!.id}`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.id).toBe(person.student!.id);
      expect(body.data.email).toBe("after_rename@millennia21.id");
    });

    it("should return 404 for an id that has no matching active student", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });

      const response = await TestRequest.get(
        "/api/internal/students/lookup?id=00000000-0000-0000-0000-000000000000",
        undefined,
        authHeader(token),
      );

      expect(response.status).toBe(404);
    });

    it("should find a REGISTERED student too - registered-but-not-yet-enrolled is still a real, log-in-able student", async () => {
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
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.status).toBe(StudentStatus.REGISTERED);
    });

    it("should return 404 for a student who has left (GRADUATED)", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      await StudentTest.create({
        email: "graduated_lookup@millennia21.id",
        nis: "9500107",
        status: StudentStatus.GRADUATED,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });

      const response = await TestRequest.get(
        "/api/internal/students/lookup?nis=9500107",
        undefined,
        authHeader(token),
      );

      expect(response.status).toBe(404);
    });

    it("should audit-log a found lookup with entity_type/entity_id/full_name filled in", async () => {
      const { client, token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });
      const person = await StudentTest.create({
        email: "lookup_audit_found@millennia21.id",
        nis: "9500108",
        status: StudentStatus.ACTIVE,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });

      const response = await TestRequest.get(
        "/api/internal/students/lookup?nis=9500108",
        undefined,
        authHeader(token),
      );
      expect(response.status).toBe(200);

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { api_client_id: client.id },
        orderBy: { created_at: "desc" },
      });
      logger.debug(auditLog);

      expect(auditLog.entity_type).toBe("Student");
      expect(auditLog.entity_id).toBe(person.student!.id);
      const newValues = auditLog.new_values as { found?: boolean; full_name?: string };
      expect(newValues.found).toBe(true);
      expect(newValues.full_name).toBe(person.full_name);
    });

    it("should audit-log a not-found lookup with entity_type set but entity_id/full_name empty", async () => {
      const { client, token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });

      const response = await TestRequest.get(
        "/api/internal/students/lookup?nis=9500109",
        undefined,
        authHeader(token),
      );
      expect(response.status).toBe(404);

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: { api_client_id: client.id },
        orderBy: { created_at: "desc" },
      });
      logger.debug(auditLog);

      expect(auditLog.entity_type).toBe("Student");
      expect(auditLog.entity_id).toBeNull();
      const newValues = auditLog.new_values as { found?: boolean; full_name?: string | null };
      expect(newValues.found).toBe(false);
      expect(newValues.full_name).toBeNull();
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

  describe("GET /api/internal/students/support-contacts", () => {
    it("returns the current class's active homeroom/subject teachers", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [SUPPORT_CONTACTS_SCOPE],
      });

      const homeroomPerson = await EmployeeTest.create({
        email: "test_stuapi_homeroom@millennia21.id",
        unitId,
        jobPositionId,
        jobLevelId,
        buildingId,
      });
      const subjectPerson = await EmployeeTest.create({
        email: "test_stuapi_subject@millennia21.id",
        unitId,
        jobPositionId,
        jobLevelId,
        buildingId,
      });
      await prismaClient.classTeacherAssignment.create({
        data: {
          class_id: classId,
          start_date: new Date(),
          employee_id: homeroomPerson.employee!.id,
          role: ClassTeacherRole.HOMEROOM,
        },
      });
      await prismaClient.classTeacherAssignment.create({
        data: {
          class_id: classId,
          start_date: new Date(),
          employee_id: subjectPerson.employee!.id,
          role: ClassTeacherRole.SUBJECT_TEACHER,
          subject: "Math",
        },
      });

      const person = await StudentTest.create({
        email: "test_stuapi_contacts@millennia21.id",
        nis: "9500401",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
        currentClassId: classId,
      });

      const response = await TestRequest.get(
        `/api/internal/students/support-contacts?email=${person.email}`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      expect(body.data.current_class).toBe("TEST_STUAPI_CLASS");
      expect(body.data.teachers.length).toBe(2);
      const homeroom = body.data.teachers.find((t: any) => t.role === "HOMEROOM");
      expect(homeroom.email).toBe("test_stuapi_homeroom@millennia21.id");
      const subject = body.data.teachers.find((t: any) => t.role === "SUBJECT_TEACHER");
      expect(subject.subject).toBe("Math");
    });

    it("matches support-contacts lookup regardless of case difference from how the email is stored", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [SUPPORT_CONTACTS_SCOPE],
      });
      await StudentTest.create({
        email: "Test_Stuapi_Case@millennia21.id",
        nis: "9500403",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });

      const response = await TestRequest.get(
        "/api/internal/students/support-contacts?email=test_stuapi_case@millennia21.id",
        undefined,
        authHeader(token),
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
    });

    it("returns an empty teacher list when the student has no current class", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [SUPPORT_CONTACTS_SCOPE],
      });
      const person = await StudentTest.create({
        email: "test_stuapi_no_class@millennia21.id",
        nis: "9500402",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
      });

      const response = await TestRequest.get(
        `/api/internal/students/support-contacts?email=${person.email}`,
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.current_class).toBeNull();
      expect(body.data.teachers).toEqual([]);
    });

    it("rejects a client that lacks the support-contacts scope", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });

      const response = await TestRequest.get(
        "/api/internal/students/support-contacts?email=nobody@millennia21.id",
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.errors).toContain(SUPPORT_CONTACTS_SCOPE);
    });

    it("returns 404 for an email with no active student", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [SUPPORT_CONTACTS_SCOPE],
      });

      const response = await TestRequest.get(
        "/api/internal/students/support-contacts?email=nobody@millennia21.id",
        undefined,
        authHeader(token),
      );

      expect(response.status).toBe(404);
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
      expect(body.data[0].gender).toBe(Gender.MALE);
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
        data: {
          name: "TEST_STUAPI_OTHER_YEAR",
          status: "UPCOMING",
          start_date: new Date("2101-01-01"),
        },
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

    describe("enrollment_start_date", () => {
      async function listed(email: string, nis: string) {
        const { token } = await ApiClientTest.createWithToken({
          scopeNames: [READ_SCOPE],
        });
        const person = await StudentTest.create({
          email,
          nis,
          currentGradeId: gradeId,
          joinGradeId: gradeId,
          joinAcademicYearId: academicYearId,
          currentClassId: classId,
        });
        const get = async () => {
          const response = await TestRequest.get(
            `/api/internal/students?current_class_id=${classId}`,
            undefined,
            authHeader(token),
          );
          const body = await response.json();
          return body.data.find((item: { nis: string }) => item.nis === nis);
        };
        return { person, get };
      }

      it("should give the start date of the student's active enrollment", async () => {
        const { person, get } = await listed("start_dated@millennia21.id", "9500420");
        await EnrollmentTest.create({
          studentId: person.student!.id,
          classId,
          academicYearId,
          gradeLevel: "TEST_STUAPI_GRADE",
          startDate: new Date("2026-08-03T00:00:00.000Z"),
        });

        expect((await get()).enrollment_start_date).toBe("2026-08-03T00:00:00.000Z");
      });

      it("should be null when the enrollment has no start date, or there is none", async () => {
        const { person, get } = await listed("no_start@millennia21.id", "9500421");
        expect((await get()).enrollment_start_date).toBeNull();

        await EnrollmentTest.create({
          studentId: person.student!.id,
          classId,
          academicYearId,
          gradeLevel: "TEST_STUAPI_GRADE",
        });
        expect((await get()).enrollment_start_date).toBeNull();
      });

      it("should ignore enrollments that are closed or deleted", async () => {
        const { person, get } = await listed("closed_only@millennia21.id", "9500422");
        await EnrollmentTest.create({
          studentId: person.student!.id,
          classId,
          academicYearId,
          gradeLevel: "TEST_STUAPI_GRADE",
          status: EnrollmentStatus.COMPLETED,
          startDate: new Date("2026-08-03T00:00:00.000Z"),
        });
        const otherYear = await prismaClient.academicYear.create({
          data: {
            name: "TEST_STUAPI_START_YEAR",
            status: "UPCOMING",
            start_date: new Date("2102-01-01"),
          },
        });
        await EnrollmentTest.create({
          studentId: person.student!.id,
          classId,
          academicYearId: otherYear.id,
          gradeLevel: "TEST_STUAPI_GRADE",
          startDate: new Date("2026-09-01T00:00:00.000Z"),
          deletedAt: new Date(),
        });

        expect((await get()).enrollment_start_date).toBeNull();
      });

      it("should take the newest active enrollment when there are several", async () => {
        const { person, get } = await listed("two_active@millennia21.id", "9500423");
        const nextYear = await prismaClient.academicYear.create({
          data: {
            name: "TEST_STUAPI_NEXT_YEAR",
            status: "UPCOMING",
            start_date: new Date("2103-01-01"),
          },
        });
        await EnrollmentTest.create({
          studentId: person.student!.id,
          classId,
          academicYearId,
          gradeLevel: "TEST_STUAPI_GRADE",
          startDate: new Date("2026-08-03T00:00:00.000Z"),
        });
        await EnrollmentTest.create({
          studentId: person.student!.id,
          classId,
          academicYearId: nextYear.id,
          gradeLevel: "TEST_STUAPI_GRADE",
          startDate: new Date("2027-07-12T00:00:00.000Z"),
        });

        expect((await get()).enrollment_start_date).toBe("2027-07-12T00:00:00.000Z");
      });
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

  describe("GET /api/internal/students/guardians", () => {
    const active = (email: string, nis: string, status: StudentStatus = StudentStatus.ACTIVE) =>
      StudentTest.create({ email, nis, status, currentGradeId: gradeId, joinGradeId: gradeId, joinAcademicYearId: academicYearId, currentClassId: classId });
    const get = (token: string, query = "") => TestRequest.get(`/api/internal/students/guardians${query}`, undefined, authHeader(token));

    it("lists the guardians with an email of active students, without phone or address", async () => {
      const { token } = await ApiClientTest.createWithToken({ scopeNames: [GUARDIANS_SCOPE] });
      const student = (await active("guardians_a@millennia21.id", "9500601")).student!;
      const primary = await ParentGuardianTest.create({ studentId: student.id, type: ParentType.MOTHER, fullName: "Siti Ibu", email: "  Siti@Example.com ", phone: "081234567890", address: "Jl. Mawar 1", isPrimary: true });
      const second = await ParentGuardianTest.create({ studentId: student.id, type: ParentType.GUARDIAN, fullName: "Budi Wali", email: "budi@example.com" });

      const response = await get(token);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual([
        { id: primary.id, student_id: student.id, full_name: "Siti Ibu", email: "siti@example.com", type: "MOTHER", is_primary: true },
        { id: second.id, student_id: student.id, full_name: "Budi Wali", email: "budi@example.com", type: "GUARDIAN", is_primary: false },
      ]);
      expect(JSON.stringify(body)).not.toContain("081234567890");
      expect(JSON.stringify(body)).not.toContain("Mawar");
    });

    it("leaves out a guardian without an email, one that was deleted, and the guardians of a student who is not active", async () => {
      const { token } = await ApiClientTest.createWithToken({ scopeNames: [GUARDIANS_SCOPE] });
      const student = (await active("guardians_b@millennia21.id", "9500602")).student!;
      const gone = (await active("guardians_c@millennia21.id", "9500603", StudentStatus.GRADUATED)).student!;
      await ParentGuardianTest.create({ studentId: student.id, fullName: "No Email" });
      await ParentGuardianTest.create({ studentId: student.id, fullName: "Empty Email", email: "" });
      await ParentGuardianTest.create({ studentId: student.id, fullName: "Deleted", email: "deleted@example.com", deletedAt: new Date() });
      await ParentGuardianTest.create({ studentId: student.id, fullName: "Kept", email: "kept@example.com" });
      await ParentGuardianTest.create({ studentId: gone.id, fullName: "Alumni Parent", email: "alumni@example.com" });

      const body = await (await get(token)).json();

      expect(body.data.map((row: { full_name: string }) => row.full_name)).toEqual(["Kept"]);
      expect(body.paging.total_item).toBe(1);
    });

    it("pages the list", async () => {
      const { token } = await ApiClientTest.createWithToken({ scopeNames: [GUARDIANS_SCOPE] });
      const student = (await active("guardians_d@millennia21.id", "9500604")).student!;
      for (const name of ["One", "Two", "Three"]) await ParentGuardianTest.create({ studentId: student.id, fullName: name, email: `${name.toLowerCase()}@example.com` });

      const first = await (await get(token, "?page=1&size=2")).json();
      const second = await (await get(token, "?page=2&size=2")).json();

      expect(first.data).toHaveLength(2);
      expect(second.data).toHaveLength(1);
      expect(first.paging).toMatchObject({ total_item: 3, total_page: 2 });
      expect(new Set([...first.data, ...second.data].map((row: { id: string }) => row.id)).size).toBe(3);
    });

    it("refuses a size beyond 100 and a page that is not a number", async () => {
      const { token } = await ApiClientTest.createWithToken({ scopeNames: [GUARDIANS_SCOPE] });
      expect((await get(token, "?size=101")).status).toBe(400);
      expect((await get(token, "?page=abc")).status).toBe(400);
    });

    it("records who read the list, without the contacts", async () => {
      const { token } = await ApiClientTest.createWithToken({ scopeNames: [GUARDIANS_SCOPE] });
      const student = (await active("guardians_e@millennia21.id", "9500605")).student!;
      await ParentGuardianTest.create({ studentId: student.id, fullName: "Logged", email: "logged@example.com" });

      await get(token);

      const log = await prismaClient.auditLog.findFirstOrThrow({ where: { action: AuditAction.API_ACCESS }, orderBy: { created_at: "desc" } });
      expect(log.new_values).toMatchObject({ resource: "GuardianContacts", result_count: 1 });
      expect(JSON.stringify(log.new_values)).not.toContain("logged@example.com");
    });

    it("needs its own scope: the general student scope is not enough, and no token is refused", async () => {
      const { token } = await ApiClientTest.createWithToken({ scopeNames: [READ_SCOPE] });
      expect((await get(token)).status).toBe(403);
      expect((await TestRequest.get("/api/internal/students/guardians")).status).toBe(401);
    });
  });

  describe("GET /api/internal/students/special-education", () => {
    it("lists only active eligible students with classes and their learning support summary", async () => {
      const { token } = await ApiClientTest.createWithToken({ scopeNames: [SPECIAL_EDUCATION_SCOPE] });
      const eligible = await StudentTest.create({
        email: "special_education_list@millennia21.id",
        nis: "9500498",
        status: StudentStatus.ACTIVE,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
        currentClassId: classId,
        sn: true,
      });
      await prismaClient.studentSpecialNeedsProfile.create({
        data: { student_id: eligible.student!.id, learning_support_summary: "Uses visual prompts.", needs: { create: { need_type: "OTHER", description: "Reads below grade level." } } },
      });
      await StudentTest.create({
        email: "legacy_incomplete_special_education@millennia21.id",
        nis: "9500497",
        status: StudentStatus.ACTIVE,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
        currentClassId: classId,
        sn: true,
      });
      await StudentTest.create({ email: "not_special_education_list@millennia21.id", nis: "9500499", status: StudentStatus.ACTIVE, currentGradeId: gradeId, joinGradeId: gradeId, joinAcademicYearId: academicYearId, currentClassId: classId });

      const response = await TestRequest.get("/api/internal/students/special-education", undefined, authHeader(token));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        id: eligible.student!.id,
        need_types: ["OTHER"],
        learning_support_summary: "Uses visual prompts.",
        accommodations: null,
        current_class_id: classId,
      });
      expect(body.data[0].blood_type).toBeUndefined();
      expect(body.data[0].has_professional_report).toBeUndefined();
    });

    it("leaves out a profiled student whose class is not active", async () => {
      const { token } = await ApiClientTest.createWithToken({ scopeNames: [SPECIAL_EDUCATION_SCOPE] });
      const closed = await ClassTest.create({ gradeId, academicYearId, status: ClassStatus.INACTIVE, name: "TEST_Class_closed_se" });
      const student = await StudentTest.create({
        email: "special_education_closed_class@millennia21.id",
        nis: "9500496",
        status: StudentStatus.ACTIVE,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
        currentClassId: closed.id,
        sn: true,
      });
      await prismaClient.studentSpecialNeedsProfile.create({
        data: { student_id: student.student!.id, needs: { create: { need_type: "OTHER", description: "Reads below grade level." } } },
      });

      const response = await TestRequest.get("/api/internal/students/special-education", undefined, authHeader(token));

      expect((await response.json()).data).toHaveLength(0);
    });

    it("rejects a client with only the general student scope", async () => {
      const { token } = await ApiClientTest.createWithToken({ scopeNames: [READ_SCOPE] });
      expect((await TestRequest.get("/api/internal/students/special-education", undefined, authHeader(token))).status).toBe(403);
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

  describe("GET /api/internal/students/roster-export", () => {
    it("should return a flat roster row with parent, health, consent, and PC fields, and log the pull", async () => {
      const { client, token } = await ApiClientTest.createWithToken({
        scopeNames: [ROSTER_EXPORT_SCOPE],
      });
      const activeYear = await prismaClient.academicYear.update({
        where: { id: academicYearId },
        data: { status: AcademicYearStatus.ACTIVE },
      });
      const person = await StudentTest.create({
        email: "roster_export_me@millennia21.id",
        nis: "9500401",
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
        currentClassId: classId,
      });
      const studentId = person.student!.id;

      await ParentGuardianTest.create({
        studentId,
        type: ParentType.FATHER,
        fullName: "Test Father",
        phone: "081100000001",
        email: "father@millennia21.id",
        address: "Jl. Father",
        isPrimary: true,
      });
      await ParentGuardianTest.create({
        studentId,
        type: ParentType.MOTHER,
        fullName: "Test Mother",
        phone: "081100000002",
        email: "mother@millennia21.id",
        address: "Jl. Mother",
      });
      await HealthRecordTest.create({ studentId, bloodType: "O" });
      await HealthNoteTest.create({
        studentId,
        category: HealthNoteCategory.HEALTH_INFO,
        description: "Asthma",
      });
      await HealthNoteTest.create({
        studentId,
        category: HealthNoteCategory.SPECIAL_NEEDS,
        description: "Needs extra time",
      });
      await ConsentTest.create({
        studentId,
        consentType: ConsentType.MEDIA_CONSENT,
        status: ConsentStatus.SIGNED,
      });
      await ConsentTest.create({
        studentId,
        consentType: ConsentType.PARENT_CONSENT,
        status: ConsentStatus.PENDING,
      });
      await PCActivityTest.create({
        studentId,
        day: PCDay.MONDAY,
        activity: "Basketball",
        academicYearId: activeYear.id,
      });

      const response = await TestRequest.get(
        "/api/internal/students/roster-export",
        undefined,
        authHeader(token),
      );
      const body = await response.json();
      logger.debug(body);

      expect(response.status).toBe(200);
      const row = body.data.find((r: { nis: string }) => r.nis === "9500401");
      expect(row).toBeDefined();
      expect(row.current_grade).not.toBeNull();
      expect(row.current_class).not.toBeNull();
      expect(row.father_name).toBe("Test Father");
      expect(row.mother_name).toBe("Test Mother");
      expect(row.father_email).toBe("father@millennia21.id");
      expect(row.mother_email).toBe("mother@millennia21.id");
      expect(row.address).toBe("Jl. Father");
      expect(row.blood_type).toBe("O");
      expect(row.health_information).toBe("Asthma");
      expect(row.special_needs).toBe("Needs extra time");
      expect(row.media_consent_status).toBe("SIGNED");
      expect(row.parent_consent_status).toBe("PENDING");
      expect(row.pc_monday).toBe("Basketball");
      expect(row.pc_tuesday).toBeNull();

      const auditLog = await prismaClient.auditLog.findFirstOrThrow({
        where: {
          action: AuditAction.EXPORT_DATA,
          api_client_id: client.id,
        },
      });
      expect(auditLog.new_values).toMatchObject({
        resource: "StudentRosterExport",
      });

      const syncLog = await prismaClient.syncLog.findFirstOrThrow({
        where: { created_by: client.id },
      });
      expect(syncLog.total_rows).toBe(body.data.length);
    });

    it("should include every status by default, blanking current grade/class only for the non-active ones", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [ROSTER_EXPORT_SCOPE],
      });
      await StudentTest.create({
        email: "roster_export_active@millennia21.id",
        nis: "9500403",
        status: StudentStatus.ACTIVE,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
        currentClassId: classId,
      });
      await StudentTest.create({
        email: "roster_export_graduated@millennia21.id",
        nis: "9500402",
        status: StudentStatus.GRADUATED,
        currentGradeId: gradeId,
        joinGradeId: gradeId,
        joinAcademicYearId: academicYearId,
        currentClassId: classId,
      });

      const response = await TestRequest.get(
        "/api/internal/students/roster-export",
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      const activeRow = body.data.find(
        (r: { nis: string }) => r.nis === "9500403",
      );
      const graduatedRow = body.data.find(
        (r: { nis: string }) => r.nis === "9500402",
      );
      expect(activeRow).toBeDefined();
      expect(activeRow.current_grade).not.toBeNull();
      // No ConsentTest.create() for this student - null, not "false", is
      // what should come back when there's no consent record at all.
      expect(activeRow.media_consent_status).toBeNull();
      expect(activeRow.parent_consent_status).toBeNull();
      expect(graduatedRow).toBeDefined();
      expect(graduatedRow.current_grade).toBeNull();
      expect(graduatedRow.current_class).toBeNull();

      // Still filterable when a specific status is explicitly requested.
      const graduatedOnlyResponse = await TestRequest.get(
        "/api/internal/students/roster-export?status=GRADUATED",
        undefined,
        authHeader(token),
      );
      const graduatedOnlyBody = await graduatedOnlyResponse.json();
      expect(
        graduatedOnlyBody.data.some(
          (r: { nis: string }) => r.nis === "9500403",
        ),
      ).toBe(false);
      expect(
        graduatedOnlyBody.data.some(
          (r: { nis: string }) => r.nis === "9500402",
        ),
      ).toBe(true);
    });

    it("should reject a client that lacks the roster_export scope", async () => {
      const { token } = await ApiClientTest.createWithToken({
        scopeNames: [READ_SCOPE],
      });

      const response = await TestRequest.get(
        "/api/internal/students/roster-export",
        undefined,
        authHeader(token),
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.errors).toContain("students:roster_export:read");
    });
  });
});
