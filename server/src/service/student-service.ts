import { ResponseError } from "../error/response-error";
import {
  AdminRole,
  AuditAction,
  AuditSource,
  PersonType,
  Prisma,
  StudentStatus,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import { paginate, type Pageable } from "../model/page-model";
import {
  buildStudentOrderBy,
  toStudentAuditSnapshot,
  toStudentDetailResponse,
  toStudentResponse,
  type CreateStudentRequest,
  type GetStudentRequest,
  type RemoveStudentRequest,
  type RestoreStudentRequest,
  type SearchStudentRequest,
  type StudentDetailResponse,
  type StudentResponse,
  type UpdateStudentRequest,
} from "../model/student-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import { StudentValidation } from "../validation/student-validation";
import { Validation } from "../validation/validation";

function rethrowAsFriendlyStudentConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("email")) {
    throw new ResponseError(400, "Email already registered");
  }
  if (fields?.includes("nis")) {
    throw new ResponseError(400, "NIS already registered");
  }
  if (fields?.includes("nisn")) {
    throw new ResponseError(400, "NISN already registered");
  }
  throw error;
}

function rethrowAsFriendlyStudentUpdateConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("email")) {
    throw new ResponseError(400, "Email already registered to another person");
  }
  if (fields?.includes("nis")) {
    throw new ResponseError(400, "NIS already registered");
  }
  if (fields?.includes("nisn")) {
    throw new ResponseError(400, "NISN already registered");
  }
  throw error;
}

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

    const createRequest = Validation.validate(
      StudentValidation.CREATE,
      request,
    );

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

    let newPerson;
    try {
      newPerson = await prismaClient.person.create({
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
        include: {
          student: { include: { current_grade: true, join_grade: true } },
        },
      });
    } catch (error) {
      rethrowAsFriendlyStudentConflict(error);
    }

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

  static async update(
    admin: AdminUser,
    request: UpdateStudentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<StudentResponse> {
    if (admin.role === AdminRole.VIEWER) {
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }

    const updateRequest = Validation.validate(
      StudentValidation.UPDATE,
      request,
    );

    const existing = await prismaClient.person.findFirst({
      where: {
        student: { id: updateRequest.id, deleted_at: null },
      },
      include: {
        student: { include: { current_grade: true, join_grade: true } },
      },
    });

    if (!existing || !existing.student) {
      throw new ResponseError(404, "Student not found");
    }

    if (admin.role === AdminRole.DATABASE_ADMIN) {
      if (!admin.can_write_data) {
        throw new ResponseError(
          403,
          "Forbidden: You don't have permission to update data",
        );
      }

      await assertCanWriteNow(admin, context, now);
    }

    const oldSnapshot = toStudentAuditSnapshot(existing, existing.student);

    const emailChanged =
      updateRequest.email && updateRequest.email !== existing.email;
    const nisChanged =
      updateRequest.nis && updateRequest.nis !== existing.student.nis;
    const nisnChanged =
      updateRequest.nisn && updateRequest.nisn !== existing.student.nisn;

    if (emailChanged || nisChanged || nisnChanged) {
      const conditions: Array<{
        email?: string;
        student?: { nis?: string; nisn?: string };
      }> = [];

      if (emailChanged) {
        conditions.push({ email: updateRequest.email });
      }
      if (nisChanged) {
        conditions.push({ student: { nis: updateRequest.nis } });
      }
      if (nisnChanged) {
        conditions.push({ student: { nisn: updateRequest.nisn } });
      }

      const duplicateCheck = await prismaClient.person.findFirst({
        where: {
          OR: conditions,
          NOT: { id: existing.id },
        },
        include: { student: true },
      });

      if (duplicateCheck) {
        if (emailChanged && duplicateCheck.email === updateRequest.email) {
          throw new ResponseError(
            400,
            "Email already registered to another person",
          );
        }
        if (nisChanged && duplicateCheck.student?.nis === updateRequest.nis) {
          throw new ResponseError(400, "NIS already registered");
        }
        if (
          nisnChanged &&
          duplicateCheck.student?.nisn === updateRequest.nisn
        ) {
          throw new ResponseError(400, "NISN already registered");
        }
      }
    }

    const effectiveCurrentGradeId =
      updateRequest.current_grade_id ?? existing.student.current_grade_id;
    const effectiveJoinGradeId =
      updateRequest.join_grade_id ?? existing.student.join_grade_id;

    if (
      updateRequest.current_grade_id !== undefined ||
      updateRequest.join_grade_id !== undefined
    ) {
      const [currentGrade, joinGrade] = await Promise.all([
        prismaClient.grade.findUnique({
          where: { id: effectiveCurrentGradeId },
        }),
        prismaClient.grade.findUnique({ where: { id: effectiveJoinGradeId } }),
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
    }

    try {
      await prismaClient.person.update({
        where: { id: existing.id },
        data: {
          full_name: updateRequest.full_name,
          nick_name: updateRequest.nick_name,
          email: updateRequest.email,
          gender: updateRequest.gender,
          religion: updateRequest.religion,
          birth_place: updateRequest.birth_place,
          birth_date: updateRequest.birth_date
            ? new Date(updateRequest.birth_date)
            : undefined,
          photo_url: updateRequest.photo_url,

          student: {
            update: {
              nis: updateRequest.nis,
              nisn: updateRequest.nisn,
              status: updateRequest.status,
              current_grade_id: updateRequest.current_grade_id,
              join_academic_year_id: updateRequest.join_academic_year_id,
              join_grade_id: updateRequest.join_grade_id,
              previous_school: updateRequest.previous_school,
              graduation_grade: updateRequest.graduation_grade,
              leave_year: updateRequest.leave_year,
              sn: updateRequest.sn,
            },
          },
        },
      });
    } catch (error) {
      rethrowAsFriendlyStudentUpdateConflict(error);
    }

    const updatedPerson = await prismaClient.person.findUnique({
      where: { id: existing.id },
      include: {
        student: { include: { current_grade: true, join_grade: true } },
      },
    });

    if (!updatedPerson || !updatedPerson.student) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve updated student data",
      );
    }

    await AuditService.record({
      action: AuditAction.UPDATE_STUDENT,
      source: AuditSource.UI,
      entity_type: "Student",
      entity_id: existing.student.id,
      admin_id: admin.id,
      old_values: oldSnapshot,
      new_values: toStudentAuditSnapshot(updatedPerson, updatedPerson.student),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toStudentResponse(updatedPerson);
  }

  static async get(
    admin: AdminUser,
    request: GetStudentRequest,
  ): Promise<StudentResponse | StudentDetailResponse> {
    const person = await prismaClient.person.findFirst({
      where: {
        student: { id: request.id, deleted_at: null },
      },
      include: {
        student: { include: { current_grade: true, join_grade: true } },
      },
    });

    if (!person || !person.student) {
      throw new ResponseError(404, "Student not found");
    }

    if (admin.role === AdminRole.SUPER_ADMIN) {
      return toStudentDetailResponse(person);
    }

    return toStudentResponse(person);
  }

  static async search(
    admin: AdminUser,
    request: SearchStudentRequest,
  ): Promise<Pageable<StudentResponse>> {
    const searchRequest = Validation.validate(
      StudentValidation.SEARCH,
      request,
    );

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const andFilters: Prisma.PersonWhereInput[] = [];

    if (searchRequest.search) {
      andFilters.push({
        OR: [
          {
            full_name: { contains: searchRequest.search, mode: "insensitive" },
          },
          {
            nick_name: { contains: searchRequest.search, mode: "insensitive" },
          },
          { email: { contains: searchRequest.search, mode: "insensitive" } },
          {
            student: {
              OR: [
                {
                  nis: { contains: searchRequest.search, mode: "insensitive" },
                },
                {
                  nisn: { contains: searchRequest.search, mode: "insensitive" },
                },
              ],
            },
          },
        ],
      });
    }

    if (searchRequest.gender) {
      andFilters.push({ gender: searchRequest.gender });
    }
    if (searchRequest.religion) {
      andFilters.push({ religion: searchRequest.religion });
    }

    const studentFilters: Prisma.StudentWhereInput = {};

    if (searchRequest.status) studentFilters.status = searchRequest.status;
    if (searchRequest.current_grade_id)
      studentFilters.current_grade_id = searchRequest.current_grade_id;
    if (searchRequest.current_class_id)
      studentFilters.current_class_id = searchRequest.current_class_id;
    if (searchRequest.join_academic_year_id)
      studentFilters.join_academic_year_id =
        searchRequest.join_academic_year_id;

    studentFilters.deleted_at = searchRequest.is_deleted ? { not: null } : null;

    if (Object.keys(studentFilters).length > 0) {
      andFilters.push({ student: studentFilters });
    }

    const whereClause: Prisma.PersonWhereInput = {
      person_type: PersonType.STUDENT,
      AND: andFilters,
    };

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.person.count({ where: whereClause }),
      findMany: () =>
        prismaClient.person
          .findMany({
            where: whereClause,
            take: searchRequest.size,
            skip: skip,
            orderBy: buildStudentOrderBy(
              searchRequest.sort_by || "created_at",
              searchRequest.sort_order || "desc",
            ),
            include: {
              student: {
                include: {
                  current_grade: true,
                  join_grade: true,
                },
              },
            },
          })
          .then((persons) => {
            const data: StudentResponse[] = [];
            for (const person of persons) {
              if (person.student) {
                data.push(toStudentResponse(person));
              }
            }
            return data;
          }),
    });
  }

  static async remove(
    admin: AdminUser,
    request: RemoveStudentRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete student data",
      );
    }

    const target = await prismaClient.student.findUnique({
      where: { id: request.id },
      select: { id: true, deleted_at: true, status: true },
    });

    if (!target) {
      throw new ResponseError(404, "Student not found");
    }

    if (target.deleted_at !== null) {
      throw new ResponseError(400, "Student is already deleted");
    }

    const deletedAt = new Date();
    await prismaClient.student.update({
      where: { id: request.id },
      data: {
        deleted_at: deletedAt,
        status: StudentStatus.ARCHIVED,
      },
    });

    await AuditService.record({
      action: AuditAction.DELETE_STUDENT,
      source: AuditSource.UI,
      entity_type: "Student",
      entity_id: target.id,
      admin_id: admin.id,
      old_values: { status: target.status },
      new_values: {
        status: StudentStatus.ARCHIVED,
        deleted_at: deletedAt.toISOString(),
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return true;
  }

  static async restore(
    admin: AdminUser,
    request: RestoreStudentRequest,
    context: AuditRequestContext = {},
  ): Promise<StudentResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can restore student data",
      );
    }

    const target = await prismaClient.student.findUnique({
      where: { id: request.id },
      select: { id: true, deleted_at: true, person_id: true, status: true },
    });

    if (!target) {
      throw new ResponseError(404, "Student not found");
    }

    if (target.deleted_at === null) {
      throw new ResponseError(
        400,
        "Student is not in the trash bin. It might be active or permanently deleted.",
      );
    }

    await prismaClient.student.update({
      where: { id: request.id },
      data: {
        deleted_at: null,
        status: StudentStatus.ACTIVE,
      },
    });

    const restoredPerson = await prismaClient.person.findUnique({
      where: { id: target.person_id },
      include: {
        student: { include: { current_grade: true, join_grade: true } },
      },
    });

    if (!restoredPerson || !restoredPerson.student) {
      throw new ResponseError(
        500,
        "Internal Server Error: Failed to retrieve restored student data",
      );
    }

    await AuditService.record({
      action: AuditAction.UPDATE_STUDENT,
      source: AuditSource.UI,
      entity_type: "Student",
      entity_id: target.id,
      admin_id: admin.id,
      old_values: {
        status: target.status,
        deleted_at: target.deleted_at.toISOString(),
      },
      new_values: { status: StudentStatus.ACTIVE, deleted_at: null },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toStudentResponse(restoredPerson);
  }
}
