import type { Prisma } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import { paginate, type Pageable } from "../model/page-model";
import {
  toStudentSupportAssignmentResponse,
  type StudentSupportAssignmentListRequest,
  type StudentSupportAssignmentResponse,
  type StudentSupportAssignmentWithRelations,
} from "../model/student-support-assignment-api-model";
import type { ApiClientVariables } from "../type/hono-context";
import { StudentSupportAssignmentApiValidation } from "../validation/student-support-assignment-api-validation";
import { Validation } from "../validation/validation";

const ASSIGNMENT_INCLUDE = {
  employee: { include: { person: true } },
  student: { include: { person: true } },
} as const;

export class StudentSupportAssignmentApiService {
  // Same posture as ClassTeacherAssignmentApiService.list() - not audit-
  // logged, this is a routine roster-scoping sync poll (e.g. MTSS
  // re-syncing which students an SE teacher's account maps to), not
  // access to any one person's record.
  static async list(
    _client: ApiClientVariables,
    request: StudentSupportAssignmentListRequest,
    _context: AuditRequestContext = {},
  ): Promise<Pageable<StudentSupportAssignmentResponse>> {
    const listRequest = Validation.validate(
      StudentSupportAssignmentApiValidation.LIST,
      request,
    );

    // Only currently-active assignments - a consuming app wants "who is
    // this SE teacher supporting right now", not historical ones.
    const whereClause: Prisma.StudentSupportAssignmentWhereInput = {
      end_date: null,
    };

    return paginate(listRequest.page, listRequest.size, {
      count: () =>
        prismaClient.studentSupportAssignment.count({ where: whereClause }),
      findMany: () =>
        prismaClient.studentSupportAssignment
          .findMany({
            where: whereClause,
            take: listRequest.size,
            skip: (listRequest.page - 1) * listRequest.size,
            orderBy: { created_at: "desc" },
            include: ASSIGNMENT_INCLUDE,
          })
          .then((assignments) =>
            (assignments as StudentSupportAssignmentWithRelations[]).map(
              toStudentSupportAssignmentResponse,
            ),
          ),
    });
  }
}
