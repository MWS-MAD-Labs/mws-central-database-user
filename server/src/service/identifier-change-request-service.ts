import {
  AdminRole,
  AuditAction,
  AuditSource,
  IdentifierChangeRequestStatus,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { paginate } from "../model/page-model";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  EMPLOYEE_LOCKABLE_FIELDS,
  IDENTIFIER_FIELD_LABELS,
  STUDENT_LOCKABLE_FIELDS,
  toIdentifierChangeRequestResponse,
  type CreateIdentifierChangeRequest,
  type DecideIdentifierChangeRequest,
  type EmployeeLockableField,
  type IdentifierChangeEntityType,
  type IdentifierChangeRequestListResponse,
  type IdentifierChangeRequestResponse,
  type ListIdentifierChangeRequests,
  type ListMyIdentifierChangeRequests,
  type MyIdentifierChangeRequestListResponse,
} from "../model/identifier-change-request-model";
import { IdentifierChangeRequestValidation } from "../validation/identifier-change-request-validation";
import { Validation } from "../validation/validation";
import { AuditService } from "./audit-service";
import { EmployeeService } from "./employee-service";
import { StudentService } from "./student-service";
import { assertCanWriteUnit, canViewEmployeeDisciplinaryData } from "../utils/admin-permissions";
import { DisciplinaryChangeRequestService } from "./disciplinary-change-request-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { isPastIdentifierGracePeriod } from "../utils/identifier-lock";
import {
  canApproveEntity,
  hasActiveApprover,
  isChangeRequestApprover,
  NO_APPROVER_MESSAGE,
} from "../utils/change-request-approver";

const REQUEST_INCLUDE = {
  requester: { select: { id: true, full_name: true, email: true } },
  decider: { select: { id: true, full_name: true, email: true } },
} as const;

type LockedFieldSnapshot = {
  currentValue: string | null;
  locked: boolean;
  unitId: string | null;
  entityName: string;
};

function canApprove(admin: AdminUser): boolean {
  return isChangeRequestApprover(admin);
}

function canSeeEmployeePii(admin: AdminUser): boolean {
  return admin.role === AdminRole.SUPER_ADMIN || admin.can_view_employee_pii;
}

function assertKnownField(entityType: IdentifierChangeEntityType, field: string) {
  const allowed: readonly string[] =
    entityType === "Employee" ? EMPLOYEE_LOCKABLE_FIELDS : STUDENT_LOCKABLE_FIELDS;
  if (!allowed.includes(field)) {
    throw new ResponseError(
      400,
      `"${field}" is not a lockable ${entityType.toLowerCase()} identifier field`,
    );
  }
}

async function loadLockedField(
  entityType: IdentifierChangeEntityType,
  entityId: string,
  field: string,
  now: Date,
): Promise<LockedFieldSnapshot> {
  if (entityType === "Employee") {
    const employee = await prismaClient.employee.findFirst({
      where: { id: entityId, deleted_at: null },
      include: { person: { select: { full_name: true } } },
    });
    if (!employee) throw new ResponseError(404, "Employee not found");
    const key = field as EmployeeLockableField;
    const currentValue = employee[key] ?? null;
    const setAt = employee[`${key}_set_at`] ?? employee.created_at;
    return {
      currentValue,
      // Same rule as EmployeeService.update: only an existing value past its grace window is locked.
      locked: currentValue !== null && isPastIdentifierGracePeriod(setAt, now),
      unitId: employee.unit_id,
      entityName: employee.person.full_name,
    };
  }

  const student = await prismaClient.student.findFirst({
    where: { id: entityId, deleted_at: null },
    include: {
      person: { select: { full_name: true } },
      current_grade: { select: { unit_id: true } },
    },
  });
  if (!student) throw new ResponseError(404, "Student not found");
  const currentValue = student.nisn ?? null;
  return {
    currentValue,
    locked:
      currentValue !== null && isPastIdentifierGracePeriod(student.created_at, now),
    unitId: student.current_grade?.unit_id ?? null,
    entityName: student.person.full_name,
  };
}

