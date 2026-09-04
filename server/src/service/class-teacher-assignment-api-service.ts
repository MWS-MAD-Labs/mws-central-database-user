import {
  AcademicYearStatus,
  ClassStatus,
  type Prisma,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import { paginate, type Pageable } from "../model/page-model";
import {
  toClassTeacherAssignmentResponse,
  type ClassTeacherAssignmentListRequest,
  type ClassTeacherAssignmentResponse,
  type ClassTeacherAssignmentWithRelations,
} from "../model/class-teacher-assignment-api-model";
import type { ApiClientVariables } from "../type/hono-context";
import { ClassTeacherAssignmentApiValidation } from "../validation/class-teacher-assignment-api-validation";
import { Validation } from "../validation/validation";

const ASSIGNMENT_INCLUDE = {
  class: {
    include: {
      grade: { include: { unit: true } },
      additional_grades: { include: { grade: true } },
    },
  },
  employee: { include: { person: true } },
} as const;

export class ClassTeacherAssignmentApiService {
  // Same posture as EmployeeApiService.list()/StudentApiService.list() -
  // not audit-logged, this is a routine roster-scoping sync poll (e.g.
  // MTSS re-syncing which classes a teacher's account maps to), not access
  // to any one person's record.
  static async list(
    _client: ApiClientVariables,
    request: ClassTeacherAssignmentListRequest,
    _context: AuditRequestContext = {},
  ): Promise<Pageable<ClassTeacherAssignmentResponse>> {
    const listRequest = Validation.validate(
      ClassTeacherAssignmentApiValidation.LIST,
      request,
    );

    // Only currently-active assignments in a currently-active academic
    // year - a consuming app wants "who's really teaching this class right
    // now", not historical assignments.
    const whereClause: Prisma.ClassTeacherAssignmentWhereInput = {
      deleted_at: null,
      end_date: null,
      class: {
        status: ClassStatus.ACTIVE,
        academic_year: { status: AcademicYearStatus.ACTIVE },
      },
    };

    return paginate(listRequest.page, listRequest.size, {
      count: () => prismaClient.classTeacherAssignment.count({ where: whereClause }),
      findMany: () =>
        prismaClient.classTeacherAssignment
          .findMany({
            where: whereClause,
            take: listRequest.size,
            skip: (listRequest.page - 1) * listRequest.size,
            orderBy: { created_at: "desc" },
            include: ASSIGNMENT_INCLUDE,
          })
          .then((assignments) =>
            (assignments as ClassTeacherAssignmentWithRelations[]).map(
              toClassTeacherAssignmentResponse,
            ),
          ),
    });
  }
}
