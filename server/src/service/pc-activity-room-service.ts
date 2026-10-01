import {
  AdminRole,
  AuditAction,
  EmployeeStatus,
  EnrollmentStatus,
  InternStatus,
  StudentStatus,
  AuditSource,
  type PCDay,
  PcActivityAssignmentStatus,
  PcActivityMentorAssignmentStatus,
  Prisma,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toBulkActionResponse,
  type BulkActionItemResponse,
  type BulkActionResponse,
} from "../model/bulk-action-model";
import { paginate, type Pageable } from "../model/page-model";
import {
  toPcActivityRoomMentorAssignmentResponse,
  toPcActivityRoomResponse,
  type AssignPcActivityRoomMentorRequest,
  type BulkAssignPcActivityRoomMentorsRequest,
  type BulkAssignPcActivityRoomStudentsRequest,
  type BulkEndPcActivityRoomMentorAssignmentsRequest,
  type BulkEndPcActivityRoomStudentAssignmentsRequest,
  type BulkDropPcActivityRoomStudentAssignmentsRequest,
  type BulkMovePcActivityRoomMentorAssignmentsRequest,
  type BulkMovePcActivityRoomStudentAssignmentsRequest,
  type BulkRemovePcActivityRoomMentorAssignmentsRequest,
  type BulkReopenPcActivityRoomMentorAssignmentsRequest,
  type BulkReopenPcActivityRoomStudentAssignmentsRequest,
  type CreatePcActivityRoomRequest,
  type DeletePcActivityRoomRequest,
  type DropPcActivityRoomStudentAssignmentRequest,
  type EndPcActivityRoomStudentAssignmentRequest,
  type EndPcActivityRoomMentorAssignmentRequest,
  type GetPcActivityRoomRequest,
  type ListPcActivityRoomEligibleStudentsRequest,
  type ListPcActivityRoomEligibleMentorsRequest,
  type ListPcActivityRoomMentorsRequest,
  type ListPcActivityRoomStudentsRequest,
  type ListPcActivityRoomsRequest,
  type MovePcActivityRoomMentorAssignmentRequest,
  type MovePcActivityRoomStudentRequest,
  type PcActivityRoomEligibleStudentResponse,
  type PcActivityRoomEligibleMentorResponse,
  type PcActivityRoomMentorAssignmentResponse,
  type PcActivityRoomMentorshipHistoryResponse,
  type PcActivityRoomResponse,
  type PcActivityRoomStudentResponse,
  type RemovePcActivityRoomMentorAssignmentRequest,
  type ReopenPcActivityRoomMentorAssignmentRequest,
  type ReopenPcActivityRoomStudentAssignmentRequest,
  type ReassignPcActivityRoomStudentRequest,
  type UpdatePcActivityRoomRequest,
  type UpdatePcActivityRoomAssignmentStartDateRequest,
  type BulkUpdatePcActivityRoomAssignmentStartDatesRequest,
} from "../model/pc-activity-room-model";
import {
  toPCActivityResponse,
  type PCActivityResponse,
} from "../model/pc-activity-model";
import { PcActivityRoomValidation } from "../validation/pc-activity-room-validation";
import { Validation } from "../validation/validation";
import { AuditService } from "./audit-service";
import {
  PCActivityService,
  assertMentorIsEligible,
  assertRoomStudentCapacity,
} from "./pc-activity-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { assertAcademicUnitIds } from "../utils/academic-units";
import { lockInternWorkforce } from "../utils/intern-workforce-lock";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import {
  assertCanManageEnrollments,
  assertCanManageTeacherAssignments,
} from "../utils/admin-permissions";

function bulkFailureMessage(error: unknown): string {
  if (error instanceof ResponseError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

function resolveRoomPeriod(
  durationType: "SIX_MONTHS" | "HALF_SEMESTER" | "SEMESTER" | "FULL_YEAR" | "CUSTOM",
  academicYearStartDate: Date,
  academicYearEndDate: Date | null,
  customDurationDays?: number | null,
): { startDate: Date; endDate: Date } {
  if (!academicYearEndDate) {
    throw new ResponseError(400, "Academic year needs an end date before PC Activity rooms can be created");
  }
  const startDate = new Date(academicYearStartDate);
  const totalMs = academicYearEndDate.getTime() - startDate.getTime();
  const semesterMs = totalMs / 2;
  let durationMs = totalMs;
  if (durationType === "SEMESTER") durationMs = semesterMs;
  if (durationType === "HALF_SEMESTER") durationMs = semesterMs / 2;
  if (durationType === "SIX_MONTHS") {
    const sixMonthEnd = new Date(startDate);
    sixMonthEnd.setMonth(sixMonthEnd.getMonth() + 6);
    durationMs = Math.min(sixMonthEnd.getTime() - startDate.getTime(), semesterMs);
  }
  if (durationType === "CUSTOM") {
    durationMs = (customDurationDays ?? 0) * 24 * 60 * 60 * 1000;
    if (durationMs <= 0 || durationMs > semesterMs) {
      throw new ResponseError(400, "Custom duration must be greater than zero and no longer than one semester");
    }
  }
  return { startDate, endDate: new Date(startDate.getTime() + durationMs) };
}

async function assertRoomWriteAllowed(
  admin: AdminUser,
  context: AuditRequestContext,
  now: Date,
): Promise<void> {
  if (admin.role === AdminRole.VIEWER) {
    throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_student_data) {
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to write student data",
      );
    }
    await assertCanWriteNow(admin, context, now);
  }
}

async function assertStudentWriteAllowed(
  admin: AdminUser,
  context: AuditRequestContext,
  now: Date,
): Promise<void> {
  if (admin.role === AdminRole.VIEWER) {
    throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    assertCanManageEnrollments(admin);
    await assertCanWriteNow(admin, context, now);
  }
}

async function assertMentorWriteAllowed(
  admin: AdminUser,
  context: AuditRequestContext,
  now: Date,
): Promise<void> {
  if (admin.role === AdminRole.VIEWER) {
    throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    assertCanManageTeacherAssignments(admin);
    await assertCanWriteNow(admin, context, now);
  }
}

// A DATABASE_ADMIN may access rooms that include their unit.
function assertRoomInAdminUnit(admin: AdminUser, unitIds: string[]): void {
  if (
    admin.role === AdminRole.DATABASE_ADMIN &&
    !unitIds.includes(admin.unit_id)
  ) {
    throw new ResponseError(
      403,
      "Forbidden: This room is outside your unit scope",
    );
  }
}

// A mentor can hold multiple activities across different days, but can't
// supervise two rooms meeting on the same day - mirrors the "one PC room
// per day" rule already enforced for students.
async function assertMentorHasNoSameDayConflict(
  tx: Prisma.TransactionClient,
  employeeId: string | null,
  internId: string | null,
  academicYearId: string,
  day: PCDay,
  excludeAssignmentId?: string,
): Promise<void> {
  const conflict = await tx.pcActivityRoomMentorAssignment.findFirst({
    where: {
      employee_id: employeeId,
      intern_id: internId,
      status: { in: [PcActivityMentorAssignmentStatus.ACTIVE, PcActivityMentorAssignmentStatus.SCHEDULED] },
      deleted_at: null,
      room: { academic_year_id: academicYearId, day },
      ...(excludeAssignmentId ? { id: { not: excludeAssignmentId } } : {}),
    },
  });
  if (conflict) {
    throw new ResponseError(
      400,
      "This person already has a mentor assignment on another room meeting the same day.",
    );
  }
}

const MAX_ROOM_MENTORS = 3;
const MAX_MENTOR_ROOMS_PER_ACADEMIC_YEAR = 3;
const PC_ACTIVITY_PROMOTION_WINDOW_DAYS = 30;

function parseAssignmentStartDate(
  value: string | undefined,
  room: { start_date: Date; end_date: Date },
  now: Date,
): Date {
  const startDate = value ? new Date(value) : room.start_date;
  if (startDate < room.start_date || startDate >= room.end_date) {
    throw new ResponseError(400, "Start date must be within the room period");
  }
  if (startDate > now) {
    throw new ResponseError(400, "Start date cannot be in the future");
  }
  return startDate;
}

function assertEditableStartDate(
  assignment: {
    start_date: Date;
    end_date: Date | null;
    deleted_at: Date | null;
    previous_assignment_id: string | null;
    next_assignment?: unknown;
    status: string;
  },
  startDate: Date,
  expiresAt?: Date | null,
): void {
  if (assignment.deleted_at) throw new ResponseError(400, "Cannot update a deleted assignment");
  if (assignment.status === "SCHEDULED") {
    throw new ResponseError(400, "Cannot change the start date of a scheduled assignment");
  }
  if (assignment.previous_assignment_id || assignment.next_assignment) {
    throw new ResponseError(400, "Cannot change the start date of a chained assignment");
  }
  const upperBound = assignment.end_date ?? expiresAt;
  if (upperBound && startDate >= upperBound) {
    throw new ResponseError(400, "Start date must be before the assignment end or expiry date");
  }
}

// ACTIVE + SCHEDULED both occupy a slot - same definition "duplicate" checks
// above already use for "does this person already hold a spot here".
async function assertMentorCapacity(
  tx: Prisma.TransactionClient,
  roomId: string,
  excludeAssignmentId?: string,
): Promise<void> {
  const count = await tx.pcActivityRoomMentorAssignment.count({
    where: {
      room_id: roomId,
      status: { in: [PcActivityMentorAssignmentStatus.ACTIVE, PcActivityMentorAssignmentStatus.SCHEDULED] },
      deleted_at: null,
      ...(excludeAssignmentId ? { id: { not: excludeAssignmentId } } : {}),
    },
  });
  if (count >= MAX_ROOM_MENTORS) {
    throw new ResponseError(
      400,
      `This room already has the maximum of ${MAX_ROOM_MENTORS} mentors`,
    );
  }
}

async function assertMentorAcademicYearCapacity(
  tx: Prisma.TransactionClient,
  employeeId: string | null,
  internId: string | null,
  academicYearId: string,
  excludeAssignmentId?: string,
): Promise<void> {
  const count = await tx.pcActivityRoomMentorAssignment.count({
    where: {
      employee_id: employeeId,
      intern_id: internId,
      status: { in: [PcActivityMentorAssignmentStatus.ACTIVE, PcActivityMentorAssignmentStatus.SCHEDULED] },
      deleted_at: null,
      room: { academic_year_id: academicYearId },
      ...(excludeAssignmentId ? { id: { not: excludeAssignmentId } } : {}),
    },
  });
  if (count >= MAX_MENTOR_ROOMS_PER_ACADEMIC_YEAR) {
    throw new ResponseError(
      400,
      `This mentor already has the maximum of ${MAX_MENTOR_ROOMS_PER_ACADEMIC_YEAR} room assignments in this academic year`,
    );
  }
}

function assertPromotionNotTooEarly(
  academicYear: { name: string; end_date: Date | null },
  now: Date,
): void {
  if (!academicYear.end_date) return;
  const daysUntilEnd =
    (academicYear.end_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysUntilEnd > PC_ACTIVITY_PROMOTION_WINDOW_DAYS) {
    throw new ResponseError(
      400,
      `Too early to promote - "${academicYear.name}" doesn't end until ${academicYear.end_date.toISOString().slice(0, 10)}. Promotion opens ${PC_ACTIVITY_PROMOTION_WINDOW_DAYS} days before an academic year ends.`,
    );
  }
}

function isSameMentor(
  left: { employee_id: string | null; intern_id: string | null },
  right: { employee_id: string | null; intern_id: string | null },
): boolean {
  return left.employee_id === right.employee_id && left.intern_id === right.intern_id;
}

function assertSelectedRoomUnits(admin: AdminUser, unitIds: string[]): void {
  if (
    admin.role === AdminRole.DATABASE_ADMIN &&
    (unitIds.length !== 1 || unitIds[0] !== admin.unit_id)
  ) {
    throw new ResponseError(
      403,
      "Forbidden: Database Admin can only select their own single unit",
    );
  }
}

const ROOM_INCLUDE = {
  activity: true,
  academic_year: true,
  units: { include: { unit: true } },
  grades: { include: { grade: true } },
  classes: { include: { class: true } },
  mentors: { include: { employee: { include: { person: true } }, intern: true } },
} as const;