async function assertCanRequest(
  admin: AdminUser,
  entityType: IdentifierChangeEntityType,
  unitId: string | null,
  context: AuditRequestContext,
  now: Date,
) {
  if (admin.role === AdminRole.VIEWER) {
    throw new ResponseError(403, "Forbidden: Viewer cannot request changes");
  }
  if (entityType === "Employee" && !canSeeEmployeePii(admin)) {
    throw new ResponseError(
      403,
      "Forbidden: You don't have permission to change employee PII (NIK/NPWP/bank account/BPJS)",
    );
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    const canWrite =
      entityType === "Employee"
        ? admin.can_write_employee_data
        : admin.can_write_student_data;
    if (!canWrite) {
      throw new ResponseError(
        403,
        `Forbidden: You don't have permission to write ${entityType.toLowerCase()} data`,
      );
    }
    await assertCanWriteUnit(
      admin,
      unitId,
      entityType === "Employee" ? "employee" : "student",
    );
    await assertCanWriteNow(admin, context, now);
  }
}

async function findPendingOrThrow(id: string) {
  const request = await prismaClient.identifierChangeRequest.findUnique({
    where: { id },
  });
  if (!request) throw new ResponseError(404, "Change request not found");
  if (request.status !== IdentifierChangeRequestStatus.PENDING) {
    throw new ResponseError(400, "This request has already been decided or cancelled");
  }
  return request;
}

// The review queue is for approvers only.
function assertCanReview(admin: AdminUser) {
  if (!canApprove(admin)) {
    throw new ResponseError(
      403,
      "Forbidden: Only change request approvers can view this queue",
    );
  }
}

async function assertCanDecide(
  admin: AdminUser,
  requestedBy: string,
  entityType: string,
) {
  if (!(await canApproveEntity(admin, entityType))) {
    throw new ResponseError(
      403,
      "Forbidden: You're not an approver for identifier change requests",
    );
  }
  if (entityType === "DisciplinaryAction" && !canViewEmployeeDisciplinaryData(admin)) {
    throw new ResponseError(
      403,
      "Forbidden: Employee disciplinary data access is required to decide this request",
    );
  }
  if (admin.id === requestedBy) {
    throw new ResponseError(403, "You can't decide your own change request");
  }
}

async function entityNames(
  records: { entity_type: string; entity_id: string }[],
): Promise<Map<string, string>> {
  const employeeIds = records.filter((r) => r.entity_type === "Employee").map((r) => r.entity_id);
  const studentIds = records.filter((r) => r.entity_type === "Student").map((r) => r.entity_id);
  const actionIds = records
    .filter((r) => r.entity_type === "DisciplinaryAction")
    .map((r) => r.entity_id);
  const [employees, students, actions] = await Promise.all([
    employeeIds.length
      ? prismaClient.employee.findMany({
          where: { id: { in: employeeIds } },
          select: { id: true, person: { select: { full_name: true } } },
        })
      : [],
    studentIds.length
      ? prismaClient.student.findMany({
          where: { id: { in: studentIds } },
          select: { id: true, person: { select: { full_name: true } } },
        })
      : [],
    actionIds.length
      ? prismaClient.employeeDisciplinaryAction.findMany({
          where: { id: { in: actionIds } },
          select: {
            id: true,
            employee: { select: { person: { select: { full_name: true } } } },
          },
        })
      : [],
  ]);
  return new Map([
    ...actions.map(
      (a) => [`DisciplinaryAction:${a.id}`, a.employee.person.full_name] as const,
    ),
    ...employees.map((e) => [`Employee:${e.id}`, e.person.full_name] as const),
    ...students.map((s) => [`Student:${s.id}`, s.person.full_name] as const),
  ]);
}

