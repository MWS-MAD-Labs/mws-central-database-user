import {
  AdminRole,
  AuditAction,
  AuditSource,
  Prisma,
  type AcademicSemester,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toAcademicSemesterAuditSnapshot,
  toAcademicSemesterResponse,
  type AcademicSemesterResponse,
  type CreateAcademicSemesterRequest,
  type UpdateAcademicSemesterRequest,
} from "../model/academic-semester-model";
import { AcademicSemesterValidation } from "../validation/academic-semester-validation";
import { Validation } from "../validation/validation";
import { AuditService } from "./audit-service";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SEMESTERS = 4;

function assertSuperAdmin(admin: AdminUser, action: string) {
  if (admin.role !== AdminRole.SUPER_ADMIN) {
    throw new ResponseError(403, `Forbidden: Only Super Admin can ${action}`);
  }
}

const day = (value: Date) => value.toISOString().slice(0, 10);

// Two parts of a year: the first half and the day after it to the end. A year with no end date has no halves to make.
export function defaultSemesterDates(start: Date, end: Date): { name: string; start_date: Date; end_date: Date }[] {
  const days = Math.floor((end.getTime() - start.getTime()) / DAY_MS);
  const firstEnd = new Date(start.getTime() + Math.floor(days / 2) * DAY_MS);
  return [
    { name: "Semester 1", start_date: start, end_date: firstEnd },
    { name: "Semester 2", start_date: new Date(firstEnd.getTime() + DAY_MS), end_date: end },
  ];
}

