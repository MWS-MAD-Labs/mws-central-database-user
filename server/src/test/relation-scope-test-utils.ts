import { randomUUID } from "crypto";
import { prismaClient } from "../lib/prisma";
import { AdminUserTest } from "./test-utils";

export type StudentRelationScope = "own" | "selected" | "all" | "outside";

export async function createStudentRelationAdmin(
  studentId: string,
  scope: StudentRelationScope,
  options: { canViewSensitiveData?: boolean } = {},
): Promise<{ accessToken: string }> {
  const student = await prismaClient.student.findUniqueOrThrow({
    where: { id: studentId },
    select: { current_grade: { select: { unit_id: true } } },
  });
  const targetUnitId = student.current_grade.unit_id;
  const suffix = randomUUID().slice(0, 8);
  const ownUnit =
    scope === "own"
      ? { id: targetUnitId }
      : await prismaClient.masterUnit.create({
          data: { name: `TEST_RELATION_SCOPE_${suffix}` },
        });
  const adminId = `test-rel-scope-${suffix}`;
  const admin = await AdminUserTest.createDatabaseAdmin(ownUnit.id, {
    id: adminId,
    email: `test_relation_scope_${suffix}@millennia21.id`,
    canViewSensitiveData: options.canViewSensitiveData,
    canViewAllStudentUnits: scope === "all",
  });

  if (scope === "selected") {
    await prismaClient.adminUserStudentViewUnit.create({
      data: { admin_id: adminId, unit_id: targetUnitId },
    });
  }

  return admin;
}
