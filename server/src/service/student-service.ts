import { ResponseError } from "../error/response-error";
import {
  AdminRole,
  AuditAction,
  AuditSource,
  PersonType,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toStudentAuditSnapshot,
  toStudentDetailResponse,
  toStudentResponse,
  type CreateStudentRequest,
  type GetStudentRequest,
  type StudentDetailResponse,
  type StudentResponse,
} from "../model/student-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { StudentValidation } from "../validation/student-validation";
import { Validation } from "../validation/validation";

export class StudentService {
  static async create(
    admin: AdminUser,
    request: CreateStudentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<StudentResponse> {
    if (admin.role === AdminRole.VIEWER) {
      throw new ResponseError(403, "Forbidden: Viewer cannot create data");
    }

    if (admin.role === AdminRole.DATABASE_ADMIN) {
      if (!admin.can_write_data) {
        throw new ResponseError(
          403,
          "Forbidden: You don't have permission to create data",
        );
      }

      await assertCanWriteNow(admin, context, now);
    }

    const createRequest = Validation.validate(StudentValidation.CREATE, request);

    const existingUser = await prismaClient.person.findFirst({
      where: {
        OR: [
          { email: createRequest.email },
          { student: { nis: createRequest.nis } },
          ...(createRequest.nisn
            ? [{ student: { nisn: createRequest.nisn } }]
            : []),
        ],
      },
      include: { student: true },
    });

    if (existingUser) {
      if (existingUser.email === createRequest.email) {
        throw new ResponseError(400, "Email already registered");
      }
      if (existingUser.student?.nis === createRequest.nis) {
        throw new ResponseError(400, "NIS already registered");
      }
      if (
        createRequest.nisn &&
        existingUser.student?.nisn === createRequest.nisn
      ) {
        throw new ResponseError(400, "NISN already registered");
      }
    }

    const [currentGrade, joinGrade] = await Promise.all([
      prismaClient.grade.findUnique({
        where: { id: createRequest.current_grade_id },
      }),
      prismaClient.grade.findUnique({
        where: { id: createRequest.join_grade_id },
      }),
    ]);

    if (!currentGrade) {
      throw new ResponseError(400, "Invalid current grade: grade not found");
    }
    if (!joinGrade) {
      throw new ResponseError(400, "Invalid join grade: grade not found");
    }
    if (currentGrade.level < joinGrade.level) {
      throw new ResponseError(
        400,
        "Current grade cannot be lower than the grade the student joined at",
      );
    }

    const newPerson = await prismaClient.person.create({
      data: {
        full_name: createRequest.full_name,
        nick_name: createRequest.nick_name,
        email: createRequest.email,
        person_type: PersonType.STUDENT,
        gender: createRequest.gender,
        religion: createRequest.religion,
        birth_place: createRequest.birth_place,
        birth_date: new Date(createRequest.birth_date),
        photo_url: createRequest.photo_url,
        student: {
          create: {
            nis: createRequest.nis,
            nisn: createRequest.nisn,
            status: createRequest.status,
            current_grade_id: createRequest.current_grade_id,
            join_academic_year_id: createRequest.join_academic_year_id,
            join_grade_id: createRequest.join_grade_id,
            previous_school: createRequest.previous_school,
          },
        },
      },
      include: { student: { include: { current_grade: true, join_grade: true } } },
    });

    if (!newPerson.student) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve created student data",
      );
    }

    await AuditService.record({
      action: AuditAction.CREATE_STUDENT,
      source: AuditSource.UI,
      entity_type: "Student",
      entity_id: newPerson.student.id,
      admin_id: admin.id,
      new_values: toStudentAuditSnapshot(newPerson, newPerson.student),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toStudentResponse(newPerson);
  }

  static async get(
    admin: AdminUser,
    request: GetStudentRequest,
  ): Promise<StudentResponse | StudentDetailResponse> {
    const person = await prismaClient.person.findFirst({
      where: {
        student: { id: request.id, deleted_at: null },
      },
      include: { student: { include: { current_grade: true, join_grade: true } } },
    });

    if (!person || !person.student) {
      throw new ResponseError(404, "Student not found");
    }

    if (admin.role === AdminRole.SUPER_ADMIN) {
      return toStudentDetailResponse(person);
    }

    return toStudentResponse(person);
  }
}