// The dates have to be inside the year, in order, and not overlap another semester of it.
function assertDatesFit(
  year: { name: string; start_date: Date; end_date: Date | null },
  start: Date,
  end: Date,
  others: Pick<AcademicSemester, "name" | "start_date" | "end_date">[],
) {
  if (start > end) throw new ResponseError(400, "The start date cannot be after the end date");
  if (start < year.start_date || (year.end_date && end > year.end_date)) {
    throw new ResponseError(
      400,
      `The semester has to be inside ${year.name}, which runs from ${day(year.start_date)}${year.end_date ? ` to ${day(year.end_date)}` : ""}`,
    );
  }
  const clash = others.find((other) => start <= other.end_date && end >= other.start_date);
  if (clash) {
    throw new ResponseError(
      400,
      `The dates overlap ${clash.name}, which runs from ${day(clash.start_date)} to ${day(clash.end_date)}`,
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export class AcademicSemesterService {
  static async list(academicYearId: string): Promise<AcademicSemesterResponse[]> {
    const year = await prismaClient.academicYear.findUnique({ where: { id: academicYearId }, select: { id: true } });
    if (!year) throw new ResponseError(404, "Academic year not found");
    const rows = await prismaClient.academicSemester.findMany({
      where: { academic_year_id: academicYearId },
      orderBy: { position: "asc" },
    });
    return rows.map(toAcademicSemesterResponse);
  }

  static async create(
    admin: AdminUser,
    request: CreateAcademicSemesterRequest,
    context: AuditRequestContext = {},
  ): Promise<AcademicSemesterResponse> {
    assertSuperAdmin(admin, "add a semester");
    const input = Validation.validate(AcademicSemesterValidation.CREATE, request);
    const year = await prismaClient.academicYear.findUnique({ where: { id: input.academic_year_id } });
    if (!year) throw new ResponseError(404, "Academic year not found");
    const existing = await prismaClient.academicSemester.findMany({ where: { academic_year_id: year.id } });
    if (existing.length >= MAX_SEMESTERS) {
      throw new ResponseError(400, `A year can have at most ${MAX_SEMESTERS} semesters`);
    }
    if (existing.some((row) => row.name.toLowerCase() === input.name.toLowerCase())) {
      throw new ResponseError(400, "A semester with this name already exists in the year");
    }
    const start = new Date(input.start_date);
    const end = new Date(input.end_date);
    assertDatesFit(year, start, end, existing);
    const position = Math.max(0, ...existing.map((row) => row.position)) + 1;
    try {
      const created = await prismaClient.$transaction(async (tx) => {
        const row = await tx.academicSemester.create({
          data: { academic_year_id: year.id, name: input.name, position, start_date: start, end_date: end },
        });
        await AuditService.record(
          {
            action: AuditAction.CREATE_ACADEMIC_SEMESTER,
            source: AuditSource.UI,
            entity_type: "AcademicSemester",
            entity_id: row.id,
            admin_id: admin.id,
            new_values: toAcademicSemesterAuditSnapshot(row),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );
        return row;
      });
      return toAcademicSemesterResponse(created);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ResponseError(400, "Another change took this name or place. Reload and try again");
      throw error;
    }
  }

  // Semester 1 and Semester 2 for a year that has none yet, so the school does not type the dates twice.
  static async createDefaults(
    admin: AdminUser,
    academicYearId: string,
    context: AuditRequestContext = {},
  ): Promise<AcademicSemesterResponse[]> {
    assertSuperAdmin(admin, "add semesters");
    const year = await prismaClient.academicYear.findUnique({ where: { id: academicYearId } });
    if (!year) throw new ResponseError(404, "Academic year not found");
    if (!year.end_date) throw new ResponseError(400, "Set an end date for the year first");
    const have = await prismaClient.academicSemester.count({ where: { academic_year_id: year.id } });
    if (have > 0) throw new ResponseError(400, "This year has semesters already");
    const dates = defaultSemesterDates(year.start_date, year.end_date);
    try {
      const rows = await prismaClient.$transaction(async (tx) => {
        const made: AcademicSemester[] = [];
        for (const [index, item] of dates.entries()) {
          const row = await tx.academicSemester.create({
            data: { academic_year_id: year.id, position: index + 1, ...item },
          });
          await AuditService.record(
            {
              action: AuditAction.CREATE_ACADEMIC_SEMESTER,
              source: AuditSource.UI,
              entity_type: "AcademicSemester",
              entity_id: row.id,
              admin_id: admin.id,
              new_values: toAcademicSemesterAuditSnapshot(row),
              ip_address: context.ip_address,
              user_agent: context.user_agent,
            },
            tx,
          );
          made.push(row);
        }
        return made;
      });
      return rows.map(toAcademicSemesterResponse);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ResponseError(400, "This year has semesters already");
      throw error;
    }
  }

  static async update(
    admin: AdminUser,
    request: UpdateAcademicSemesterRequest,
    context: AuditRequestContext = {},
  ): Promise<AcademicSemesterResponse> {
    assertSuperAdmin(admin, "change a semester");
    const input = Validation.validate(AcademicSemesterValidation.UPDATE, request);
    const current = await prismaClient.academicSemester.findUnique({ where: { id: input.id }, include: { academic_year: true } });
    if (!current) throw new ResponseError(404, "Semester not found");
    const siblings = await prismaClient.academicSemester.findMany({
      where: { academic_year_id: current.academic_year_id, id: { not: current.id } },
    });
    const name = input.name ?? current.name;
    if (siblings.some((row) => row.name.toLowerCase() === name.toLowerCase())) {
      throw new ResponseError(400, "A semester with this name already exists in the year");
    }
    const start = input.start_date ? new Date(input.start_date) : current.start_date;
    const end = input.end_date ? new Date(input.end_date) : current.end_date;
    assertDatesFit(current.academic_year, start, end, siblings);
    try {
      const saved = await prismaClient.$transaction(async (tx) => {
        const row = await tx.academicSemester.update({ where: { id: current.id }, data: { name, start_date: start, end_date: end } });
        await AuditService.record(
          {
            action: AuditAction.UPDATE_ACADEMIC_SEMESTER,
            source: AuditSource.UI,
            entity_type: "AcademicSemester",
            entity_id: row.id,
            admin_id: admin.id,
            old_values: toAcademicSemesterAuditSnapshot(current),
            new_values: toAcademicSemesterAuditSnapshot(row),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );
        return row;
      });
      return toAcademicSemesterResponse(saved);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ResponseError(400, "A semester with this name already exists in the year");
      throw error;
    }
  }

  static async remove(admin: AdminUser, id: string, context: AuditRequestContext = {}): Promise<void> {
    assertSuperAdmin(admin, "delete a semester");
    const current = await prismaClient.academicSemester.findUnique({ where: { id } });
    if (!current) throw new ResponseError(404, "Semester not found");
    await prismaClient.$transaction(async (tx) => {
      await tx.academicSemester.delete({ where: { id } });
      await AuditService.record(
        {
          action: AuditAction.DELETE_ACADEMIC_SEMESTER,
          source: AuditSource.UI,
          entity_type: "AcademicSemester",
          entity_id: id,
          admin_id: admin.id,
          old_values: toAcademicSemesterAuditSnapshot(current),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });
  }
}