export class IdentifierChangeRequestService {
  static async create(
    admin: AdminUser,
    request: CreateIdentifierChangeRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<IdentifierChangeRequestResponse> {
    const validated = Validation.validate(IdentifierChangeRequestValidation.CREATE, request);
    // Same normalization employee-validation.ts applies before storing.
    const createRequest = {
      ...validated,
      new_value: validated.new_value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase(),
    };
    assertKnownField(createRequest.entity_type, createRequest.field_name);

    const snapshot = await loadLockedField(
      createRequest.entity_type,
      createRequest.entity_id,
      createRequest.field_name,
      now,
    );
    await assertCanRequest(admin, createRequest.entity_type, snapshot.unitId, context, now);

    if (!snapshot.locked) {
      throw new ResponseError(
        400,
        `${IDENTIFIER_FIELD_LABELS[createRequest.field_name]} isn't locked yet. Edit it directly, no request needed.`,
      );
    }
    if (await canApproveEntity(admin, createRequest.entity_type)) {
      throw new ResponseError(
        400,
        `${IDENTIFIER_FIELD_LABELS[createRequest.field_name]} is locked for others, but you can edit it directly - no request needed.`,
      );
    }
    if (!(await hasActiveApprover(createRequest.entity_type))) {
      throw new ResponseError(400, NO_APPROVER_MESSAGE);
    }
    if (createRequest.new_value === snapshot.currentValue) {
      throw new ResponseError(400, "The new value is the same as the current one");
    }

    const existingPending = await prismaClient.identifierChangeRequest.findFirst({
      where: {
        entity_type: createRequest.entity_type,
        entity_id: createRequest.entity_id,
        field_name: createRequest.field_name,
        status: IdentifierChangeRequestStatus.PENDING,
      },
    });
    if (existingPending) {
      throw new ResponseError(
        400,
        "There is already a pending change request for this field. Cancel it or wait for a decision first.",
      );
    }

    const createdId = await prismaClient.$transaction(async (tx) => {
      const created = await tx.identifierChangeRequest.create({
        data: {
          entity_type: createRequest.entity_type,
          entity_id: createRequest.entity_id,
          field_name: createRequest.field_name,
          old_value: snapshot.currentValue,
          new_value: createRequest.new_value,
          reason: createRequest.reason,
          requested_by: admin.id,
        },
      });
      // Values stay out of the audit row, they're PII.
      await AuditService.record(
        {
          action: AuditAction.REQUEST_IDENTIFIER_CHANGE,
          source: AuditSource.UI,
          entity_type: "IdentifierChangeRequest",
          entity_id: created.id,
          admin_id: admin.id,
          new_values: {
            target_entity_type: created.entity_type,
            target_entity_id: created.entity_id,
            field_name: created.field_name,
            reason: created.reason,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return created.id;
    });

    const created = await prismaClient.identifierChangeRequest.findUniqueOrThrow({
      where: { id: createdId },
      include: REQUEST_INCLUDE,
    });
    return toIdentifierChangeRequestResponse(created, {
      entityName: snapshot.entityName,
      masked: false,
      canDecide: false,
      canCancel: true,
    });
  }

  static async approve(
    admin: AdminUser,
    request: DecideIdentifierChangeRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<IdentifierChangeRequestResponse> {
    const approveRequest = Validation.validate(IdentifierChangeRequestValidation.APPROVE, request);
    const pending = await findPendingOrThrow(approveRequest.id);
    await assertCanDecide(admin, pending.requested_by, pending.entity_type);

    // Claim first so two approvers can't both apply it.
    const claimed = await prismaClient.identifierChangeRequest.updateMany({
      where: { id: pending.id, status: IdentifierChangeRequestStatus.PENDING },
      data: {
        status: IdentifierChangeRequestStatus.APPROVED,
        decided_by: admin.id,
        decided_at: now,
        decision_note: approveRequest.decision_note ?? null,
      },
    });
    if (claimed.count === 0) {
      throw new ResponseError(400, "This request has already been decided or cancelled");
    }

    try {
      if (pending.entity_type === "DisciplinaryAction") {
        await DisciplinaryChangeRequestService.apply(admin, pending, context, now);
      } else {
        const entityType = pending.entity_type as IdentifierChangeEntityType;
        const snapshot = await loadLockedField(entityType, pending.entity_id, pending.field_name, now);
        if (snapshot.currentValue !== pending.old_value) {
          throw new ResponseError(
            409,
            "This field changed after the request was made. Reject it and ask for a new request.",
          );
        }

        const patch = { id: pending.entity_id, [pending.field_name]: pending.new_value };
        if (entityType === "Employee") {
          await EmployeeService.update(admin, patch, context, now, true);
        } else {
          await StudentService.update(admin, patch, context, now, true);
        }
      }
    } catch (error) {
      await prismaClient.identifierChangeRequest.update({
        where: { id: pending.id },
        data: {
          status: IdentifierChangeRequestStatus.PENDING,
          decided_by: null,
          decided_at: null,
          decision_note: null,
        },
      });
      throw error;
    }

    await AuditService.record({
      action: AuditAction.APPROVE_IDENTIFIER_CHANGE_REQUEST,
      source: AuditSource.UI,
      entity_type: "IdentifierChangeRequest",
      entity_id: pending.id,
      admin_id: admin.id,
      new_values: {
        target_entity_type: pending.entity_type,
        target_entity_id: pending.entity_id,
        field_name: pending.field_name,
        requested_by: pending.requested_by,
        decision_note: approveRequest.decision_note ?? null,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return this.load(admin, pending.id);
  }

  static async reject(
    admin: AdminUser,
    request: DecideIdentifierChangeRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<IdentifierChangeRequestResponse> {
    const rejectRequest = Validation.validate(IdentifierChangeRequestValidation.REJECT, request);
    const pending = await findPendingOrThrow(rejectRequest.id);
    await assertCanDecide(admin, pending.requested_by, pending.entity_type);

    await prismaClient.$transaction(async (tx) => {
      const updated = await tx.identifierChangeRequest.updateMany({
        where: { id: pending.id, status: IdentifierChangeRequestStatus.PENDING },
        data: {
          status: IdentifierChangeRequestStatus.REJECTED,
          decided_by: admin.id,
          decided_at: now,
          decision_note: rejectRequest.decision_note,
        },
      });
      if (updated.count === 0) {
        throw new ResponseError(400, "This request has already been decided or cancelled");
      }
      await AuditService.record(
        {
          action: AuditAction.REJECT_IDENTIFIER_CHANGE_REQUEST,
          source: AuditSource.UI,
          entity_type: "IdentifierChangeRequest",
          entity_id: pending.id,
          admin_id: admin.id,
          new_values: {
            target_entity_type: pending.entity_type,
            target_entity_id: pending.entity_id,
            field_name: pending.field_name,
            requested_by: pending.requested_by,
            decision_note: rejectRequest.decision_note ?? null,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });
    await DisciplinaryChangeRequestService.discard(pending);

    return this.load(admin, pending.id);
  }

  static async cancel(
    admin: AdminUser,
    id: string,
    now: Date = new Date(),
  ): Promise<IdentifierChangeRequestResponse> {
    const pending = await findPendingOrThrow(id);
    if (pending.requested_by !== admin.id) {
      throw new ResponseError(403, "Only the requester can cancel this request");
    }
    const updated = await prismaClient.identifierChangeRequest.updateMany({
      where: { id, status: IdentifierChangeRequestStatus.PENDING },
      data: { status: IdentifierChangeRequestStatus.CANCELLED, decided_at: now },
    });
    if (updated.count === 0) {
      throw new ResponseError(400, "This request has already been decided or cancelled");
    }
    await DisciplinaryChangeRequestService.discard(pending);
    return this.load(admin, id);
  }

  // Lets the UI warn before anyone files a request nobody can review.
  static async approverStatus(): Promise<{ employee: boolean; student: boolean }> {
    const [employee, student] = await Promise.all([
      hasActiveApprover("Employee"),
      hasActiveApprover("Student"),
    ]);
    return { employee, student };
  }

  static async get(admin: AdminUser, id: string): Promise<IdentifierChangeRequestResponse> {
    assertCanReview(admin);
    return this.load(admin, id);
  }

  // Also used after create/cancel, where the requester sees their own row.
  private static async load(admin: AdminUser, id: string): Promise<IdentifierChangeRequestResponse> {
    const record = await prismaClient.identifierChangeRequest.findUnique({
      where: { id },
      include: REQUEST_INCLUDE,
    });
    if (!record || (!canApprove(admin) && record.requested_by !== admin.id)) {
      throw new ResponseError(404, "Change request not found");
    }
    const names = await entityNames([record]);
    return this.toResponse(admin, record, names, await canApproveEntity(admin, "Employee"));
  }

  static async list(
    admin: AdminUser,
    request: ListIdentifierChangeRequests,
  ): Promise<IdentifierChangeRequestListResponse> {
    const listRequest = Validation.validate(IdentifierChangeRequestValidation.LIST, request);
    assertCanReview(admin);
    const employeeApprover = await canApproveEntity(admin, "Employee");
    const where = {
      status: listRequest.history
        ? { not: IdentifierChangeRequestStatus.PENDING }
        : listRequest.status,
      entity_type: listRequest.entity_type,
      entity_id: listRequest.entity_id,
    };
    const page = listRequest.page ?? 1;
    const size = listRequest.size ?? 10;
    const skip = (page - 1) * size;
    const paged = await paginate(page, size, {
      count: () => prismaClient.identifierChangeRequest.count({ where }),
      findMany: async () => {
        const records = await prismaClient.identifierChangeRequest.findMany({
          where,
          include: REQUEST_INCLUDE,
          orderBy: [{ requested_at: "desc" }, { id: "desc" }],
          skip,
          take: size,
        });
        const names = await entityNames(records);
        return records.map((record) =>
          this.toResponse(admin, record, names, employeeApprover),
        );
      },
    });

    // What the sidebar badge counts: pending requests this admin may decide.
    const decidableTypes = [
      ...(canApprove(admin) ? ["Student"] : []),
      ...(employeeApprover ? ["Employee", "DisciplinaryAction"] : []),
    ];
    const pendingDecidableCount = decidableTypes.length
      ? await prismaClient.identifierChangeRequest.count({
          where: {
            status: IdentifierChangeRequestStatus.PENDING,
            entity_type: { in: decidableTypes },
            requested_by: { not: admin.id },
          },
        })
      : 0;
    return {
      ...paged,
      can_approve: true,
      pending_decidable_count: pendingDecidableCount,
    };
  }

  // The requester's own requests, for any non-Viewer admin.
  static async listMine(
    admin: AdminUser,
    request: ListMyIdentifierChangeRequests,
  ): Promise<MyIdentifierChangeRequestListResponse> {
    if (admin.role === AdminRole.VIEWER) {
      throw new ResponseError(403, "Forbidden: Viewer cannot file change requests");
    }
    const listRequest = Validation.validate(IdentifierChangeRequestValidation.LIST_MINE, request);
    const page = listRequest.page ?? 1;
    const size = listRequest.size ?? 10;
    const where = {
      requested_by: admin.id,
      entity_type: listRequest.entity_type,
      entity_id: listRequest.entity_id,
    };
    const paged = await paginate(page, size, {
      count: () => prismaClient.identifierChangeRequest.count({ where }),
      findMany: async () => {
        const records = await prismaClient.identifierChangeRequest.findMany({
          where,
          include: REQUEST_INCLUDE,
          orderBy: [{ requested_at: "desc" }, { id: "desc" }],
          skip: (page - 1) * size,
          take: size,
        });
        const names = await entityNames(records);
        return records.map((record) => this.toResponse(admin, record, names, false));
      },
    });
    const unseenDecidedCount = await prismaClient.identifierChangeRequest.count({
      where: {
        requested_by: admin.id,
        status: { in: [IdentifierChangeRequestStatus.APPROVED, IdentifierChangeRequestStatus.REJECTED] },
        requester_seen_at: null,
      },
    });
    return { ...paged, unseen_decided_count: unseenDecidedCount };
  }

  // Called when the requester opens their list: the decisions count as read.
  static async markMineSeen(admin: AdminUser, now: Date = new Date()): Promise<number> {
    if (admin.role === AdminRole.VIEWER) {
      throw new ResponseError(403, "Forbidden: Viewer cannot file change requests");
    }
    const updated = await prismaClient.identifierChangeRequest.updateMany({
      where: {
        requested_by: admin.id,
        status: { in: [IdentifierChangeRequestStatus.APPROVED, IdentifierChangeRequestStatus.REJECTED] },
        requester_seen_at: null,
      },
      data: { requester_seen_at: now },
    });
    return updated.count;
  }

  private static toResponse(
    admin: AdminUser,
    record: Parameters<typeof toIdentifierChangeRequestResponse>[0],
    names: Map<string, string>,
    employeeApprover: boolean,
  ): IdentifierChangeRequestResponse {
    const isPending = record.status === IdentifierChangeRequestStatus.PENDING;
    const headOfCareType =
      record.entity_type === "Employee" || record.entity_type === "DisciplinaryAction";
    const masked =
      (record.entity_type === "Employee" && !canSeeEmployeePii(admin)) ||
      (record.entity_type === "DisciplinaryAction" && !canViewEmployeeDisciplinaryData(admin));
    // Attachment rows carry the file id in new_value, the name is old_value.
    const shown =
      record.entity_type === "DisciplinaryAction" && record.field_name.startsWith("attachment_")
        ? { ...record, new_value: "" }
        : record;
    return toIdentifierChangeRequestResponse(shown, {
      entityName: names.get(`${record.entity_type}:${record.entity_id}`) ?? null,
      masked,
      canDecide:
        isPending &&
        (headOfCareType ? employeeApprover : canApprove(admin)) &&
        record.requested_by !== admin.id,
      canCancel: isPending && record.requested_by === admin.id,
    });
  }
}
