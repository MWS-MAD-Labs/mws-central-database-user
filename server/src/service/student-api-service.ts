import {
  AuditAction,
  AuditSource,
  EnrollmentStatus,
  PersonType,
  StudentStatus,
  type Prisma,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import { paginate, type Pageable } from "../model/page-model";
import {
  toStudentAcademicHistoryEntry,
  toStudentConsentStatusEntry,
  toStudentLookupResponse,
  type StudentAcademicHistoryEntry,
  type StudentConsentStatusEntry,
  type StudentHealthResponse,
  type StudentListRequest,
  type StudentLookupPerson,
  type StudentLookupRequest,
  type StudentLookupResponse,
} from "../model/student-api-model";
import type { ApiClientVariables } from "../type/hono-context";
import { AuditService } from "./audit-service";
import { StudentApiValidation } from "../validation/student-api-validation";
import { Validation } from "../validation/validation";

export class StudentApiService {
  static async lookup(
    client: ApiClientVariables,
    request: StudentLookupRequest,
    context: AuditRequestContext = {},
  ): Promise<StudentLookupResponse> {
    const lookupRequest = Validation.validate(
      StudentApiValidation.LOOKUP,
      request,
    );

    const person = (await prismaClient.person.findFirst({
      where: {
        person_type: PersonType.STUDENT,
        deleted_at: null,
        ...(lookupRequest.email ? { email: lookupRequest.email } : {}),
        student: {
          status: StudentStatus.ACTIVE,
          deleted_at: null,
          ...(lookupRequest.nis ? { nis: lookupRequest.nis } : {}),
        },
      },
      include: {
        student: { include: { current_grade: true, current_class: true } },
      },
    })) as StudentLookupPerson | null;

    await AuditService.record({
      action: AuditAction.API_ACCESS,
      source: AuditSource.API,
      api_client_id: client.clientId,
      new_values: {
        requested_nis: lookupRequest.nis ?? null,
        requested_email: lookupRequest.email ?? null,
        found: person !== null,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    if (!person || !person.student) {
      throw new ResponseError(404, "Student not found");
    }

    return toStudentLookupResponse(person);
  }

  static async list(
    client: ApiClientVariables,
    request: StudentListRequest,
    context: AuditRequestContext = {},
  ): Promise<Pageable<StudentLookupResponse>> {
    const listRequest = Validation.validate(StudentApiValidation.LIST, request);

    // Defaults to ACTIVE, same posture as lookup() - an app with students:read
    // shouldn't get the full roster across every lifecycle state for free,
    // it has to explicitly ask for e.g. status=REGISTERED.
    const studentFilters: Prisma.StudentWhereInput = {
      deleted_at: null,
      status: listRequest.status ?? StudentStatus.ACTIVE,
    };
    if (listRequest.current_grade_id)
      studentFilters.current_grade_id = listRequest.current_grade_id;
    if (listRequest.current_class_id)
      studentFilters.current_class_id = listRequest.current_class_id;
    if (listRequest.academic_year_id)
      studentFilters.enrollments = {
        some: {
          academic_year_id: listRequest.academic_year_id,
          enrollment_status: EnrollmentStatus.ACTIVE,
          deleted_at: null,
        },
      };

    const whereClause: Prisma.PersonWhereInput = {
      person_type: PersonType.STUDENT,
      deleted_at: null,
      student: studentFilters,
    };

    await AuditService.record({
      action: AuditAction.API_ACCESS,
      source: AuditSource.API,
      api_client_id: client.clientId,
      new_values: {
        resource: "StudentList",
        filters: {
          status: listRequest.status ?? null,
          current_grade_id: listRequest.current_grade_id ?? null,
          current_class_id: listRequest.current_class_id ?? null,
          academic_year_id: listRequest.academic_year_id ?? null,
        },
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return paginate(listRequest.page, listRequest.size, {
      count: () => prismaClient.person.count({ where: whereClause }),
      findMany: () =>
        prismaClient.person
          .findMany({
            where: whereClause,
            take: listRequest.size,
            skip: (listRequest.page - 1) * listRequest.size,
            orderBy: { created_at: "desc" },
            include: {
              student: {
                include: { current_grade: true, current_class: true },
              },
            },
          })
          .then((persons) =>
            (persons as StudentLookupPerson[]).map(toStudentLookupResponse),
          ),
    });
  }

  static async getConsentStatus(
    client: ApiClientVariables,
    studentId: string,
    context: AuditRequestContext = {},
  ): Promise<StudentConsentStatusEntry[]> {
    const student = await prismaClient.student.findFirst({
      where: { id: studentId, deleted_at: null },
    });

    await AuditService.record({
      action: AuditAction.API_ACCESS,
      source: AuditSource.API,
      api_client_id: client.clientId,
      new_values: {
        resource: "ConsentStatus",
        requested_student_id: studentId,
        found: student !== null,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    if (!student) {
      throw new ResponseError(404, "Student not found");
    }

    const consents = await prismaClient.consentRecord.findMany({
      where: { student_id: studentId, deleted_at: null },
      orderBy: { created_at: "asc" },
    });

    return consents.map(toStudentConsentStatusEntry);
  }

  static async getAcademicHistory(
    client: ApiClientVariables,
    studentId: string,
    context: AuditRequestContext = {},
  ): Promise<StudentAcademicHistoryEntry[]> {
    const student = await prismaClient.student.findFirst({
      where: { id: studentId, deleted_at: null },
    });

    await AuditService.record({
      action: AuditAction.API_ACCESS,
      source: AuditSource.API,
      api_client_id: client.clientId,
      new_values: { requested_student_id: studentId, found: student !== null },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    if (!student) {
      throw new ResponseError(404, "Student not found");
    }

    const enrollments = await prismaClient.studentClassEnrollment.findMany({
      where: { student_id: studentId, deleted_at: null },
      include: { academic_year: { select: { name: true } } },
      orderBy: { created_at: "asc" },
    });

    return enrollments.map(toStudentAcademicHistoryEntry);
  }

  static async getHealth(
    client: ApiClientVariables,
    studentId: string,
    context: AuditRequestContext = {},
  ): Promise<StudentHealthResponse> {
    const student = await prismaClient.student.findFirst({
      where: { id: studentId, deleted_at: null },
    });

    if (!student) {
      await AuditService.record({
        action: AuditAction.ACCESS_HEALTH_DATA,
        source: AuditSource.API,
        entity_type: "Student",
        entity_id: studentId,
        api_client_id: client.clientId,
        new_values: { resource: "HealthRecord", found: false },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });
      throw new ResponseError(404, "Student not found");
    }

    const [healthRecord, healthNotes] = await Promise.all([
      prismaClient.healthRecord.findFirst({
        where: { student_id: studentId, deleted_at: null },
      }),
      prismaClient.healthNote.findMany({
        where: { student_id: studentId, deleted_at: null },
      }),
    ]);

    await AuditService.record({
      action: AuditAction.ACCESS_HEALTH_DATA,
      source: AuditSource.API,
      entity_type: "Student",
      entity_id: studentId,
      api_client_id: client.clientId,
      new_values: { resource: "HealthRecord", found: true },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return {
      blood_type: healthRecord?.blood_type ?? null,
      needs_assistance: healthRecord?.needs_assistance ?? false,
      notes: healthNotes.map((note) => ({
        category: note.category,
        description: note.description,
        status: note.status,
      })),
    };
  }
}