async function findRoomOrThrow(id: string) {
  const [room, counts] = await Promise.all([
    prismaClient.pcActivityRoom.findFirst({
      where: { id, deleted_at: null },
      include: ROOM_INCLUDE,
    }),
    prismaClient.passionConnectionActivity.groupBy({
      by: ["status"],
      where: { room_id: id, deleted_at: null },
      _count: { _all: true },
    }),
  ]);
  if (!room) {
    throw new ResponseError(404, "PC Activity room not found");
  }
  return Object.assign(room, {
    student_counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
  });
}

function pageableSlice<T>(rows: T[], page: number, size: number): Pageable<T> {
  const start = (page - 1) * size;
  return {
    data: rows.slice(start, start + size),
    paging: {
      size,
      current_page: page,
      total_page: Math.ceil(rows.length / size),
      total_item: rows.length,
    },
  };
}

// Every grade_id must belong to one of the room's own units - mirrors how
// ClassAdditionalGrade must share the class's primary grade's unit.
async function assertGradesMatchUnits(
  gradeIds: string[],
  unitIds: string[],
): Promise<void> {
  if (gradeIds.length === 0) return;
  const grades = await prismaClient.grade.findMany({
    where: { id: { in: gradeIds } },
  });
  if (grades.length !== gradeIds.length) {
    throw new ResponseError(400, "One or more grades were not found");
  }
  const mismatched = grades.find((grade) => !unitIds.includes(grade.unit_id));
  if (mismatched) {
    throw new ResponseError(
      400,
      `Grade "${mismatched.name}" does not belong to one of this room's units`,
    );
  }
}

async function assertClassesMatchScope(
  classIds: string[],
  academicYearId: string,
  unitIds: string[],
  gradeIds: string[],
): Promise<void> {
  if (classIds.length === 0) return;
  const classes = await prismaClient.class.findMany({
    where: { id: { in: classIds } },
    include: { grade: true, additional_grades: true },
  });
  if (classes.length !== classIds.length) {
    throw new ResponseError(400, "One or more classes were not found");
  }
  for (const klass of classes) {
    if (klass.academic_year_id !== academicYearId) {
      throw new ResponseError(400, `Class "${klass.name}" is not in the room's academic year`);
    }
    if (!unitIds.includes(klass.grade.unit_id)) {
      throw new ResponseError(400, `Class "${klass.name}" is outside the room's unit scope`);
    }
    const acceptedGradeIds = [klass.grade_id, ...klass.additional_grades.map((entry) => entry.grade_id)];
    if (gradeIds.length > 0 && !acceptedGradeIds.some((id) => gradeIds.includes(id))) {
      throw new ResponseError(400, `Class "${klass.name}" is outside the room's grade scope`);
    }
  }
}

async function eligibleEnrollmentRows(
  academicYearId: string,
  unitIds: string[],
  gradeIds: string[],
  classIds: string[] = [],
) {
  return prismaClient.studentClassEnrollment.findMany({
    where: {
      academic_year_id: academicYearId,
      enrollment_status: "ACTIVE",
      deleted_at: null,
      ...(classIds.length > 0 ? { class_id: { in: classIds } } : {}),
      grade: {
        unit_id: { in: unitIds },
        ...(gradeIds.length > 0 ? { id: { in: gradeIds } } : {}),
      },
      student: { status: "ACTIVE", deleted_at: null },
    },
    include: {
      student: { include: { person: { select: { full_name: true } } } },
      class: { select: { name: true } },
      grade: { select: { id: true, name: true, unit_id: true } },
    },
  });
}

function assertRoomPeriod(room: { start_date: Date; end_date: Date }, now: Date): void {
  if (now < room.start_date || now >= room.end_date) {
    throw new ResponseError(400, "Assignments can only be active during the room period");
  }
}

async function assertImmediatelyNextAcademicYear(
  source: { id: string; start_date: Date },
  target: { id: string; start_date: Date },
): Promise<void> {
  const next = await prismaClient.academicYear.findFirst({
    where: { start_date: { gt: source.start_date } },
    orderBy: { start_date: "asc" },
    select: { id: true },
  });
  if (!next || next.id !== target.id) {
    throw new ResponseError(400, "Target room must be in the same or immediately next academic year");
  }
}

async function assertStudentEligibleForRoom(
  room: Awaited<ReturnType<typeof findRoomOrThrow>>,
  studentId: string,
): Promise<void> {
  const rows = await eligibleEnrollmentRows(
    room.academic_year_id,
    room.units.map((entry) => entry.unit_id),
    room.grades.map((entry) => entry.grade_id),
    room.classes.map((entry) => entry.class_id),
  );
  if (rows.some((row) => row.student_id === studentId)) return;
  await throwStudentIneligibleForRoom(room, studentId);
}

// Scope didn't match - work out which specific gate failed so the admin
// gets an actionable reason instead of one generic message for every case.
async function throwStudentIneligibleForRoom(
  room: Awaited<ReturnType<typeof findRoomOrThrow>>,
  studentId: string,
): Promise<never> {
  const enrollment = await prismaClient.studentClassEnrollment.findFirst({
    where: {
      student_id: studentId,
      academic_year_id: room.academic_year_id,
      enrollment_status: "ACTIVE",
      deleted_at: null,
    },
    include: {
      student: { select: { status: true } },
      class: { select: { name: true } },
      grade: { select: { id: true, name: true, unit_id: true } },
    },
  });

  if (!enrollment) {
    throw new ResponseError(
      400,
      `Student has no active class enrollment in ${room.academic_year.name} yet. Promote/enroll the student into a class for that year before assigning this room.`,
    );
  }
  if (enrollment.student.status !== "ACTIVE") {
    throw new ResponseError(
      400,
      `Student's status is ${enrollment.student.status}, not Active, so they can't be assigned to this room.`,
    );
  }
  const roomUnitIds = room.units.map((entry) => entry.unit_id);
  if (!roomUnitIds.includes(enrollment.grade.unit_id)) {
    throw new ResponseError(
      400,
      `Student's ${room.academic_year.name} class is in a different unit than this room. Room allows: ${room.units.map((entry) => entry.unit.name).join(", ")}.`,
    );
  }
  if (
    room.grades.length > 0 &&
    !room.grades.some((entry) => entry.grade_id === enrollment.grade.id)
  ) {
    throw new ResponseError(
      400,
      `Student's ${room.academic_year.name} grade ("${enrollment.grade.name}") is not one of this room's allowed grades: ${room.grades.map((entry) => entry.grade.name).join(", ")}.`,
    );
  }
  if (
    room.classes.length > 0 &&
    !room.classes.some((entry) => entry.class_id === enrollment.class_id)
  ) {
    throw new ResponseError(
      400,
      `Student's ${room.academic_year.name} class ("${enrollment.class.name}") is not one of this room's allowed classes: ${room.classes.map((entry) => entry.class.name).join(", ")}.`,
    );
  }
  throw new ResponseError(400, "Student is not eligible for this room's unit/grade/class scope");
}

export class PCActivityRoomService {
  static async listMentorshipsForEmployee(
    admin: AdminUser,
    employeeId: string,
  ): Promise<PcActivityRoomMentorshipHistoryResponse[]> {
    const employee = await prismaClient.employee.findFirst({
      where: { id: employeeId, deleted_at: null },
      select: { unit_id: true },
    });
    if (!employee || (admin.role === AdminRole.DATABASE_ADMIN && employee.unit_id !== admin.unit_id)) {
      throw new ResponseError(404, "Employee not found");
    }
    const rows = await prismaClient.pcActivityRoomMentorAssignment.findMany({
      where: { employee_id: employeeId, deleted_at: null },
      include: { room: { include: { activity: true, academic_year: true } } },
      orderBy: { start_date: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      room_id: row.room_id,
      room_name: row.room.label
        ? `${row.room.activity.name} - ${row.room.label}`
        : row.room.activity.name,
      activity_name: row.room.activity.name,
      academic_year_name: row.room.academic_year.name,
      day: row.room.day,
      start_date: row.start_date.toISOString(),
      end_date: row.end_date?.toISOString() ?? null,
      status: row.status,
    }));
  }

  static async listMentorshipsForIntern(
    admin: AdminUser,
    internId: string,
  ): Promise<PcActivityRoomMentorshipHistoryResponse[]> {
    const intern = await prismaClient.intern.findFirst({
      where: { id: internId, deleted_at: null },
      select: { unit_id: true },
    });
    if (!intern || (admin.role === AdminRole.DATABASE_ADMIN && intern.unit_id !== admin.unit_id)) {
      throw new ResponseError(404, "Intern not found");
    }
    const rows = await prismaClient.pcActivityRoomMentorAssignment.findMany({
      where: { intern_id: internId, deleted_at: null },
      include: { room: { include: { activity: true, academic_year: true } } },
      orderBy: { start_date: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      room_id: row.room_id,
      room_name: row.room.label
        ? `${row.room.activity.name} - ${row.room.label}`
        : row.room.activity.name,
      activity_name: row.room.activity.name,
      academic_year_name: row.room.academic_year.name,
      day: row.room.day,
      start_date: row.start_date.toISOString(),
      end_date: row.end_date?.toISOString() ?? null,
      status: row.status,
    }));
  }

