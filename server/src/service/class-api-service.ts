import {
  AcademicYearStatus,
  ClassStatus,
  type Prisma,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import { paginate, type Pageable } from "../model/page-model";
import {
  toClassResponseForApi,
  type ClassListRequest,
  type ClassResponseForApi,
  type ClassWithRelationsForApi,
} from "../model/class-api-model";
import type { ApiClientVariables } from "../type/hono-context";
import { ClassApiValidation } from "../validation/class-api-validation";
import { Validation } from "../validation/validation";

const CLASS_INCLUDE = {
  grade: { include: { unit: true } },
  additional_grades: { include: { grade: true } },
  academic_year: true,
} as const;

export class ClassApiService {
  // Every active class in the active academic year, independent of whether
  // it has a teacher assigned yet - listAllClassTeacherAssignments() only
  // surfaces classes that already have one, which silently hides a class
  // (and any student enrolled into it) from consumers until a teacher is
  // assigned.
  static async list(
    _client: ApiClientVariables,
    request: ClassListRequest,
    _context: AuditRequestContext = {},
  ): Promise<Pageable<ClassResponseForApi>> {
    const listRequest = Validation.validate(ClassApiValidation.LIST, request);

    const whereClause: Prisma.ClassWhereInput = {
      status: ClassStatus.ACTIVE,
      academic_year: { status: AcademicYearStatus.ACTIVE },
    };

    return paginate(listRequest.page, listRequest.size, {
      count: () => prismaClient.class.count({ where: whereClause }),
      findMany: () =>
        prismaClient.class
          .findMany({
            where: whereClause,
            take: listRequest.size,
            skip: (listRequest.page - 1) * listRequest.size,
            orderBy: { created_at: "desc" },
            include: CLASS_INCLUDE,
          })
          .then((classes) =>
            (classes as ClassWithRelationsForApi[]).map(toClassResponseForApi),
          ),
    });
  }
}
