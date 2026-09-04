import {
  AcademicYearStatus,
  AuditAction,
  AuditSource,
  ConsentType,
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
  toStudentRosterExportRow,
  toStudentSupportContactsResponse,
  type StudentAcademicHistoryEntry,
  type StudentConsentStatusEntry,
  type StudentHealthResponse,
  type StudentListRequest,
  type StudentLookupPerson,
  type StudentLookupRequest,
  type StudentLookupResponse,
  type StudentRosterExportPerson,
  type StudentRosterExportRequest,
  type StudentRosterExportRow,
  type StudentSupportContactsResponse,
} from "../model/student-api-model";
import type { ApiClientVariables } from "../type/hono-context";
import { AuditService } from "./audit-service";
import { resolveStudentPhotoUrl } from "./student-photo-service";
import { StudentApiValidation } from "../validation/student-api-validation";
import { Validation } from "../validation/validation";
import { withLookupCache } from "../lib/lookup-cache";

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

    const person = await withLookupCache(
      "student",
      [lookupRequest.email, lookupRequest.nis],
      async () =>
        (await prismaClient.person.findFirst({
          where: {
            person_type: PersonType.STUDENT,
            deleted_at: null,
            ...(lookupRequest.email ? { email: lookupRequest.email } : {}),
            student: {
              // REGISTERED means enrolled in the school but not yet assigned
              // a class (StudentClassEnrollment) - most students sit in this
              // state day to day, so ACTIVE-only here meant this endpoint
              // 404'd for the majority of real students. Every app that logs
              // a student in through this lookup (e.g. mws-mtss-system's SSO
              // flow) needs REGISTERED treated as a real, log-in-able
              // student, same as ACTIVE.
              status: { in: [StudentStatus.REGISTERED, StudentStatus.ACTIVE] },
              deleted_at: null,
              ...(lookupRequest.nis ? { nis: lookupRequest.nis } : {}),
            },
          },
          include: {
            student: { include: { current_grade: true, current_class: true } },
          },
        })) as StudentLookupPerson | null,
    );

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

    // Not audit-logged - see the matching note in EmployeeApiService.list().
    // A routine roster sync poll, not access to any one student's record;
    // api_clients.last_used_at already covers "is this client still
    // syncing". lookup() and the sensitive per-student endpoints
    // (getHealth/getConsentStatus/getAcademicHistory/getSupportContacts)
    // still log every call.
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
      include: { person: { select: { full_name: true } } },
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
      new_values: {
        resource: "HealthRecord",
        found: true,
        full_name: student.person.full_name,
      },
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

  static async getSupportContacts(
    client: ApiClientVariables,
    email: string,
    context: AuditRequestContext = {},
  ): Promise<StudentSupportContactsResponse> {
    const person = await prismaClient.person.findFirst({
      where: {
        email,
        person_type: PersonType.STUDENT,
        deleted_at: null,
        student: { status: StudentStatus.ACTIVE, deleted_at: null },
      },
      include: { student: { include: { current_class: true } } },
    });

    if (!person || !person.student) {
      await AuditService.record({
        action: AuditAction.API_ACCESS,
        source: AuditSource.API,
        api_client_id: client.clientId,
        new_values: { resource: "SupportContacts", email, found: false },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });
      throw new ResponseError(404, "Student not found");
    }

    const student = person.student;
    const assignments = student.current_class_id
      ? await prismaClient.classTeacherAssignment.findMany({
          where: {
            class_id: student.current_class_id,
            end_date: null,
            deleted_at: null,
          },
          include: { employee: { include: { person: true } } },
        })
      : [];

    await AuditService.record({
      action: AuditAction.API_ACCESS,
      source: AuditSource.API,
      api_client_id: client.clientId,
      new_values: {
        resource: "SupportContacts",
        email,
        found: true,
        current_class_id: student.current_class_id,
        teacher_count: assignments.length,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toStudentSupportContactsResponse(
      student.current_class?.name ?? null,
      assignments,
    );
  }

  // Flat, one-row-per-student pull for the report-card Google Sheet (see
  // students:roster_export:read) - a scheduled Apps Script hits this
  // instead of the admin-facing multi-sheet export, which shapes data
  // relationally (one row per health note/consent/etc.) rather than one
  // row per student. Not paginated - meant to be pulled wholesale on a
  // schedule, and a school's roster is small enough for one response.
  static async rosterExport(
    client: ApiClientVariables,
    request: StudentRosterExportRequest,
    context: AuditRequestContext = {},
  ): Promise<StudentRosterExportRow[]> {
    const exportRequest = Validation.validate(
      StudentApiValidation.ROSTER_EXPORT,
      request,
    );
    // Unlike list()/lookup(), this doesn't default to ACTIVE-only - the
    // report-card sheet needs the full roster (active, graduated, etc.)
    // in one pull. deleted_at: null still excludes archived students -
    // that's a separate, stronger "gone" state than status.
    const statusFilter = exportRequest.status;

    const persons = (await prismaClient.person.findMany({
      where: {
        person_type: PersonType.STUDENT,
        deleted_at: null,
        student: {
          deleted_at: null,
          ...(statusFilter ? { status: statusFilter } : {}),
        },
      },
      orderBy: { full_name: "asc" },
      include: {
        student: {
          include: {
            current_grade: true,
            current_class: true,
            join_academic_year: true,
            join_grade: true,
            parents: { where: { deleted_at: null } },
            health: true,
            health_notes: { where: { deleted_at: null } },
            consents: {
              where: {
                deleted_at: null,
                consent_type: {
                  in: [ConsentType.MEDIA_CONSENT, ConsentType.PARENT_CONSENT],
                },
              },
            },
            // Only this year's assignment - PC activity is tracked per
            // academic year, but the sheet has one flat cell per day.
            pc: {
              where: {
                deleted_at: null,
                academic_year: { status: AcademicYearStatus.ACTIVE },
              },
              include: { activity: true },
            },
          },
        },
      },
    })) as StudentRosterExportPerson[];

    // Resolved in bounded batches, not one big Promise.all - a roster with
    // many students missing a permanent Drive link could otherwise fire
    // hundreds of presign calls at once and stall the whole export past
    // the reverse proxy's timeout. A single student's presign failing is
    // also no longer fatal to the whole request - falls back to no photo
    // for that row instead of rejecting everyone else's.
    const PHOTO_RESOLVE_BATCH_SIZE = 25;
    const rows: StudentRosterExportRow[] = [];
    for (let i = 0; i < persons.length; i += PHOTO_RESOLVE_BATCH_SIZE) {
      const batch = persons.slice(i, i + PHOTO_RESOLVE_BATCH_SIZE);
      const batchRows = await Promise.all(
        batch.map(async (person) => {
          // Prefer the legacy Google Drive link (permanent); fall back to
          // a freshly presigned MinIO URL (PHOTO_URL_EXPIRY_SECONDS, 1
          // hour) for a student with no legacy link. The consuming sheet
          // sync is expected to run roughly every hour precisely so this
          // stays valid by the time anyone opens the sheet - see
          // docs/appscript/roster-sync.gs.
          const photoUrl =
            person.photo_url ??
            (await resolveStudentPhotoUrl(person.photo_object_key, null).catch(
              () => null,
            ));
          return toStudentRosterExportRow(person, photoUrl);
        }),
      );
      rows.push(...batchRows);
    }

    await AuditService.record({
      action: AuditAction.EXPORT_DATA,
      source: AuditSource.API,
      api_client_id: client.clientId,
      new_values: {
        resource: "StudentRosterExport",
        status_filter: statusFilter ?? "ALL",
        row_count: rows.length,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    await prismaClient.syncLog.create({
      data: {
        source: `api_client:${client.clientName}`,
        total_rows: rows.length,
        synced_rows: rows.length,
        created_by: client.clientId,
      },
    });

    return rows;
  }
}