  static async search(
    admin: AdminUser,
    request: ListPcActivityRoomsRequest,
  ): Promise<Pageable<PcActivityRoomResponse>> {
    const searchRequest = Validation.validate(
      PcActivityRoomValidation.SEARCH,
      request,
    );

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const where = {
      deleted_at: null,
      activity_id: searchRequest.activity_id,
      academic_year_id: searchRequest.academic_year_id,
      ...(admin.role === AdminRole.DATABASE_ADMIN
        ? { units: { some: { unit_id: admin.unit_id } } }
        : {}),
      ...(searchRequest.search
        ? {
            OR: [
              { activity: { name: { contains: searchRequest.search, mode: "insensitive" as const } } },
              { label: { contains: searchRequest.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    return paginate(searchRequest.page, searchRequest.size, {
      count: () => prismaClient.pcActivityRoom.count({ where }),
      findMany: () =>
        prismaClient.pcActivityRoom
          .findMany({
            where,
            include: ROOM_INCLUDE,
            take: searchRequest.size,
            skip,
            orderBy: [
              { [searchRequest.sort_by || "created_at"]: searchRequest.sort_order || "desc" },
              { id: "asc" },
            ],
          })
          .then(async (rooms) => {
            const counts = await prismaClient.passionConnectionActivity.groupBy({
              by: ["room_id", "status"],
              where: { room_id: { in: rooms.map((room) => room.id) }, deleted_at: null },
              _count: { _all: true },
            });
            const countMap = new Map<string, Partial<Record<PcActivityAssignmentStatus, number>>>();
            for (const row of counts) {
              if (!row.room_id) continue;
              const roomCounts = countMap.get(row.room_id) ?? {};
              roomCounts[row.status] = row._count._all;
              countMap.set(row.room_id, roomCounts);
            }
            return rooms.map((room) =>
              toPcActivityRoomResponse(Object.assign(room, { student_counts: countMap.get(room.id) })),
            );
          }),
    });
  }

  static async get(
    admin: AdminUser,
    request: GetPcActivityRoomRequest,
  ): Promise<PcActivityRoomResponse> {
    const getRequest = Validation.validate(PcActivityRoomValidation.GET, request);
    const room = await findRoomOrThrow(getRequest.id);
    assertRoomInAdminUnit(admin, room.units.map((u) => u.unit_id));
    return toPcActivityRoomResponse(room);
  }

  static async create(
    admin: AdminUser,
    request: CreatePcActivityRoomRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<PcActivityRoomResponse> {
    await assertRoomWriteAllowed(admin, context, now);

    const createRequest = Validation.validate(
      PcActivityRoomValidation.CREATE,
      request,
    );
    assertSelectedRoomUnits(admin, createRequest.unit_ids);

    const activity = await prismaClient.masterPCActivity.findUnique({
      where: { id: createRequest.activity_id },
    });
    if (!activity) {
      throw new ResponseError(400, "Invalid PC activity: activity not found");
    }
    await assertGradesMatchUnits(createRequest.grade_ids ?? [], createRequest.unit_ids);

    const academicYear = createRequest.academic_year_id
      ? await prismaClient.academicYear.findUnique({ where: { id: createRequest.academic_year_id } })
      : await prismaClient.academicYear.findFirst({ where: { status: "ACTIVE" } });
    if (!academicYear) {
      throw new ResponseError(
        400,
        "Academic year not found",
      );
    }
    await assertClassesMatchScope(
      createRequest.class_ids ?? [],
      academicYear.id,
      createRequest.unit_ids,
      createRequest.grade_ids ?? [],
    );
    const { startDate, endDate } = resolveRoomPeriod(
      createRequest.duration_type,
      academicYear.start_date,
      academicYear.end_date,
      createRequest.custom_duration_days,
    );

    const createdId = await prismaClient.$transaction(async (tx) => {
      const room = await tx.pcActivityRoom.create({
        data: {
          label: createRequest.label,
          activity_id: createRequest.activity_id,
          academic_year_id: academicYear.id,
          day: createRequest.day,
          duration_type: createRequest.duration_type,
          custom_duration_days:
            createRequest.duration_type === "CUSTOM" ? createRequest.custom_duration_days : null,
          start_date: startDate,
          end_date: endDate,
          created_by: admin.id,
        },
      });
      await assertAcademicUnitIds(
        tx,
        createRequest.unit_ids,
        "PC Activity rooms are limited to academic units (units that have grades)",
      );
      await tx.pcActivityRoomUnit.createMany({
        data: createRequest.unit_ids.map((unitId) => ({
          room_id: room.id,
          unit_id: unitId,
        })),
      });
      if (createRequest.grade_ids && createRequest.grade_ids.length > 0) {
        await tx.pcActivityRoomGrade.createMany({
          data: createRequest.grade_ids.map((gradeId) => ({
            room_id: room.id,
            grade_id: gradeId,
          })),
        });
      }
      if (createRequest.class_ids && createRequest.class_ids.length > 0) {
        await tx.pcActivityRoomClass.createMany({
          data: createRequest.class_ids.map((classId) => ({ room_id: room.id, class_id: classId })),
        });
      }

      await AuditService.record(
        {
          action: AuditAction.CREATE_PC_ACTIVITY_ROOM,
          source: AuditSource.UI,
          entity_type: "PcActivityRoom",
          entity_id: room.id,
          admin_id: admin.id,
          new_values: {
            label: room.label,
            activity_id: room.activity_id,
            academic_year_id: room.academic_year_id,
            day: room.day,
            duration_type: room.duration_type,
            custom_duration_days: room.custom_duration_days,
            start_date: room.start_date.toISOString(),
            end_date: room.end_date.toISOString(),
            unit_ids: createRequest.unit_ids,
            grade_ids: createRequest.grade_ids ?? [],
            class_ids: createRequest.class_ids ?? [],
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return room.id;
    });

    return toPcActivityRoomResponse(await findRoomOrThrow(createdId));
  }

  static async update(
    admin: AdminUser,
    request: UpdatePcActivityRoomRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<PcActivityRoomResponse> {
    await assertRoomWriteAllowed(admin, context, now);

    const updateRequest = Validation.validate(
      PcActivityRoomValidation.UPDATE,
      request,
    );

    const existing = await findRoomOrThrow(updateRequest.id);
    const existingUnitIds = existing.units.map((u) => u.unit_id);
    assertRoomInAdminUnit(admin, existingUnitIds);

    const nextUnitIds = updateRequest.unit_ids ?? existingUnitIds;
    if (updateRequest.unit_ids) {
      assertSelectedRoomUnits(admin, nextUnitIds);
    }
    const nextGradeIds =
      updateRequest.grade_ids ?? existing.grades.map((g) => g.grade_id);
    const nextClassIds =
      updateRequest.class_ids ?? existing.classes.map((entry) => entry.class_id);
    if (updateRequest.unit_ids || updateRequest.grade_ids || updateRequest.class_ids) {
      await assertGradesMatchUnits(nextGradeIds, nextUnitIds);
      await assertClassesMatchScope(
        nextClassIds,
        existing.academic_year_id,
        nextUnitIds,
        nextGradeIds,
      );
    }

    // Scope narrowing cannot silently orphan active assignments - block
    // and tell the admin how many, same pattern as job-position/job-level
    // unit-scope narrowing.
    if (updateRequest.unit_ids || updateRequest.grade_ids || updateRequest.class_ids) {
      const eligibleIds = new Set(
        (await eligibleEnrollmentRows(existing.academic_year_id, nextUnitIds, nextGradeIds, nextClassIds)).map(
          (row) => row.student_id,
        ),
      );
      const activeAssignments = await prismaClient.passionConnectionActivity.findMany({
        where: {
          room_id: existing.id,
          deleted_at: null,
          status: { in: [PcActivityAssignmentStatus.ACTIVE, PcActivityAssignmentStatus.SCHEDULED] },
        },
        select: { student_id: true },
      });
      const mismatchedCount = activeAssignments.filter(
        (assignment) => !eligibleIds.has(assignment.student_id),
      ).length;
      if (mismatchedCount > 0) {
        throw new ResponseError(
          400,
          `Cannot change this room's scope: ${mismatchedCount} active student assignment(s) are outside the new unit/grade selection. Reassign or remove them first.`,
        );
      }
      for (const mentor of existing.mentors.filter((row) => row.status !== PcActivityMentorAssignmentStatus.ENDED && row.deleted_at === null)) {
        await prismaClient.$transaction((tx) =>
          assertMentorIsEligible(
            tx,
            mentor.employee_id ?? undefined,
            mentor.intern_id ?? undefined,
            nextUnitIds,
            now,
          ),
        );
      }
    }

    await prismaClient.$transaction(async (tx) => {
      const academicYear = await tx.academicYear.findUniqueOrThrow({
        where: { id: existing.academic_year_id },
      });
      const nextDurationType = updateRequest.duration_type ?? existing.duration_type;
      const nextCustomDurationDays =
        updateRequest.custom_duration_days !== undefined
          ? updateRequest.custom_duration_days
          : existing.custom_duration_days;
      const { startDate: nextStartDate, endDate: nextEndDate } = resolveRoomPeriod(
        nextDurationType,
        academicYear.start_date,
        academicYear.end_date,
        nextCustomDurationDays,
      );
      const updated = await tx.pcActivityRoom.update({
        where: { id: existing.id },
        data: {
          label: updateRequest.label,
          duration_type: updateRequest.duration_type,
          custom_duration_days:
            nextDurationType === "CUSTOM" ? nextCustomDurationDays : null,
          start_date: nextStartDate,
          end_date: nextEndDate,
        },
      });
      if (updateRequest.duration_type || updateRequest.custom_duration_days !== undefined) {
        await tx.passionConnectionActivity.updateMany({
          where: {
            room_id: existing.id,
            status: { in: [PcActivityAssignmentStatus.ACTIVE, PcActivityAssignmentStatus.SCHEDULED] },
            deleted_at: null,
          },
          data: { expires_at: nextEndDate },
        });
      }

      if (updateRequest.unit_ids) {
        await assertAcademicUnitIds(
          tx,
          updateRequest.unit_ids,
          "PC Activity rooms are limited to academic units (units that have grades)",
        );
        await tx.pcActivityRoomUnit.deleteMany({ where: { room_id: existing.id } });
        await tx.pcActivityRoomUnit.createMany({
          data: updateRequest.unit_ids.map((unitId) => ({
            room_id: existing.id,
            unit_id: unitId,
          })),
        });
      }
      if (updateRequest.grade_ids !== undefined) {
        await tx.pcActivityRoomGrade.deleteMany({ where: { room_id: existing.id } });
        if (updateRequest.grade_ids.length > 0) {
          await tx.pcActivityRoomGrade.createMany({
            data: updateRequest.grade_ids.map((gradeId) => ({
              room_id: existing.id,
              grade_id: gradeId,
            })),
          });
        }
      }
      if (updateRequest.class_ids !== undefined) {
        await tx.pcActivityRoomClass.deleteMany({ where: { room_id: existing.id } });
        if (updateRequest.class_ids.length > 0) {
          await tx.pcActivityRoomClass.createMany({
            data: updateRequest.class_ids.map((classId) => ({ room_id: existing.id, class_id: classId })),
          });
        }
      }

      await AuditService.record(
        {
          action: AuditAction.UPDATE_PC_ACTIVITY_ROOM,
          source: AuditSource.UI,
          entity_type: "PcActivityRoom",
          entity_id: updated.id,
          admin_id: admin.id,
          old_values: {
            label: existing.label,
            duration_type: existing.duration_type,
            start_date: existing.start_date.toISOString(),
            end_date: existing.end_date.toISOString(),
            unit_ids: existingUnitIds,
            grade_ids: existing.grades.map((g) => g.grade_id),
            class_ids: existing.classes.map((entry) => entry.class_id),
          },
          new_values: {
            label: updated.label,
            duration_type: updated.duration_type,
            custom_duration_days: updated.custom_duration_days,
            start_date: updated.start_date.toISOString(),
            end_date: updated.end_date.toISOString(),
            unit_ids: nextUnitIds,
            grade_ids: nextGradeIds,
            class_ids: nextClassIds,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    return toPcActivityRoomResponse(await findRoomOrThrow(existing.id));
  }

  static async remove(
    admin: AdminUser,
    request: DeletePcActivityRoomRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<void> {
    await assertRoomWriteAllowed(admin, context, now);

    const deleteRequest = Validation.validate(
      PcActivityRoomValidation.DELETE,
      request,
    );

    const existing = await findRoomOrThrow(deleteRequest.id);
    assertRoomInAdminUnit(admin, existing.units.map((u) => u.unit_id));

    const activeStudentCount = await prismaClient.passionConnectionActivity.count({
      where: { room_id: existing.id, deleted_at: null },
    });
    if (activeStudentCount > 0) {
      throw new ResponseError(
        400,
        "Remove or reassign every student from this room before deleting it.",
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.pcActivityRoom.update({
        where: { id: existing.id },
        data: { deleted_at: now },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_PC_ACTIVITY_ROOM,
          source: AuditSource.UI,
          entity_type: "PcActivityRoom",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: { activity_id: existing.activity_id, day: existing.day },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });
  }

  // --- Mentors -----------------------------------------------------------

  static async listMentors(
    admin: AdminUser,
    request: ListPcActivityRoomMentorsRequest,
  ): Promise<Pageable<PcActivityRoomMentorAssignmentResponse>> {
    const listRequest = Validation.validate(
      PcActivityRoomValidation.LIST_MENTORS,
      request,
    );
    const room = await findRoomOrThrow(listRequest.room_id);
    assertRoomInAdminUnit(admin, room.units.map((u) => u.unit_id));

    const where: Prisma.PcActivityRoomMentorAssignmentWhereInput = {
      room_id: listRequest.room_id,
      deleted_at: null,
      status: listRequest.status,
      ...(listRequest.search
        ? {
            OR: [
              { employee: { person: { full_name: { contains: listRequest.search, mode: "insensitive" } } } },
              { intern: { full_name: { contains: listRequest.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    if (listRequest.sort_by === "mentor_name" || listRequest.sort_by === "mentor_type") {
      const assignments = await prismaClient.pcActivityRoomMentorAssignment.findMany({
        where,
        include: { employee: { include: { person: true } }, intern: true },
      });
      const rows = assignments.map(toPcActivityRoomMentorAssignmentResponse);
      const direction = listRequest.sort_order === "desc" ? -1 : 1;
      rows.sort((left, right) => {
        const leftValue = listRequest.sort_by === "mentor_name" ? left.mentor_name.toLocaleLowerCase() : left.mentor_type;
        const rightValue = listRequest.sort_by === "mentor_name" ? right.mentor_name.toLocaleLowerCase() : right.mentor_type;
        return leftValue === rightValue ? left.id.localeCompare(right.id) : leftValue.localeCompare(rightValue) * direction;
      });
      return pageableSlice(rows, listRequest.page, listRequest.size);
    }
    const skip = (listRequest.page - 1) * listRequest.size;
    return paginate(listRequest.page, listRequest.size, {
      count: () => prismaClient.pcActivityRoomMentorAssignment.count({ where }),
      findMany: () => prismaClient.pcActivityRoomMentorAssignment.findMany({
        where,
        include: { employee: { include: { person: true } }, intern: true },
        skip,
        take: listRequest.size,
        orderBy: [
          { [listRequest.sort_by ?? "start_date"]: listRequest.sort_order },
          { id: "asc" },
        ],
      }).then((rows) => rows.map(toPcActivityRoomMentorAssignmentResponse)),
    });
  }

  static async listEligibleMentors(
    admin: AdminUser,
    request: ListPcActivityRoomEligibleMentorsRequest,
    now: Date = new Date(),
  ): Promise<Pageable<PcActivityRoomEligibleMentorResponse>> {
    const listRequest = Validation.validate(PcActivityRoomValidation.LIST_ELIGIBLE_MENTORS, request);
    const room = await findRoomOrThrow(listRequest.room_id);
    const unitIds = room.units.map((entry) => entry.unit_id);
    assertRoomInAdminUnit(admin, unitIds);
    const [employees, interns, assignments] = await Promise.all([
      prismaClient.employee.findMany({
        where: {
          deleted_at: null,
          status: "ACTIVE",
          is_pc_mentor_eligible: true,
          ...(listRequest.search ? { person: { full_name: { contains: listRequest.search, mode: "insensitive" } } } : {}),
        },
        select: { id: true, unit_id: true, person: { select: { full_name: true } }, pc_mentor_units: { select: { unit_id: true } } },
      }),
      prismaClient.intern.findMany({
        where: {
          deleted_at: null,
          status: "ACTIVE",
          end_date: { gt: now },
          is_pc_mentor_eligible: true,
          ...(listRequest.search ? { full_name: { contains: listRequest.search, mode: "insensitive" } } : {}),
        },
        select: { id: true, unit_id: true, full_name: true, pc_mentor_units: { select: { unit_id: true } } },
      }),
      prismaClient.pcActivityRoomMentorAssignment.findMany({
        where: {
          deleted_at: null,
          status: { in: [PcActivityMentorAssignmentStatus.ACTIVE, PcActivityMentorAssignmentStatus.SCHEDULED] },
          room: { academic_year_id: room.academic_year_id },
        },
        select: { employee_id: true, intern_id: true, room_id: true, room: { select: { day: true } } },
      }),
    ]);
    const roomOccupancy = assignments.filter((row) => row.room_id === room.id).length;
    if (roomOccupancy >= MAX_ROOM_MENTORS) {
      return pageableSlice([], listRequest.page, listRequest.size);
    }
    const isAllowed = (homeUnitId: string, scoped: { unit_id: string }[]) => {
      const allowed = scoped.length > 0 ? scoped.map((entry) => entry.unit_id) : [homeUnitId];
      return unitIds.every((unitId) => allowed.includes(unitId));
    };
    const hasCapacityAndNoConflict = (employeeId: string | null, internId: string | null) => {
      const own = assignments.filter((row) => row.employee_id === employeeId && row.intern_id === internId);
      return own.length < MAX_MENTOR_ROOMS_PER_ACADEMIC_YEAR &&
        !own.some((row) => row.room_id === room.id || row.room.day === room.day);
    };
    const rows: PcActivityRoomEligibleMentorResponse[] = [
      ...employees
        .filter((row) => isAllowed(row.unit_id, row.pc_mentor_units) && hasCapacityAndNoConflict(row.id, null))
        .map((row) => ({ id: row.id, name: row.person.full_name, type: "EMPLOYEE" as const, unit_id: row.unit_id })),
      ...interns
        .filter((row) => isAllowed(row.unit_id, row.pc_mentor_units) && hasCapacityAndNoConflict(null, row.id))
        .map((row) => ({ id: row.id, name: row.full_name, type: "INTERN" as const, unit_id: row.unit_id })),
    ];
    const direction = listRequest.sort_order === "desc" ? -1 : 1;
    rows.sort((left, right) => {
      const leftValue = listRequest.sort_by === "type" ? left.type : left.name.toLocaleLowerCase();
      const rightValue = listRequest.sort_by === "type" ? right.type : right.name.toLocaleLowerCase();
      return leftValue === rightValue ? left.id.localeCompare(right.id) : leftValue.localeCompare(rightValue) * direction;
    });
    return pageableSlice(rows, listRequest.page, listRequest.size);
  }

  static async assignMentor(
    admin: AdminUser,
    request: AssignPcActivityRoomMentorRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<PcActivityRoomMentorAssignmentResponse> {
    await assertMentorWriteAllowed(admin, context, now);

    const assignRequest = Validation.validate(
      PcActivityRoomValidation.ASSIGN_MENTOR,
      request,
    );

    const room = await findRoomOrThrow(assignRequest.room_id);
    const unitIds = room.units.map((u) => u.unit_id);
    assertRoomInAdminUnit(admin, unitIds);
    assertRoomPeriod(room, now);
    const startDate = parseAssignmentStartDate(assignRequest.start_date, room, now);

    const createdId = await prismaClient.$transaction(async (tx) => {
      if (assignRequest.intern_id) {
        await lockInternWorkforce(tx, assignRequest.intern_id);
      }
      const mentorTarget = await assertMentorIsEligible(
        tx,
        assignRequest.employee_id,
        assignRequest.intern_id,
        unitIds,
        now,
      );

      const duplicate = await tx.pcActivityRoomMentorAssignment.findFirst({
        where: {
          room_id: assignRequest.room_id,
          employee_id: mentorTarget.employeeId,
          intern_id: mentorTarget.internId,
          status: { in: [PcActivityMentorAssignmentStatus.ACTIVE, PcActivityMentorAssignmentStatus.SCHEDULED] },
          deleted_at: null,
        },
      });
      if (duplicate) {
        throw new ResponseError(
          400,
          "This person already has an active or scheduled mentor assignment on this room.",
        );
      }
      await assertMentorCapacity(tx, assignRequest.room_id);
      await assertMentorAcademicYearCapacity(
        tx,
        mentorTarget.employeeId,
        mentorTarget.internId,
        room.academic_year_id,
      );
      await assertMentorHasNoSameDayConflict(
        tx,
        mentorTarget.employeeId,
        mentorTarget.internId,
        room.academic_year_id,
        room.day,
      );

      const created = await tx.pcActivityRoomMentorAssignment.create({
        data: {
          room_id: assignRequest.room_id,
          employee_id: mentorTarget.employeeId,
          intern_id: mentorTarget.internId,
          start_date: startDate,
          status: PcActivityMentorAssignmentStatus.ACTIVE,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.ASSIGN_PC_ACTIVITY_ROOM_MENTOR,
          source: AuditSource.UI,
          entity_type: "PcActivityRoomMentorAssignment",
          entity_id: created.id,
          admin_id: admin.id,
          new_values: {
            room_id: created.room_id,
            employee_id: created.employee_id,
            intern_id: created.intern_id,
            start_date: created.start_date.toISOString(),
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return created.id;
    });

    const created = await prismaClient.pcActivityRoomMentorAssignment.findUniqueOrThrow({
      where: { id: createdId },
      include: { employee: { include: { person: true } }, intern: true },
    });
    return toPcActivityRoomMentorAssignmentResponse(created);
  }

  static async bulkAssignMentors(
    admin: AdminUser,
    request: BulkAssignPcActivityRoomMentorsRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<PcActivityRoomMentorAssignmentResponse>> {
    await assertMentorWriteAllowed(admin, context, now);
    const bulkRequest = Validation.validate(
      PcActivityRoomValidation.BULK_ASSIGN_MENTORS,
      request,
    );
    const items: BulkActionItemResponse<PcActivityRoomMentorAssignmentResponse>[] = [];
    for (const target of bulkRequest.targets) {
      const itemId = target.employee_id ?? target.intern_id!;
      try {
        const created = await this.assignMentor(
          admin,
          { room_id: bulkRequest.room_id, ...target, start_date: target.start_date ?? bulkRequest.start_date },
          context,
          now,
        );
        items.push({ id: itemId, status: "SUCCESS", data: created });
      } catch (error) {
        items.push({ id: itemId, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }
    return toBulkActionResponse(items);
  }

  static async updateMentorStartDate(
    admin: AdminUser,
    request: UpdatePcActivityRoomAssignmentStartDateRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<PcActivityRoomMentorAssignmentResponse> {
    await assertMentorWriteAllowed(admin, context, now);
    const updateRequest = Validation.validate(PcActivityRoomValidation.UPDATE_START_DATE, request);
    const room = await findRoomOrThrow(updateRequest.room_id);
    assertRoomInAdminUnit(admin, room.units.map((entry) => entry.unit_id));
    const assignment = await prismaClient.pcActivityRoomMentorAssignment.findFirst({
      where: { id: updateRequest.assignment_id, room_id: room.id },
      include: { next_assignment: { select: { id: true } } },
    });
    if (!assignment) throw new ResponseError(404, "Mentor assignment not found");
    const startDate = parseAssignmentStartDate(updateRequest.start_date, room, now);
    assertEditableStartDate(assignment, startDate);
    const updated = await prismaClient.$transaction(async (tx) => {
      const row = await tx.pcActivityRoomMentorAssignment.update({
        where: { id: assignment.id },
        data: { start_date: startDate },
        include: { employee: { include: { person: true } }, intern: true },
      });
      await AuditService.record({
        action: AuditAction.UPDATE_PC_ACTIVITY_ROOM_MENTOR_START_DATE,
        source: AuditSource.UI,
        entity_type: Prisma.ModelName.PcActivityRoomMentorAssignment,
        entity_id: assignment.id,
        admin_id: admin.id,
        old_values: { start_date: assignment.start_date.toISOString() },
        new_values: { start_date: startDate.toISOString() },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      }, tx);
      return row;
    });
    return toPcActivityRoomMentorAssignmentResponse(updated);
  }

  static async bulkUpdateMentorStartDates(
    admin: AdminUser,
    request: BulkUpdatePcActivityRoomAssignmentStartDatesRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<PcActivityRoomMentorAssignmentResponse>> {
    const bulkRequest = Validation.validate(PcActivityRoomValidation.BULK_UPDATE_START_DATES, request);
    const items: BulkActionItemResponse<PcActivityRoomMentorAssignmentResponse>[] = [];
    for (const assignmentId of [...new Set(bulkRequest.assignment_ids)]) {
      try {
        const data = await this.updateMentorStartDate(admin, {
          room_id: bulkRequest.room_id,
          assignment_id: assignmentId,
          start_date: bulkRequest.start_date,
        }, context, now);
        items.push({ id: assignmentId, status: "SUCCESS", data });
      } catch (error) {
        items.push({ id: assignmentId, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }
    return toBulkActionResponse(items);
  }

  static async endMentorAssignment(
    admin: AdminUser,
    request: EndPcActivityRoomMentorAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    await assertMentorWriteAllowed(admin, context, now);

    const endRequest = Validation.validate(
      PcActivityRoomValidation.END_MENTOR_ASSIGNMENT,
      request,
    );

    const room = await findRoomOrThrow(endRequest.room_id);
    assertRoomInAdminUnit(admin, room.units.map((u) => u.unit_id));

    const existing = await prismaClient.pcActivityRoomMentorAssignment.findFirst({
      where: { id: endRequest.id, room_id: endRequest.room_id, deleted_at: null },
    });
    if (!existing) {
      throw new ResponseError(404, "Mentor assignment not found");
    }
    if (existing.status === PcActivityMentorAssignmentStatus.ENDED) {
      throw new ResponseError(400, "This mentor assignment has already ended");
    }

    await prismaClient.$transaction(async (tx) => {
      // A scheduled row never started, so it ends on its start date and frees
      // the source row to be promoted again.
      const wasScheduled = existing.status === PcActivityMentorAssignmentStatus.SCHEDULED;
      await tx.pcActivityRoomMentorAssignment.update({
        where: { id: existing.id },
        data: {
          end_date: wasScheduled ? existing.start_date : now,
          status: PcActivityMentorAssignmentStatus.ENDED,
          ...(wasScheduled ? { previous_assignment_id: null } : {}),
        },
      });

      await AuditService.record(
        {
          action: AuditAction.END_PC_ACTIVITY_ROOM_MENTOR_ASSIGNMENT,
          source: AuditSource.UI,
          entity_type: "PcActivityRoomMentorAssignment",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: { status: existing.status, end_date: existing.end_date?.toISOString() ?? null },
          new_values: {
            status: PcActivityMentorAssignmentStatus.ENDED,
            end_date: (wasScheduled ? existing.start_date : now).toISOString(),
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    return true;
  }

  static async removeMentorAssignment(
    admin: AdminUser,
    request: RemovePcActivityRoomMentorAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    await assertMentorWriteAllowed(admin, context, now);

    const removeRequest = Validation.validate(
      PcActivityRoomValidation.REMOVE_MENTOR_ASSIGNMENT,
      request,
    );

    const room = await findRoomOrThrow(removeRequest.room_id);
    assertRoomInAdminUnit(admin, room.units.map((u) => u.unit_id));

    const existing = await prismaClient.pcActivityRoomMentorAssignment.findFirst({
      where: { id: removeRequest.id, room_id: removeRequest.room_id, deleted_at: null },
    });
    if (!existing) {
      throw new ResponseError(404, "Mentor assignment not found");
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.pcActivityRoomMentorAssignment.update({
        where: { id: existing.id },
        data: {
          deleted_at: now,
          ...(existing.status === PcActivityMentorAssignmentStatus.SCHEDULED
            ? { previous_assignment_id: null }
            : {}),
        },
      });

      await AuditService.record(
        {
          action: AuditAction.REMOVE_PC_ACTIVITY_ROOM_MENTOR_ASSIGNMENT,
          source: AuditSource.UI,
          entity_type: "PcActivityRoomMentorAssignment",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: { deleted_at: null },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    return true;
  }

  static async reopenMentorAssignment(
    admin: AdminUser,
    request: ReopenPcActivityRoomMentorAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    await assertMentorWriteAllowed(admin, context, now);

    const reopenRequest = Validation.validate(
      PcActivityRoomValidation.REOPEN_MENTOR_ASSIGNMENT,
      request,
    );

    const room = await findRoomOrThrow(reopenRequest.room_id);
    assertRoomInAdminUnit(admin, room.units.map((u) => u.unit_id));

    const existing = await prismaClient.pcActivityRoomMentorAssignment.findFirst({
      where: { id: reopenRequest.id, room_id: reopenRequest.room_id, deleted_at: null },
    });
    if (!existing) {
      throw new ResponseError(404, "Mentor assignment not found");
    }
    if (existing.status !== PcActivityMentorAssignmentStatus.ENDED) {
      throw new ResponseError(400, "This mentor assignment hasn't ended");
    }

    await prismaClient.$transaction(async (tx) => {
      if (existing.intern_id) await lockInternWorkforce(tx, existing.intern_id);
      await assertMentorIsEligible(
        tx,
        existing.employee_id ?? undefined,
        existing.intern_id ?? undefined,
        room.units.map((entry) => entry.unit_id),
        now,
      );
      assertRoomPeriod(room, now);
      const duplicate = await tx.pcActivityRoomMentorAssignment.findFirst({
        where: {
          room_id: room.id,
          employee_id: existing.employee_id,
          intern_id: existing.intern_id,
          status: { in: [PcActivityMentorAssignmentStatus.ACTIVE, PcActivityMentorAssignmentStatus.SCHEDULED] },
          deleted_at: null,
          id: { not: existing.id },
        },
      });
      if (duplicate) {
        throw new ResponseError(400, "This person already has an active or scheduled mentor assignment on this room.");
      }
      await assertMentorCapacity(tx, room.id, existing.id);
      await assertMentorAcademicYearCapacity(
        tx,
        existing.employee_id,
        existing.intern_id,
        room.academic_year_id,
        existing.id,
      );
      await assertMentorHasNoSameDayConflict(
        tx,
        existing.employee_id,
        existing.intern_id,
        room.academic_year_id,
        room.day,
        existing.id,
      );
      await tx.pcActivityRoomMentorAssignment.update({
        where: { id: existing.id },
        data: { end_date: null, status: PcActivityMentorAssignmentStatus.ACTIVE },
      });

      await AuditService.record(
        {
          action: AuditAction.REOPEN_PC_ACTIVITY_ROOM_MENTOR_ASSIGNMENT,
          source: AuditSource.UI,
          entity_type: "PcActivityRoomMentorAssignment",
          entity_id: existing.id,
          admin_id: admin.id,
          // end_date !== null already checked above - TS narrowing doesn't
          // cross this closure boundary, hence the assertion.
          old_values: { end_date: existing.end_date!.toISOString() },
          new_values: { status: PcActivityMentorAssignmentStatus.ACTIVE, end_date: null },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    return true;
  }

  static async moveMentorAssignment(
    admin: AdminUser,
    request: MovePcActivityRoomMentorAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<PcActivityRoomMentorAssignmentResponse> {
    await assertMentorWriteAllowed(admin, context, now);
    const moveRequest = Validation.validate(PcActivityRoomValidation.MOVE_MENTOR_ASSIGNMENT, request);
    if (moveRequest.room_id === moveRequest.target_room_id) {
      throw new ResponseError(400, "Target room must be different from the current room");
    }
    const [sourceRoom, targetRoom] = await Promise.all([
      findRoomOrThrow(moveRequest.room_id),
      findRoomOrThrow(moveRequest.target_room_id),
    ]);
    assertRoomInAdminUnit(admin, sourceRoom.units.map((entry) => entry.unit_id));
    assertRoomInAdminUnit(admin, targetRoom.units.map((entry) => entry.unit_id));
    const source = await prismaClient.pcActivityRoomMentorAssignment.findFirst({
      where: { id: moveRequest.id, room_id: sourceRoom.id, deleted_at: null },
    });
    if (!source) throw new ResponseError(404, "Mentor assignment not found");
    const existingSuccessor = await prismaClient.pcActivityRoomMentorAssignment.findUnique({
      where: { previous_assignment_id: source.id },
      include: { employee: { include: { person: true } }, intern: true },
    });
    if (existingSuccessor) {
      if (
        existingSuccessor.deleted_at === null &&
        existingSuccessor.room_id === targetRoom.id &&
        isSameMentor(existingSuccessor, source)
      ) {
        return toPcActivityRoomMentorAssignmentResponse(existingSuccessor);
      }
      throw new ResponseError(
        400,
        "This mentor assignment has already been moved or promoted to another room.",
      );
    }
    if (source.status !== PcActivityMentorAssignmentStatus.ACTIVE) {
      throw new ResponseError(400, "Only an active mentor assignment can be moved or promoted");
    }
    const sameYear = sourceRoom.academic_year_id === targetRoom.academic_year_id;
    if (!sameYear) {
      await assertImmediatelyNextAcademicYear(sourceRoom.academic_year, targetRoom.academic_year);
      assertPromotionNotTooEarly(sourceRoom.academic_year, now);
    } else {
      assertRoomPeriod(targetRoom, now);
    }
    let createdId: string;
    try {
      createdId = await prismaClient.$transaction(async (tx) => {
        if (source.intern_id) await lockInternWorkforce(tx, source.intern_id);
        await assertMentorIsEligible(
          tx,
          source.employee_id ?? undefined,
          source.intern_id ?? undefined,
          targetRoom.units.map((entry) => entry.unit_id),
          sameYear ? now : targetRoom.start_date,
        );
        const duplicate = await tx.pcActivityRoomMentorAssignment.findFirst({
          where: {
            room_id: targetRoom.id,
            employee_id: source.employee_id,
            intern_id: source.intern_id,
            status: { in: [PcActivityMentorAssignmentStatus.ACTIVE, PcActivityMentorAssignmentStatus.SCHEDULED] },
            deleted_at: null,
          },
        });
        if (duplicate) {
          if (duplicate.previous_assignment_id === source.id) return duplicate.id;
          throw new ResponseError(400, "This person already has an active or scheduled mentor assignment on the target room.");
        }
        await assertMentorCapacity(tx, targetRoom.id);
        await assertMentorAcademicYearCapacity(
          tx,
          source.employee_id,
          source.intern_id,
          targetRoom.academic_year_id,
          sameYear ? source.id : undefined,
        );
        await assertMentorHasNoSameDayConflict(
          tx,
          source.employee_id,
          source.intern_id,
          targetRoom.academic_year_id,
          targetRoom.day,
          source.id,
        );
        if (sameYear) {
          await tx.pcActivityRoomMentorAssignment.update({
            where: { id: source.id },
            data: { end_date: now, status: PcActivityMentorAssignmentStatus.ENDED },
          });
        }
        const created = await tx.pcActivityRoomMentorAssignment.create({
          data: {
            room_id: targetRoom.id,
            employee_id: source.employee_id,
            intern_id: source.intern_id,
            start_date: sameYear ? now : targetRoom.start_date,
            status: sameYear
              ? PcActivityMentorAssignmentStatus.ACTIVE
              : PcActivityMentorAssignmentStatus.SCHEDULED,
            previous_assignment_id: source.id,
          },
        });
        await AuditService.record({
          action: AuditAction.MOVE_PC_ACTIVITY_ROOM_MENTOR_ASSIGNMENT,
          source: AuditSource.UI,
          entity_type: Prisma.ModelName.PcActivityRoomMentorAssignment,
          entity_id: created.id,
          admin_id: admin.id,
          old_values: { assignment_id: source.id, room_id: sourceRoom.id },
          new_values: { assignment_id: created.id, room_id: targetRoom.id },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        }, tx);
        return created.id;
      });
    } catch (error) {
      if (getUniqueConstraintFields(error)) {
        const successor = await prismaClient.pcActivityRoomMentorAssignment.findUnique({
          where: { previous_assignment_id: source.id },
          include: { employee: { include: { person: true } }, intern: true },
        });
        if (
          successor?.deleted_at === null &&
          successor.room_id === targetRoom.id &&
          isSameMentor(successor, source)
        ) {
          return toPcActivityRoomMentorAssignmentResponse(successor);
        }
      }
      throw error;
    }
    const created = await prismaClient.pcActivityRoomMentorAssignment.findUniqueOrThrow({
      where: { id: createdId },
      include: { employee: { include: { person: true } }, intern: true },
    });
    return toPcActivityRoomMentorAssignmentResponse(created);
  }

  static async bulkEndMentorAssignments(
    admin: AdminUser,
    request: BulkEndPcActivityRoomMentorAssignmentsRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<boolean>> {
    await assertMentorWriteAllowed(admin, context, now);
    const bulkRequest = Validation.validate(
      PcActivityRoomValidation.BULK_END_MENTOR_ASSIGNMENTS,
      request,
    );
    const items: BulkActionItemResponse<boolean>[] = [];
    for (const assignmentId of bulkRequest.assignment_ids) {
      try {
        const updated = await this.endMentorAssignment(
          admin,
          { id: assignmentId, room_id: bulkRequest.room_id },
          context,
          now,
        );
        items.push({ id: assignmentId, status: "SUCCESS", data: updated });
      } catch (error) {
        items.push({ id: assignmentId, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }
    return toBulkActionResponse(items);
  }

  static async bulkRemoveMentorAssignments(
    admin: AdminUser,
    request: BulkRemovePcActivityRoomMentorAssignmentsRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<boolean>> {
    await assertMentorWriteAllowed(admin, context, now);
    const bulkRequest = Validation.validate(
      PcActivityRoomValidation.BULK_REMOVE_MENTOR_ASSIGNMENTS,
      request,
    );
    const items: BulkActionItemResponse<boolean>[] = [];
    for (const assignmentId of bulkRequest.assignment_ids) {
      try {
        const updated = await this.removeMentorAssignment(
          admin,
          { id: assignmentId, room_id: bulkRequest.room_id },
          context,
          now,
        );
        items.push({ id: assignmentId, status: "SUCCESS", data: updated });
      } catch (error) {
        items.push({ id: assignmentId, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }
    return toBulkActionResponse(items);
  }

  static async bulkReopenMentorAssignments(
    admin: AdminUser,
    request: BulkReopenPcActivityRoomMentorAssignmentsRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<boolean>> {
    await assertMentorWriteAllowed(admin, context, now);
    const bulkRequest = Validation.validate(
      PcActivityRoomValidation.BULK_REOPEN_MENTOR_ASSIGNMENTS,
      request,
    );
    const items: BulkActionItemResponse<boolean>[] = [];
    for (const assignmentId of bulkRequest.assignment_ids) {
      try {
        const updated = await this.reopenMentorAssignment(
          admin,
          { id: assignmentId, room_id: bulkRequest.room_id },
          context,
          now,
        );
        items.push({ id: assignmentId, status: "SUCCESS", data: updated });
      } catch (error) {
        items.push({ id: assignmentId, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }
    return toBulkActionResponse(items);
  }

  // Loops moveMentorAssignment per assignment - that single-item method
  // already handles same-activity, different-activity, and next-year
  // (roll over) moves through target_room_id, so no separate bulk logic
  // is needed for the move-type distinction.
  static async bulkMoveMentorAssignments(
    admin: AdminUser,
    request: BulkMovePcActivityRoomMentorAssignmentsRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<PcActivityRoomMentorAssignmentResponse>> {
    await assertMentorWriteAllowed(admin, context, now);
    const bulkRequest = Validation.validate(
      PcActivityRoomValidation.BULK_MOVE_MENTOR_ASSIGNMENTS,
      request,
    );
    const items: BulkActionItemResponse<PcActivityRoomMentorAssignmentResponse>[] = [];
    for (const assignmentId of bulkRequest.assignment_ids) {
      try {
        const updated = await this.moveMentorAssignment(
          admin,
          {
            id: assignmentId,
            room_id: bulkRequest.room_id,
            target_room_id: bulkRequest.target_room_id,
          },
          context,
          now,
        );
        items.push({ id: assignmentId, status: "SUCCESS", data: updated });
      } catch (error) {
        items.push({ id: assignmentId, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }
    return toBulkActionResponse(items);
  }

  // --- Students ------------------------------------------------------------

  static async listEligibleStudents(
    admin: AdminUser,
    request: ListPcActivityRoomEligibleStudentsRequest,
  ): Promise<Pageable<PcActivityRoomEligibleStudentResponse>> {
    const listRequest = Validation.validate(
      PcActivityRoomValidation.LIST_ELIGIBLE_STUDENTS,
      request,
    );
    const room = await findRoomOrThrow(listRequest.room_id);
    const unitIds = room.units.map((u) => u.unit_id);
    assertRoomInAdminUnit(admin, unitIds);
    const gradeIds = room.grades.map((g) => g.grade_id);
    const classIds = room.classes.map((entry) => entry.class_id);

    const eligibleStudents = await eligibleEnrollmentRows(
      room.academic_year_id,
      unitIds,
      gradeIds,
      classIds,
    );
    const filteredStudents = eligibleStudents.filter((enrollment) =>
      (!listRequest.grade_id || enrollment.grade.id === listRequest.grade_id) &&
      (!listRequest.search ||
        enrollment.student.person.full_name.toLocaleLowerCase().includes(listRequest.search.toLocaleLowerCase()) ||
        enrollment.student.nis?.toLocaleLowerCase().includes(listRequest.search.toLocaleLowerCase())),
    );

    const activityRows = await prismaClient.passionConnectionActivity.findMany({
      where: {
        student_id: { in: filteredStudents.map((s) => s.student_id) },
        deleted_at: null,
        status: { in: [PcActivityAssignmentStatus.ACTIVE, PcActivityAssignmentStatus.SCHEDULED] },
        academic_year_id: room.academic_year_id,
      },
      include: { activity: { select: { name: true } } },
    });
    const rowsByStudentId = new Map<string, (typeof activityRows)[number]>();
    for (const row of activityRows) {
      rowsByStudentId.set(row.student_id, row);
    }

    const rows = filteredStudents.map((enrollment) => {
      const student = enrollment.student;
      const row = rowsByStudentId.get(student.id);
      // A same-day assignment elsewhere blocks this room; assignments on
      // other days don't - one PC room per day is the rule.
      const sameDayConflict = row !== undefined && row.day === room.day;
      // EXACT only for an unattached legacy row (room_id null) whose
      // activity+day already matches this room exactly - a different room's
      // same-day row is a real conflict, not something to attach here.
      const legacyMatch: "EXACT" | "DAY_ONLY" | "NONE" =
        row && row.room_id === null && sameDayConflict && row.activity_id === room.activity_id
          ? "EXACT"
          : sameDayConflict
            ? "DAY_ONLY"
            : "NONE";
      return {
        student_id: student.id,
        full_name: student.person.full_name,
        nis: student.nis,
        class_name: enrollment.class.name,
        grade_name: enrollment.grade.name,
        already_assigned: row?.room_id === room.id || sameDayConflict,
        other_activity:
          row && row.room_id !== room.id
            ? {
                assignment_id: row.id,
                activity_name: row.activity.name,
                day: row.day,
                room_id: row.room_id,
                same_day: sameDayConflict,
              }
            : null,
        legacy_match: legacyMatch,
      };
    });
    rows.sort((left, right) =>
      left.full_name.localeCompare(right.full_name) || left.student_id.localeCompare(right.student_id),
    );
    return pageableSlice(
      listRequest.available_only
        ? rows.filter((row) => !row.already_assigned || row.legacy_match === "EXACT")
        : rows,
      listRequest.page,
      listRequest.size,
    );
  }

  static async listStudents(
    admin: AdminUser,
    request: ListPcActivityRoomStudentsRequest,
  ): Promise<Pageable<PcActivityRoomStudentResponse>> {
    const listRequest = Validation.validate(
      PcActivityRoomValidation.LIST_STUDENTS,
      request,
    );
    const room = await findRoomOrThrow(listRequest.room_id);
    const unitIds = room.units.map((u) => u.unit_id);
    assertRoomInAdminUnit(admin, unitIds);
    const gradeIds = room.grades.map((g) => g.grade_id);
    const classIds = room.classes.map((entry) => entry.class_id);

    const eligibleIds = new Set(
      (await eligibleEnrollmentRows(room.academic_year_id, unitIds, gradeIds, classIds)).map(
        (row) => row.student_id,
      ),
    );
    const where: Prisma.PassionConnectionActivityWhereInput = {
      room_id: room.id,
      status: listRequest.status,
      ...(listRequest.search
        ? {
            student: {
              OR: [
                { person: { full_name: { contains: listRequest.search, mode: "insensitive" } } },
                { nis: { contains: listRequest.search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    };
    const skip = (listRequest.page - 1) * listRequest.size;
    const rows = await prismaClient.passionConnectionActivity.findMany({
      where,
      include: {
        student: {
          include: {
            person: { select: { full_name: true } },
          },
        },
      },
      ...(listRequest.sort_by === "student_name"
        ? {}
        : {
            skip,
            take: listRequest.size,
            orderBy: [
              { [listRequest.sort_by === "nis" ? "student" : listRequest.sort_by ?? "start_date"]: listRequest.sort_by === "nis" ? { nis: listRequest.sort_order } : listRequest.sort_order },
              { id: "asc" },
            ],
          }),
    });

    // Current class, independent of eligibility scope - a student out of
    // this room's grade/unit/class scope still has a real current class.
    const enrollments = await prismaClient.studentClassEnrollment.findMany({
      where: {
        academic_year_id: room.academic_year_id,
        enrollment_status: "ACTIVE",
        deleted_at: null,
        student_id: { in: rows.map((row) => row.student_id) },
      },
      select: { student_id: true, class: { select: { name: true } } },
    });
    const classNameByStudentId = new Map(
      enrollments.map((entry) => [entry.student_id, entry.class.name]),
    );

    const responseRows = rows.map((row) => ({
      id: row.id,
      student_id: row.student_id,
      student_name: row.student.person.full_name,
      nis: row.student.nis,
      class_name: classNameByStudentId.get(row.student_id) ?? null,
      day: row.day,
      status: row.status,
      start_date: row.start_date.toISOString(),
      expires_at: row.expires_at ? row.expires_at.toISOString() : null,
      end_date: row.end_date ? row.end_date.toISOString() : null,
      deleted_at: row.deleted_at?.toISOString() ?? null,
      still_eligible: eligibleIds.has(row.student_id),
    }));
    const direction = listRequest.sort_order === "desc" ? -1 : 1;
    responseRows.sort((left, right) => {
      const field = listRequest.sort_by;
      const leftValue = field === "student_name" ? left.student_name.toLocaleLowerCase() :
        field === "nis" ? left.nis ?? "" : field === "status" ? left.status : left.start_date;
      const rightValue = field === "student_name" ? right.student_name.toLocaleLowerCase() :
        field === "nis" ? right.nis ?? "" : field === "status" ? right.status : right.start_date;
      return leftValue === rightValue ? left.id.localeCompare(right.id) : leftValue.localeCompare(rightValue) * direction;
    });
    if (listRequest.sort_by === "student_name") {
      return pageableSlice(responseRows, listRequest.page, listRequest.size);
    }
    const totalItem = await prismaClient.passionConnectionActivity.count({ where });
    return {
      data: responseRows,
      paging: {
        size: listRequest.size,
        current_page: listRequest.page,
        total_page: Math.ceil(totalItem / listRequest.size),
        total_item: totalItem,
      },
    };
  }

  static async bulkAssignStudents(
    admin: AdminUser,
    request: BulkAssignPcActivityRoomStudentsRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<PCActivityResponse>> {
    await assertStudentWriteAllowed(admin, context, now);

    const bulkRequest = Validation.validate(
      PcActivityRoomValidation.BULK_ASSIGN_STUDENTS,
      request,
    );

    const room = await findRoomOrThrow(bulkRequest.room_id);
    const unitIds = room.units.map((u) => u.unit_id);
    assertRoomInAdminUnit(admin, unitIds);
    const gradeIds = room.grades.map((g) => g.grade_id);
    const classIds = room.classes.map((entry) => entry.class_id);

    if (now < room.start_date || now >= room.end_date) {
      throw new ResponseError(400, "Students can only be assigned during the room period");
    }
    const eligibleStudentIds = new Set(
      (await eligibleEnrollmentRows(room.academic_year_id, unitIds, gradeIds, classIds)).map(
        (row) => row.student_id,
      ),
    );

    // Legacy rows (room_id null) whose activity+day already match this room
    // exactly get attached instead of created - create() would fail against
    // the one-row-per-student/year/day unique index for these.
    const legacyMatches = await prismaClient.passionConnectionActivity.findMany({
      where: {
        student_id: { in: bulkRequest.student_ids },
        deleted_at: null,
        status: { in: [PcActivityAssignmentStatus.ACTIVE, PcActivityAssignmentStatus.SCHEDULED] },
        academic_year_id: room.academic_year_id,
        day: room.day,
        activity_id: room.activity_id,
        room_id: null,
      },
      select: { student_id: true },
    });
    const legacyMatchStudentIds = new Set(legacyMatches.map((row) => row.student_id));

    const items: BulkActionItemResponse<PCActivityResponse>[] = [];
    for (const studentId of [...new Set(bulkRequest.student_ids)]) {
      try {
        if (!eligibleStudentIds.has(studentId)) {
          await throwStudentIneligibleForRoom(room, studentId);
        }
        const created = legacyMatchStudentIds.has(studentId)
          ? await PCActivityService.attachLegacyAssignmentToRoom(
              admin,
              studentId,
              room,
              context,
              now,
              bulkRequest.start_date,
            )
          : await PCActivityService.create(
              admin,
              {
                student_id: studentId,
                day: room.day,
                activity_id: room.activity_id,
                academic_year_id: room.academic_year_id,
                room_id: room.id,
                start_date: bulkRequest.start_date,
              },
              "ROOM",
              context,
              now,
            );
        items.push({ id: studentId, status: "SUCCESS", data: created });
      } catch (error) {
        items.push({ id: studentId, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }

    const response = toBulkActionResponse(items);
    await AuditService.record({
      action: AuditAction.BULK_ASSIGN_PC_ACTIVITY_ROOM_STUDENTS,
      source: AuditSource.UI,
      entity_type: "PcActivityRoom",
      entity_id: room.id,
      admin_id: admin.id,
      new_values: {
        success_count: response.success_count,
        failed_count: response.failed_count,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });
    return response;
  }

  static async updateStudentStartDate(
    admin: AdminUser,
    request: UpdatePcActivityRoomAssignmentStartDateRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<PcActivityRoomStudentResponse> {
    await assertStudentWriteAllowed(admin, context, now);
    const updateRequest = Validation.validate(PcActivityRoomValidation.UPDATE_START_DATE, request);
    const room = await findRoomOrThrow(updateRequest.room_id);
    assertRoomInAdminUnit(admin, room.units.map((entry) => entry.unit_id));
    const assignment = await prismaClient.passionConnectionActivity.findFirst({
      where: { id: updateRequest.assignment_id, room_id: room.id },
      include: {
        student: { include: { person: { select: { full_name: true } } } },
        next_assignment: { select: { id: true } },
      },
    });
    if (!assignment) throw new ResponseError(404, "Student assignment not found");
    const startDate = parseAssignmentStartDate(updateRequest.start_date, room, now);
    assertEditableStartDate(assignment, startDate, assignment.expires_at);
    const updated = await prismaClient.$transaction(async (tx) => {
      const row = await tx.passionConnectionActivity.update({
        where: { id: assignment.id },
        data: { start_date: startDate },
        include: { student: { include: { person: { select: { full_name: true } } } } },
      });
      await AuditService.record({
        action: AuditAction.UPDATE_PC_ACTIVITY_ROOM_STUDENT_START_DATE,
        source: AuditSource.UI,
        entity_type: Prisma.ModelName.PassionConnectionActivity,
        entity_id: assignment.id,
        admin_id: admin.id,
        old_values: { start_date: assignment.start_date.toISOString() },
        new_values: { start_date: startDate.toISOString() },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      }, tx);
      return row;
    });
    const enrollment = await prismaClient.studentClassEnrollment.findFirst({
      where: { student_id: updated.student_id, academic_year_id: room.academic_year_id, enrollment_status: "ACTIVE", deleted_at: null },
      select: { class: { select: { name: true } } },
    });
    const stillEligible = (await eligibleEnrollmentRows(
      room.academic_year_id,
      room.units.map((entry) => entry.unit_id),
      room.grades.map((entry) => entry.grade_id),
      room.classes.map((entry) => entry.class_id),
    )).some((entry) => entry.student_id === updated.student_id);
    return {
      id: updated.id,
      student_id: updated.student_id,
      student_name: updated.student.person.full_name,
      nis: updated.student.nis,
      class_name: enrollment?.class.name ?? null,
      day: updated.day,
      status: updated.status,
      start_date: updated.start_date.toISOString(),
      expires_at: updated.expires_at?.toISOString() ?? null,
      end_date: updated.end_date?.toISOString() ?? null,
      deleted_at: updated.deleted_at?.toISOString() ?? null,
      still_eligible: stillEligible,
    };
  }

  static async bulkUpdateStudentStartDates(
    admin: AdminUser,
    request: BulkUpdatePcActivityRoomAssignmentStartDatesRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<PcActivityRoomStudentResponse>> {
    const bulkRequest = Validation.validate(PcActivityRoomValidation.BULK_UPDATE_START_DATES, request);
    const items: BulkActionItemResponse<PcActivityRoomStudentResponse>[] = [];
    for (const assignmentId of [...new Set(bulkRequest.assignment_ids)]) {
      try {
        const data = await this.updateStudentStartDate(admin, {
          room_id: bulkRequest.room_id,
          assignment_id: assignmentId,
          start_date: bulkRequest.start_date,
        }, context, now);
        items.push({ id: assignmentId, status: "SUCCESS", data });
      } catch (error) {
        items.push({ id: assignmentId, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }
    return toBulkActionResponse(items);
  }

  static async endStudentAssignment(
    admin: AdminUser,
    request: EndPcActivityRoomStudentAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    await assertStudentWriteAllowed(admin, context, now);
    const endRequest = Validation.validate(
      PcActivityRoomValidation.END_STUDENT_ASSIGNMENT,
      request,
    );
    const room = await findRoomOrThrow(endRequest.room_id);
    assertRoomInAdminUnit(admin, room.units.map((unit) => unit.unit_id));
    const assignment = await prismaClient.passionConnectionActivity.findFirst({
      where: {
        id: endRequest.assignment_id,
        room_id: room.id,
        status: { in: [PcActivityAssignmentStatus.ACTIVE, PcActivityAssignmentStatus.SCHEDULED] },
        deleted_at: null,
      },
    });
    if (!assignment) {
      throw new ResponseError(404, "Active student assignment not found");
    }
    const wasScheduled = assignment.status === PcActivityAssignmentStatus.SCHEDULED;
    const endedOn = wasScheduled ? assignment.start_date : now;
    await prismaClient.$transaction(async (tx) => {
      await tx.passionConnectionActivity.update({
        where: { id: assignment.id },
        data: {
          status: PcActivityAssignmentStatus.ENDED,
          end_date: endedOn,
          ...(wasScheduled ? { previous_assignment_id: null } : {}),
        },
      });
      await AuditService.record(
        {
          action: AuditAction.END_PC_ACTIVITY_ROOM_STUDENT_ASSIGNMENT,
          source: AuditSource.UI,
          entity_type: "PassionConnectionActivity",
          entity_id: assignment.id,
          admin_id: admin.id,
          old_values: { status: assignment.status, end_date: null },
          new_values: { status: PcActivityAssignmentStatus.ENDED, end_date: endedOn.toISOString() },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });
    return true;
  }

  static async dropStudentAssignment(
    admin: AdminUser,
    request: DropPcActivityRoomStudentAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    await assertStudentWriteAllowed(admin, context, now);
    const dropRequest = Validation.validate(PcActivityRoomValidation.DROP_STUDENT_ASSIGNMENT, request);
    const room = await findRoomOrThrow(dropRequest.room_id);
    assertRoomInAdminUnit(admin, room.units.map((entry) => entry.unit_id));
    const assignment = await prismaClient.passionConnectionActivity.findFirst({
      where: { id: dropRequest.assignment_id, room_id: room.id, deleted_at: null },
    });
    if (!assignment) throw new ResponseError(404, "Student assignment not found");
    await prismaClient.$transaction(async (tx) => {
      await tx.passionConnectionActivity.update({
        where: { id: assignment.id },
        data: {
          deleted_at: now,
          ...(assignment.status === PcActivityAssignmentStatus.SCHEDULED
            ? { previous_assignment_id: null }
            : {}),
        },
      });
      await AuditService.record({
        action: AuditAction.DROP_PC_ACTIVITY_ROOM_STUDENT_ASSIGNMENT,
        source: AuditSource.UI,
        entity_type: Prisma.ModelName.PassionConnectionActivity,
        entity_id: assignment.id,
        admin_id: admin.id,
        old_values: { deleted_at: null },
        new_values: { deleted_at: now.toISOString() },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      }, tx);
    });
    return true;
  }

  static async reopenStudentAssignment(
    admin: AdminUser,
    request: ReopenPcActivityRoomStudentAssignmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    await assertStudentWriteAllowed(admin, context, now);
    const reopenRequest = Validation.validate(PcActivityRoomValidation.REOPEN_STUDENT_ASSIGNMENT, request);
    const room = await findRoomOrThrow(reopenRequest.room_id);
    assertRoomInAdminUnit(admin, room.units.map((entry) => entry.unit_id));
    assertRoomPeriod(room, now);
    const assignment = await prismaClient.passionConnectionActivity.findFirst({
      where: {
        id: reopenRequest.assignment_id,
        room_id: room.id,
        status: PcActivityAssignmentStatus.ENDED,
        deleted_at: null,
      },
    });
    if (!assignment) throw new ResponseError(404, "Ended student assignment not found");
    await assertStudentEligibleForRoom(room, assignment.student_id);
    const conflict = await prismaClient.passionConnectionActivity.findFirst({
      where: {
        student_id: assignment.student_id,
        academic_year_id: room.academic_year_id,
        day: room.day,
        status: PcActivityAssignmentStatus.ACTIVE,
        deleted_at: null,
        id: { not: assignment.id },
      },
    });
    if (conflict) throw new ResponseError(400, "Student already has an active assignment on this day");
    await prismaClient.$transaction(async (tx) => {
      await assertRoomStudentCapacity(tx, room.id, assignment.id);
      await tx.passionConnectionActivity.update({
        where: { id: assignment.id },
        data: { status: PcActivityAssignmentStatus.ACTIVE, end_date: null, expires_at: room.end_date },
      });
      await AuditService.record({
        action: AuditAction.REOPEN_PC_ACTIVITY_ROOM_STUDENT_ASSIGNMENT,
        source: AuditSource.UI,
        entity_type: Prisma.ModelName.PassionConnectionActivity,
        entity_id: assignment.id,
        admin_id: admin.id,
        old_values: { status: assignment.status, end_date: assignment.end_date?.toISOString() ?? null },
        new_values: { status: PcActivityAssignmentStatus.ACTIVE, end_date: null },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      }, tx);
    });
    return true;
  }

  static async moveStudent(
    admin: AdminUser,
    request: MovePcActivityRoomStudentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<PCActivityResponse> {
    await assertStudentWriteAllowed(admin, context, now);
    const moveRequest = Validation.validate(PcActivityRoomValidation.MOVE_STUDENT, request);
    if (moveRequest.room_id === moveRequest.target_room_id) {
      throw new ResponseError(400, "Target room must be different from the current room");
    }
    const [sourceRoom, targetRoom] = await Promise.all([
      findRoomOrThrow(moveRequest.room_id),
      findRoomOrThrow(moveRequest.target_room_id),
    ]);
    assertRoomInAdminUnit(admin, sourceRoom.units.map((entry) => entry.unit_id));
    assertRoomInAdminUnit(admin, targetRoom.units.map((entry) => entry.unit_id));
    const source = await prismaClient.passionConnectionActivity.findFirst({
      where: {
        id: moveRequest.assignment_id,
        room_id: sourceRoom.id,
        status: PcActivityAssignmentStatus.ACTIVE,
        deleted_at: null,
      },
    });
    if (!source) throw new ResponseError(404, "Active student assignment not found");
    const sameYear = sourceRoom.academic_year_id === targetRoom.academic_year_id;
    if (sameYear) {
      if (sourceRoom.day !== targetRoom.day) {
        throw new ResponseError(400, "Same-year moves require rooms on the same day");
      }
      assertRoomPeriod(targetRoom, now);
    } else {
      await assertImmediatelyNextAcademicYear(sourceRoom.academic_year, targetRoom.academic_year);
      assertPromotionNotTooEarly(sourceRoom.academic_year, now);
    }
    await assertStudentEligibleForRoom(targetRoom, source.student_id);
    const conflict = await prismaClient.passionConnectionActivity.findFirst({
      where: {
        student_id: source.student_id,
        academic_year_id: targetRoom.academic_year_id,
        day: targetRoom.day,
        status: PcActivityAssignmentStatus.ACTIVE,
        deleted_at: null,
        id: { not: source.id },
      },
    });
    if (conflict) throw new ResponseError(400, "Student already has an active assignment on the target day");
    const existingSuccessor = await prismaClient.passionConnectionActivity.findFirst({
      where: { previous_assignment_id: source.id },
      select: { id: true },
    });
    if (existingSuccessor) {
      throw new ResponseError(
        400,
        "This student assignment has already been moved or promoted to another room.",
      );
    }
    const createdId = await prismaClient.$transaction(async (tx) => {
      await assertRoomStudentCapacity(tx, targetRoom.id);
      if (sameYear) {
        await tx.passionConnectionActivity.update({
          where: { id: source.id },
          data: { status: PcActivityAssignmentStatus.ENDED, end_date: now },
        });
      }
      const created = await tx.passionConnectionActivity.create({
        data: {
          student_id: source.student_id,
          room_id: targetRoom.id,
          activity_id: targetRoom.activity_id,
          academic_year_id: targetRoom.academic_year_id,
          day: targetRoom.day,
          start_date: sameYear ? now : targetRoom.start_date,
          expires_at: targetRoom.end_date,
          status: sameYear
            ? PcActivityAssignmentStatus.ACTIVE
            : PcActivityAssignmentStatus.SCHEDULED,
          previous_assignment_id: source.id,
        },
      });
      await AuditService.record({
        action: AuditAction.MOVE_PC_ACTIVITY_ROOM_STUDENT_ASSIGNMENT,
        source: AuditSource.UI,
        entity_type: Prisma.ModelName.PassionConnectionActivity,
        entity_id: created.id,
        admin_id: admin.id,
        old_values: { assignment_id: source.id, room_id: sourceRoom.id },
        new_values: { assignment_id: created.id, room_id: targetRoom.id },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      }, tx);
      return created.id;
    });
    const created = await prismaClient.passionConnectionActivity.findUniqueOrThrow({
      where: { id: createdId },
      include: { activity: true, room: true },
    });
    const mentors = targetRoom.mentors
      .filter((mentor) => mentor.status === PcActivityMentorAssignmentStatus.ACTIVE && mentor.deleted_at === null)
      .map((mentor) => mentor.employee
        ? { id: mentor.employee.id, name: mentor.employee.person.full_name, type: "EMPLOYEE" as const }
        : { id: mentor.intern!.id, name: mentor.intern!.full_name, type: "INTERN" as const });
    return toPCActivityResponse(created, mentors);
  }

  static async reassignStudent(
    admin: AdminUser,
    request: ReassignPcActivityRoomStudentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<PCActivityResponse> {
    const reassignRequest = Validation.validate(
      PcActivityRoomValidation.REASSIGN_STUDENT,
      request,
    );
    const source = await prismaClient.passionConnectionActivity.findFirst({
      where: {
        id: reassignRequest.source_assignment_id,
        student_id: reassignRequest.student_id,
        status: PcActivityAssignmentStatus.ACTIVE,
        deleted_at: null,
      },
    });
    if (!source?.room_id) throw new ResponseError(404, "Current room assignment not found");
    return this.moveStudent(admin, {
      room_id: source.room_id,
      assignment_id: source.id,
      target_room_id: reassignRequest.room_id,
    }, context, now);
  }

  static async bulkEndStudentAssignments(
    admin: AdminUser,
    request: BulkEndPcActivityRoomStudentAssignmentsRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<boolean>> {
    await assertStudentWriteAllowed(admin, context, now);
    const bulkRequest = Validation.validate(
      PcActivityRoomValidation.BULK_END_STUDENT_ASSIGNMENTS,
      request,
    );
    const items: BulkActionItemResponse<boolean>[] = [];
    for (const assignmentId of bulkRequest.assignment_ids) {
      try {
        const updated = await this.endStudentAssignment(
          admin,
          { room_id: bulkRequest.room_id, assignment_id: assignmentId },
          context,
          now,
        );
        items.push({ id: assignmentId, status: "SUCCESS", data: updated });
      } catch (error) {
        items.push({ id: assignmentId, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }
    return toBulkActionResponse(items);
  }

  static async bulkDropStudentAssignments(
    admin: AdminUser,
    request: BulkDropPcActivityRoomStudentAssignmentsRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<boolean>> {
    await assertStudentWriteAllowed(admin, context, now);
    const bulkRequest = Validation.validate(
      PcActivityRoomValidation.BULK_DROP_STUDENT_ASSIGNMENTS,
      request,
    );
    const items: BulkActionItemResponse<boolean>[] = [];
    for (const assignmentId of bulkRequest.assignment_ids) {
      try {
        const updated = await this.dropStudentAssignment(
          admin,
          { room_id: bulkRequest.room_id, assignment_id: assignmentId },
          context,
          now,
        );
        items.push({ id: assignmentId, status: "SUCCESS", data: updated });
      } catch (error) {
        items.push({ id: assignmentId, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }
    return toBulkActionResponse(items);
  }

  static async bulkReopenStudentAssignments(
    admin: AdminUser,
    request: BulkReopenPcActivityRoomStudentAssignmentsRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<boolean>> {
    await assertStudentWriteAllowed(admin, context, now);
    const bulkRequest = Validation.validate(
      PcActivityRoomValidation.BULK_REOPEN_STUDENT_ASSIGNMENTS,
      request,
    );
    const items: BulkActionItemResponse<boolean>[] = [];
    for (const assignmentId of bulkRequest.assignment_ids) {
      try {
        const updated = await this.reopenStudentAssignment(
          admin,
          { room_id: bulkRequest.room_id, assignment_id: assignmentId },
          context,
          now,
        );
        items.push({ id: assignmentId, status: "SUCCESS", data: updated });
      } catch (error) {
        items.push({ id: assignmentId, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }
    return toBulkActionResponse(items);
  }

  // Loops moveStudent per assignment - that single-item method already
  // handles same-activity, different-activity, and next-year (roll over)
  // moves through target_room_id, so no separate bulk logic is needed
  // for the move-type distinction.
  static async bulkMoveStudentAssignments(
    admin: AdminUser,
    request: BulkMovePcActivityRoomStudentAssignmentsRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkActionResponse<PCActivityResponse>> {
    await assertStudentWriteAllowed(admin, context, now);
    const bulkRequest = Validation.validate(
      PcActivityRoomValidation.BULK_MOVE_STUDENT_ASSIGNMENTS,
      request,
    );
    const items: BulkActionItemResponse<PCActivityResponse>[] = [];
    for (const assignmentId of bulkRequest.assignment_ids) {
      try {
        const updated = await this.moveStudent(
          admin,
          {
            room_id: bulkRequest.room_id,
            assignment_id: assignmentId,
            target_room_id: bulkRequest.target_room_id,
          },
          context,
          now,
        );
        items.push({ id: assignmentId, status: "SUCCESS", data: updated });
      } catch (error) {
        items.push({ id: assignmentId, status: "FAILED", error: bulkFailureMessage(error) });
      }
    }
    return toBulkActionResponse(items);
  }

  // --- Sweep -----------------------------------------------------------

  // Activates due scheduled rows. A row whose student or mentor no longer
  // qualifies (withdrawn, resigned, expired intern, room gone) is cancelled
  // instead, so the predecessor stays as it was and the source can be
  // promoted again.
  static async activateScheduledAssignments(now: Date = new Date()): Promise<number> {
    return prismaClient.$transaction(async (tx) => {
      const scheduledStudents = await tx.passionConnectionActivity.findMany({
        where: {
          status: PcActivityAssignmentStatus.SCHEDULED,
          start_date: { lte: now },
          deleted_at: null,
        },
        include: {
          student: { select: { status: true, deleted_at: true } },
          room: { select: { deleted_at: true } },
        },
      });
      const scheduledMentors = await tx.pcActivityRoomMentorAssignment.findMany({
        where: {
          status: PcActivityMentorAssignmentStatus.SCHEDULED,
          start_date: { lte: now },
          deleted_at: null,
        },
        include: {
          room: { select: { deleted_at: true } },
          employee: { select: { status: true, deleted_at: true } },
          intern: { select: { status: true, end_date: true } },
        },
      });

      for (const assignment of scheduledStudents) {
        let reason: string | null = null;
        if (!assignment.room || assignment.room.deleted_at) {
          reason = "room no longer exists";
        } else if (assignment.student.deleted_at || assignment.student.status !== StudentStatus.ACTIVE) {
          reason = "student is no longer active";
        } else {
          const enrollment = await tx.studentClassEnrollment.findFirst({
            where: {
              student_id: assignment.student_id,
              academic_year_id: assignment.academic_year_id,
              enrollment_status: EnrollmentStatus.ACTIVE,
              deleted_at: null,
            },
            select: { id: true },
          });
          if (!enrollment) reason = "student has no active enrollment in the room's year";
        }

        if (reason) {
          await tx.passionConnectionActivity.update({
            where: { id: assignment.id },
            data: {
              status: PcActivityAssignmentStatus.ENDED,
              end_date: assignment.start_date,
              deleted_at: now,
              previous_assignment_id: null,
            },
          });
          await AuditService.record(
            {
              action: AuditAction.AUTO_CANCEL_PC_ACTIVITY_ASSIGNMENT,
              source: AuditSource.SYSTEM,
              entity_type: "PassionConnectionActivity",
              entity_id: assignment.id,
              new_values: { reason },
            },
            tx,
          );
          continue;
        }

        if (assignment.previous_assignment_id) {
          await tx.passionConnectionActivity.updateMany({
            where: {
              id: assignment.previous_assignment_id,
              status: PcActivityAssignmentStatus.ACTIVE,
              deleted_at: null,
            },
            data: { status: PcActivityAssignmentStatus.ENDED, end_date: now },
          });
        }
        await tx.passionConnectionActivity.update({
          where: { id: assignment.id },
          data: { status: PcActivityAssignmentStatus.ACTIVE },
        });
        await AuditService.record(
          {
            action: AuditAction.AUTO_ACTIVATE_PC_ACTIVITY_ASSIGNMENT,
            source: AuditSource.SYSTEM,
            entity_type: "PassionConnectionActivity",
            entity_id: assignment.id,
            new_values: { status: PcActivityAssignmentStatus.ACTIVE },
          },
          tx,
        );
      }

      for (const assignment of scheduledMentors) {
        let reason: string | null = null;
        if (assignment.room.deleted_at) {
          reason = "room no longer exists";
        } else if (
          assignment.employee &&
          (assignment.employee.deleted_at || assignment.employee.status !== EmployeeStatus.ACTIVE)
        ) {
          reason = "employee is no longer active";
        } else if (
          assignment.intern &&
          (assignment.intern.status !== InternStatus.ACTIVE || assignment.intern.end_date <= now)
        ) {
          reason = "intern is no longer active";
        }

        if (reason) {
          await tx.pcActivityRoomMentorAssignment.update({
            where: { id: assignment.id },
            data: {
              status: PcActivityMentorAssignmentStatus.ENDED,
              end_date: assignment.start_date,
              deleted_at: now,
              previous_assignment_id: null,
            },
          });
          await AuditService.record(
            {
              action: AuditAction.AUTO_CANCEL_PC_ACTIVITY_ASSIGNMENT,
              source: AuditSource.SYSTEM,
              entity_type: "PcActivityRoomMentorAssignment",
              entity_id: assignment.id,
              new_values: { reason },
            },
            tx,
          );
          continue;
        }

        if (assignment.previous_assignment_id) {
          await tx.pcActivityRoomMentorAssignment.updateMany({
            where: {
              id: assignment.previous_assignment_id,
              status: PcActivityMentorAssignmentStatus.ACTIVE,
              deleted_at: null,
            },
            data: { status: PcActivityMentorAssignmentStatus.ENDED, end_date: now },
          });
        }
        await tx.pcActivityRoomMentorAssignment.update({
          where: { id: assignment.id },
          data: { status: PcActivityMentorAssignmentStatus.ACTIVE },
        });
        await AuditService.record(
          {
            action: AuditAction.AUTO_ACTIVATE_PC_ACTIVITY_ASSIGNMENT,
            source: AuditSource.SYSTEM,
            entity_type: "PcActivityRoomMentorAssignment",
            entity_id: assignment.id,
            new_values: { status: PcActivityMentorAssignmentStatus.ACTIVE },
          },
          tx,
        );
      }

      return scheduledStudents.length + scheduledMentors.length;
    });
  }

  // Flips ACTIVE -> EXPIRED once expires_at passes - never touches
  // deleted_at or reassigns anything, an admin decides what happens next.
  static async expirePastDueAssignments(now: Date = new Date()): Promise<number> {
    const pastDue = await prismaClient.passionConnectionActivity.findMany({
      where: {
        status: PcActivityAssignmentStatus.ACTIVE,
        expires_at: { lte: now },
        deleted_at: null,
      },
      select: { id: true },
    });
    if (pastDue.length === 0) return 0;

    await prismaClient.$transaction(async (tx) => {
      await tx.passionConnectionActivity.updateMany({
        where: { id: { in: pastDue.map((row) => row.id) } },
        data: { status: PcActivityAssignmentStatus.EXPIRED, end_date: now },
      });
      for (const row of pastDue) {
        await AuditService.record(
          {
            action: AuditAction.AUTO_EXPIRE_PC_ACTIVITY_ASSIGNMENT,
            source: AuditSource.SYSTEM,
            entity_type: "PassionConnectionActivity",
            entity_id: row.id,
            new_values: { status: PcActivityAssignmentStatus.EXPIRED },
          },
          tx,
        );
      }
    });

    return pastDue.length;
  }
}
