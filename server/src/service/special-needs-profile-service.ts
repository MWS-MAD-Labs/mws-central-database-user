import {
  AdminRole,
  AuditAction,
  AuditSource,
  StudentSupportRole,
  type AdminUser,
  type Prisma,
} from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toSpecialNeedsProfileAuditSnapshot,
  toSpecialNeedsProfileResponse,
  type SpecialNeedsProfileRequest,
  type SpecialNeedsProfileResponse,
  type SpecialNeedsProfileWithNeeds,
} from "../model/special-needs-profile-model";
import { assertCanWriteNow } from "../utils/office-hours";
import { assertCanViewSensitiveData, assertCanViewStudentInScope, assertStudentInAdminUnit } from "../utils/sensitive-data";
import { lockStudentSpecialNeeds } from "../utils/student-special-needs-lock";
import { SpecialNeedsProfileValidation } from "../validation/special-needs-profile-validation";
import { Validation } from "../validation/validation";
import { AuditService } from "./audit-service";

const asDate = (value: string | undefined) => (value ? new Date(value) : null);

const profileData = (profile: SpecialNeedsProfileRequest) => ({
  learning_support_summary: profile.learning_support_summary ?? null,
  accommodations: profile.accommodations ?? null,
  has_professional_report: profile.has_professional_report ?? false,
  report_date: asDate(profile.report_date),
  identified_date: asDate(profile.identified_date),
});

async function assertWriteAllowed(admin: AdminUser, studentId: string, context: AuditRequestContext, now: Date): Promise<void> {
  if (admin.role === AdminRole.VIEWER) throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_student_data) throw new ResponseError(403, "Forbidden: You don't have permission to write student data");
    await assertCanWriteNow(admin, context, now);
    await assertStudentInAdminUnit(admin, studentId, context);
  }
}

async function studentName(studentId: string): Promise<string> {
  const student = await prismaClient.student.findFirst({
    where: { id: studentId, deleted_at: null },
    select: { person: { select: { full_name: true } } },
  });
  if (!student) throw new ResponseError(404, "Student not found");
  return student.person.full_name;
}

export class SpecialNeedsProfileService {
  // Writes the profile inside a transaction and marks the student Special Needs. A removed profile is restored.
  // The student create uses this too, so one write covers the flag and the details.
  static async writeInTransaction(
    tx: Prisma.TransactionClient,
    admin: AdminUser,
    studentId: string,
    studentFullName: string,
    profile: SpecialNeedsProfileRequest,
    context: AuditRequestContext,
  ): Promise<SpecialNeedsProfileWithNeeds> {
    await lockStudentSpecialNeeds(tx, studentId);
    const existing = await tx.studentSpecialNeedsProfile.findUnique({ where: { student_id: studentId }, include: { needs: true } });
    const data = { ...profileData(profile), deleted_at: null };
    const saved = existing
      ? await tx.studentSpecialNeedsProfile.update({ where: { id: existing.id }, data })
      : await tx.studentSpecialNeedsProfile.create({ data: { ...data, student_id: studentId } });
    await tx.studentSpecialNeed.deleteMany({ where: { profile_id: saved.id } });
    await tx.studentSpecialNeed.createMany({
      data: profile.needs.map((need) => ({
        profile_id: saved.id,
        need_type: need.need_type,
        description: need.description,
      })),
    });
    const savedWithNeeds = await tx.studentSpecialNeedsProfile.findUniqueOrThrow({
      where: { id: saved.id },
      include: { needs: { orderBy: { need_type: "asc" } } },
    });
    await tx.student.update({ where: { id: studentId }, data: { sn: true } });
    const existingRow = Boolean(existing);
    await AuditService.record(
      {
        action: existingRow ? AuditAction.UPDATE_SPECIAL_NEEDS_PROFILE : AuditAction.CREATE_SPECIAL_NEEDS_PROFILE,
        source: AuditSource.UI,
        entity_type: "StudentSpecialNeedsProfile",
        entity_id: saved.id,
        admin_id: admin.id,
        ...(existing ? { old_values: toSpecialNeedsProfileAuditSnapshot(existing, studentFullName) } : {}),
        new_values: toSpecialNeedsProfileAuditSnapshot(savedWithNeeds, studentFullName),
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      },
      tx,
    );
    return savedWithNeeds;
  }

  static async removeInTransaction(
    tx: Prisma.TransactionClient,
    admin: AdminUser,
    studentId: string,
    studentFullName: string,
    context: AuditRequestContext,
    now: Date,
  ): Promise<void> {
    await lockStudentSpecialNeeds(tx, studentId);
    const active = await tx.studentSupportAssignment.count({
      where: { student_id: studentId, role: StudentSupportRole.SPECIAL_ED, end_date: null, deleted_at: null },
    });
    if (active > 0) throw new ResponseError(400, "End the active SE Teacher assignment before clearing Special Needs eligibility.");
    const existing = await tx.studentSpecialNeedsProfile.findFirst({ where: { student_id: studentId, deleted_at: null }, include: { needs: true } });
    if (existing) {
      const removed = await tx.studentSpecialNeedsProfile.update({ where: { id: existing.id }, data: { deleted_at: now } });
      await AuditService.record(
        {
          action: AuditAction.DELETE_SPECIAL_NEEDS_PROFILE,
          source: AuditSource.UI,
          entity_type: "StudentSpecialNeedsProfile",
          entity_id: removed.id,
          admin_id: admin.id,
          old_values: toSpecialNeedsProfileAuditSnapshot(existing, studentFullName),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    }
    await tx.student.update({ where: { id: studentId }, data: { sn: false } });
  }

  static async save(
    admin: AdminUser,
    request: { student_id: string; profile: SpecialNeedsProfileRequest },
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<SpecialNeedsProfileResponse> {
    await assertWriteAllowed(admin, request.student_id, context, now);
    await assertCanViewSensitiveData(admin, context);
    const saveRequest = Validation.validate(SpecialNeedsProfileValidation.SAVE, request);
    const name = await studentName(saveRequest.student_id);
    const saved = await prismaClient.$transaction((tx) =>
      SpecialNeedsProfileService.writeInTransaction(tx, admin, saveRequest.student_id, name, saveRequest.profile, context),
    );
    return toSpecialNeedsProfileResponse(saved);
  }

  static async get(admin: AdminUser, request: { student_id: string }, context: AuditRequestContext = {}): Promise<SpecialNeedsProfileResponse> {
    await assertCanViewSensitiveData(admin, context);
    const getRequest = Validation.validate(SpecialNeedsProfileValidation.ID, request);
    await assertCanViewStudentInScope(admin, getRequest.student_id);
    const profile = await prismaClient.studentSpecialNeedsProfile.findFirst({
      where: { student_id: getRequest.student_id, deleted_at: null },
      include: { needs: { orderBy: { need_type: "asc" } } },
    });
    if (!profile) throw new ResponseError(404, "Special Needs profile not found");
    return toSpecialNeedsProfileResponse(profile);
  }

  // Clears the Special Needs status with the profile. Refused while an SE Teacher is still assigned.
  static async remove(admin: AdminUser, request: { student_id: string }, context: AuditRequestContext = {}, now: Date = new Date()): Promise<void> {
    await assertWriteAllowed(admin, request.student_id, context, now);
    await assertCanViewSensitiveData(admin, context);
    const removeRequest = Validation.validate(SpecialNeedsProfileValidation.ID, request);
    const name = await studentName(removeRequest.student_id);
    await prismaClient.$transaction((tx) =>
      SpecialNeedsProfileService.removeInTransaction(tx, admin, removeRequest.student_id, name, context, now),
    );
  }
}
