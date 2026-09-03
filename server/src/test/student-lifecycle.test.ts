import { describe, it, expect, afterAll } from "bun:test";
import { TestRequest, AdminUserTest } from "./test-utils";
import {
  AcademicYearStatus,
  ClassStatus,
  ClassTeacherRole,
  EmployeeStatus,
  EmploymentType,
  Gender,
  MaritalStatus,
  Religion,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

// End-to-end regression covering the whole student lifecycle in one pass,
// through the real HTTP endpoints (not fixture shortcuts): create, enroll,
// assign homeroom/subject teachers, transfer, promote, graduate. Individual
// steps are unit-tested elsewhere (student.test.ts, enrollment.test.ts,
// employee.test.ts, class.test.ts) - this exists to catch a break in how
// they chain together, which per-endpoint tests can miss.
describe("Full student lifecycle flow", () => {
  afterAll(async () => {
    await AdminUserTest.delete();
    await prismaClient.classTeacherAssignment.deleteMany({
      where: { class: { name: { startsWith: "FLOW_" } } },
    });
    await prismaClient.studentClassEnrollment.deleteMany({
      where: { class: { name: { startsWith: "FLOW_" } } },
    });
    await prismaClient.studentMutationHistory.deleteMany({
      where: { student: { person: { email: { contains: "flow_e2e" } } } },
    });
    await prismaClient.student.deleteMany({
      where: { person: { email: { contains: "flow_e2e" } } },
    });
    await prismaClient.employeeMutationHistory.deleteMany({
      where: { employee: { person: { email: { contains: "flow_e2e" } } } },
    });
    await prismaClient.employee.deleteMany({
      where: { person: { email: { contains: "flow_e2e" } } },
    });
    await prismaClient.person.deleteMany({
      where: { email: { contains: "flow_e2e" } },
    });
    await prismaClient.class.deleteMany({
      where: { name: { startsWith: "FLOW_" } },
    });
    await prismaClient.academicYear.deleteMany({
      where: { name: { startsWith: "FLOW_" } },
    });
  });

  it("runs the full lifecycle: create -> enroll -> assign teachers -> transfer -> promote -> graduate", async () => {
    // ---- 1. Master data the flow needs ----
    // Real seeded Grade 1/Grade 2 (both under the "Elementary" unit) -
    // custom grades need a level in NIS-generator's known ranges
    // (Kindergarten/Elementary/Junior High, nis-generator.ts) to go through
    // the real create-student endpoint, so reusing the seeded ones is
    // simpler than replicating that range.
    const gradeOne = await prismaClient.grade.findUniqueOrThrow({
      where: { name: "Grade 1" },
    });
    const gradeTwo = await prismaClient.grade.findUniqueOrThrow({
      where: { name: "Grade 2" },
    });
    const unit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { id: gradeOne.unit_id! },
    });
    const building = await prismaClient.masterBuilding.findFirstOrThrow();
    const { accessToken } = await AdminUserTest.createSuperAdmin(unit.id);
    // Real seeded teaching level/position - assertJobPositionJobLevelCompatibleByIds
    // and assertUnitJobLevelCompatible both key off real names
    // (employee-role-rules.ts's TEACHING_JOB_LEVELS/SCHOOL_UNITS sets), not
    // arbitrary custom ones, so reuse what seed-master-lists already created.
    const teachingJobLevel = await prismaClient.masterJobLevel.findUniqueOrThrow(
      { where: { name: "Teacher" } },
    );
    const jobPosition = await prismaClient.masterJobPosition.findUniqueOrThrow(
      { where: { name: "Homeroom Teacher" } },
    );

    const yearA = await prismaClient.academicYear.create({
      data: {
        name: "FLOW_YEAR_A",
        status: AcademicYearStatus.ACTIVE,
        start_date: new Date("2025-07-01"),
      },
    });
    const yearB = await prismaClient.academicYear.create({
      data: {
        name: "FLOW_YEAR_B",
        status: AcademicYearStatus.UPCOMING,
        start_date: new Date("2026-07-01"),
      },
    });

    const classA = await prismaClient.class.create({
      data: {
        name: "FLOW_Class_A",
        grade_id: gradeOne.id,
        academic_year_id: yearA.id,
        status: ClassStatus.ACTIVE,
      },
    });
    const classALateral = await prismaClient.class.create({
      data: {
        name: "FLOW_Class_A_Lateral",
        grade_id: gradeOne.id,
        academic_year_id: yearA.id,
        status: ClassStatus.ACTIVE,
      },
    });
    const classB = await prismaClient.class.create({
      data: {
        name: "FLOW_Class_B",
        grade_id: gradeTwo.id,
        academic_year_id: yearB.id,
        status: ClassStatus.ACTIVE,
      },
    });

    logger.debug("=== STEP 1: master data ready ===");

    // ---- 2. Create the student through the real endpoint ----
    const createStudentResponse = await TestRequest.post(
      "/api/admin/students",
      {
        full_name: "Flow Test Student",
        nick_name: "Flowy",
        email: "flow_e2e_student@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        // Grade 1's real seeded typical_age (6) needs this within +/-2
        // years of that as of yearA's 2025-07-01 start_date.
        birth_date: new Date("2019-01-01").toISOString(),
        entry_type: "PSB",
        join_academic_year_id: yearA.id,
        current_grade_id: gradeOne.id,
        join_grade_id: gradeOne.id,
      },
      accessToken,
    );
    const createStudentBody = await createStudentResponse.json();
    logger.debug("=== STEP 2: create student ===", createStudentBody);
    expect(createStudentResponse.status).toBe(200);
    const studentId = createStudentBody.data.id;
    expect(createStudentBody.data.status).toBe("REGISTERED");

    // ---- 3. Create the teacher employee ----
    const createTeacherResponse = await TestRequest.post(
      "/api/admin/employees",
      {
        full_name: "Flow Test Teacher",
        nick_name: "Teacher",
        email: "flow_e2e_teacher@millennia21.id",
        gender: Gender.FEMALE,
        religion: Religion.ISLAM,
        birth_place: "Bandung",
        birth_date: new Date("1990-01-01").toISOString(),
        employee_id: "99.99.900",
        marital_status: MaritalStatus.SINGLE,
        status: EmployeeStatus.ACTIVE,
        employment_type: EmploymentType.PERMANENT,
        unit_id: unit.id,
        job_position_id: jobPosition.id,
        job_level_id: teachingJobLevel.id,
        building_id: building.id,
        join_date: new Date().toISOString(),
      },
      accessToken,
    );
    const createTeacherBody = await createTeacherResponse.json();
    logger.debug("=== STEP 3: create teacher ===", createTeacherBody);
    expect(createTeacherResponse.status).toBe(200);
    const teacherId = createTeacherBody.data.id;

    // A second, separate employee for the subject-teacher assignment -
    // "Homeroom Teacher" isn't itself a subject-teaching position
    // (assertSubjectTeacherEligible in class-service.ts), same real-world
    // split as most schools: homeroom and subject teachers are usually
    // different people.
    const mathJobPosition = await prismaClient.masterJobPosition.findUniqueOrThrow(
      { where: { name: "Math Teacher" } },
    );
    const createSubjectTeacherResponse = await TestRequest.post(
      "/api/admin/employees",
      {
        full_name: "Flow Test Subject Teacher",
        nick_name: "Subject",
        email: "flow_e2e_subject_teacher@millennia21.id",
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Surabaya",
        birth_date: new Date("1988-01-01").toISOString(),
        employee_id: "99.99.901",
        marital_status: MaritalStatus.MARRIED,
        status: EmployeeStatus.ACTIVE,
        employment_type: EmploymentType.PERMANENT,
        unit_id: unit.id,
        job_position_id: mathJobPosition.id,
        job_level_id: teachingJobLevel.id,
        building_id: building.id,
        join_date: new Date().toISOString(),
      },
      accessToken,
    );
    const createSubjectTeacherBody = await createSubjectTeacherResponse.json();
    logger.debug(
      "=== STEP 3b: create subject teacher ===",
      createSubjectTeacherBody,
    );
    expect(createSubjectTeacherResponse.status).toBe(200);
    const subjectTeacherId = createSubjectTeacherBody.data.id;

    // ---- 4. Assign homeroom teacher and subject teacher to Class A ----
    const assignHomeroomResponse = await TestRequest.post(
      `/api/admin/classes/${classA.id}/teachers`,
      { employee_id: teacherId, role: ClassTeacherRole.HOMEROOM },
      accessToken,
    );
    const assignHomeroomBody = await assignHomeroomResponse.json();
    logger.debug("=== STEP 4a: assign homeroom teacher ===", assignHomeroomBody);
    expect(assignHomeroomResponse.status).toBe(200);

    const assignSubjectResponse = await TestRequest.post(
      `/api/admin/classes/${classA.id}/teachers`,
      {
        employee_id: subjectTeacherId,
        role: ClassTeacherRole.SUBJECT_TEACHER,
        subject: "Math",
      },
      accessToken,
    );
    const assignSubjectBody = await assignSubjectResponse.json();
    logger.debug("=== STEP 4b: assign subject teacher ===", assignSubjectBody);
    expect(assignSubjectResponse.status).toBe(200);

    // ---- 5. Enroll the student into Class A ----
    const enrollResponse = await TestRequest.post(
      `/api/admin/students/${studentId}/enrollments`,
      { class_id: classA.id, academic_year_id: yearA.id },
      accessToken,
    );
    const enrollBody = await enrollResponse.json();
    logger.debug("=== STEP 5: enroll into Class A ===", enrollBody);
    expect(enrollResponse.status).toBe(200);
    expect(enrollBody.data.enrollment_status).toBe("ACTIVE");
    const firstEnrollmentId = enrollBody.data.id;

    const afterEnrollResponse = await TestRequest.get(
      `/api/admin/students/${studentId}`,
      accessToken,
    );
    const afterEnrollBody = await afterEnrollResponse.json();
    logger.debug("=== after enroll: student detail ===", afterEnrollBody);
    expect(afterEnrollBody.data.status).toBe("ACTIVE");
    expect(afterEnrollBody.data.academic.current_class_id).toBe(classA.id);
    expect(afterEnrollBody.data.academic.has_active_enrollment_history).toBe(
      true,
    );

    // Field should be locked now that real enrollment history exists.
    const lockedEditResponse = await TestRequest.patch(
      `/api/admin/students/${studentId}`,
      { current_grade_id: gradeTwo.id },
      accessToken,
    );
    logger.debug(
      "=== current_grade should be locked now ===",
      await lockedEditResponse.json(),
    );
    expect(lockedEditResponse.status).toBe(400);

    // ---- 6. Transfer sideways within the same year ----
    const transferResponse = await TestRequest.patch(
      `/api/admin/students/${studentId}/enrollments/${firstEnrollmentId}/transfer`,
      { class_id: classALateral.id },
      accessToken,
    );
    const transferBody = await transferResponse.json();
    logger.debug("=== STEP 6: transfer sideways ===", transferBody);
    expect(transferResponse.status).toBe(200);
    expect(transferBody.data.class.id).toBe(classALateral.id);
    const transferredEnrollmentId = transferBody.data.id;

    // ---- 7. Promote into the next academic year and grade ----
    const promoteResponse = await TestRequest.patch(
      `/api/admin/students/${studentId}/enrollments/${transferredEnrollmentId}/promote`,
      {
        class_id: classB.id,
        grade_id: gradeTwo.id,
        academic_year_id: yearB.id,
      },
      accessToken,
    );
    const promoteBody = await promoteResponse.json();
    logger.debug("=== STEP 7: promote to Grade 2 / Year B ===", promoteBody);
    expect(promoteResponse.status).toBe(200);
    expect(promoteBody.data.class.id).toBe(classB.id);
    const promotedEnrollmentId = promoteBody.data.id;

    const afterPromoteResponse = await TestRequest.get(
      `/api/admin/students/${studentId}`,
      accessToken,
    );
    const afterPromoteBody = await afterPromoteResponse.json();
    logger.debug(
      "=== after promote: student detail ===",
      afterPromoteBody,
    );
    expect(afterPromoteBody.data.academic.current_grade).toBe("Grade 2");

    // ---- 8. Graduate (close as COMPLETED) ----
    const graduateResponse = await TestRequest.patch(
      `/api/admin/students/${studentId}/enrollments/${promotedEnrollmentId}/close`,
      {
        status: "COMPLETED",
        end_date: "2027-06-01T00:00:00.000Z",
        graduation_grade: "Grade 2",
        leave_year: "2027",
      },
      accessToken,
    );
    const graduateBody = await graduateResponse.json();
    logger.debug("=== STEP 8: graduate ===", graduateBody);
    expect(graduateResponse.status).toBe(200);
    expect(graduateBody.data.enrollment_status).toBe("COMPLETED");
    expect(graduateBody.data.student.status).toBe("GRADUATED");

    // ---- 9. Final state check ----
    const finalResponse = await TestRequest.get(
      `/api/admin/students/${studentId}`,
      accessToken,
    );
    const finalBody = await finalResponse.json();
    logger.debug("=== STEP 9: final student state ===", finalBody);
    expect(finalResponse.status).toBe(200);
    expect(finalBody.data.status).toBe("GRADUATED");
    expect(finalBody.data.academic.current_class_id).toBeNull();
    expect(finalBody.data.academic.current_grade).toBe("Grade 2");
    expect(finalBody.data.academic.graduation_grade).toBe("Grade 2");
    expect(finalBody.data.academic.leave_year).toBe("2027");
    expect(finalBody.data.academic.has_completed_enrollment).toBe(true);
    expect(finalBody.data.academic.has_active_enrollment_history).toBe(true);

    // Still locked after graduation - this is exactly the bug fixed earlier
    // this session (current grade editable after graduation).
    const postGraduateEditResponse = await TestRequest.patch(
      `/api/admin/students/${studentId}`,
      { current_grade_id: gradeOne.id },
      accessToken,
    );
    logger.debug(
      "=== current_grade should still be locked post-graduation ===",
      await postGraduateEditResponse.json(),
    );
    expect(postGraduateEditResponse.status).toBe(400);

    // ---- 10. Teacher assignments still on record ----
    const teacherAssignmentsResponse = await TestRequest.get(
      `/api/admin/classes/${classA.id}/teacher-assignments`,
      accessToken,
    );
    const teacherAssignmentsBody = await teacherAssignmentsResponse.json();
    logger.debug(
      "=== STEP 10: teacher assignments on Class A ===",
      teacherAssignmentsBody,
    );
    expect(teacherAssignmentsResponse.status).toBe(200);
    expect(teacherAssignmentsBody.data.length).toBe(2);

    logger.debug("=== FULL FLOW COMPLETED SUCCESSFULLY ===");
  });
});
