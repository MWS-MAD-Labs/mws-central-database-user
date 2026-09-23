import {
  AdminRole,
  AuditAction,
  AuditSource,
  IdentifierChangeRequestStatus,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
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
} from "../model/identifier-change-request-model";
import { IdentifierChangeRequestValidation } from "../validation/identifier-change-request-validation";
import { Validation } from "../validation/validation";
import { AuditService } from "./audit-service";
import { EmployeeService } from "./employee-service";
import { StudentService } from "./student-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { isPastIdentifierGracePeriod } from "../utils/identifier-lock";
import { isChangeRequestApprover } from "../utils/change-request-approver";

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
    if (unitId !== admin.unit_id) {
      throw new ResponseError(403, "Forbidden: This record is outside your unit scope");
    }
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

function assertCanDecide(admin: AdminUser, requestedBy: string) {
  if (!canApprove(admin)) {
    throw new ResponseError(
      403,
      "Forbidden: You're not an approver for identifier change requests",
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
  const [employees, students] = await Promise.all([
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
  ]);
  return new Map([
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
    if (isChangeRequestApprover(admin)) {
      throw new ResponseError(
        400,
        `${IDENTIFIER_FIELD_LABELS[createRequest.field_name]} is locked for others, but you can edit it directly - no request needed.`,
      );
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
    assertCanDecide(admin, pending.requested_by);

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

    return this.get(admin, pending.id);
  }

  static async reject(
    admin: AdminUser,
    request: DecideIdentifierChangeRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<IdentifierChangeRequestResponse> {
    const rejectRequest = Validation.validate(IdentifierChangeRequestValidation.REJECT, request);
    const pending = await findPendingOrThrow(rejectRequest.id);
    assertCanDecide(admin, pending.requested_by);

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

    return this.get(admin, pending.id);
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
    return this.get(admin, id);
  }

  static async get(admin: AdminUser, id: string): Promise<IdentifierChangeRequestResponse> {
    const record = await prismaClient.identifierChangeRequest.findUnique({
      where: { id },
      include: REQUEST_INCLUDE,
    });
    if (!record || (!canApprove(admin) && record.requested_by !== admin.id)) {
      throw new ResponseError(404, "Change request not found");
    }
    const names = await entityNames([record]);
    return this.toResponse(admin, record, names);
  }

  static async list(
    admin: AdminUser,
    request: ListIdentifierChangeRequests,
  ): Promise<IdentifierChangeRequestListResponse> {
    const listRequest = Validation.validate(IdentifierChangeRequestValidation.LIST, request);
    const approver = canApprove(admin);
    const records = await prismaClient.identifierChangeRequest.findMany({
      where: {
        status: listRequest.status,
        entity_type: listRequest.entity_type,
        entity_id: listRequest.entity_id,
        // Non-approvers only see what they asked for.
        ...(approver ? {} : { requested_by: admin.id }),
      },
      include: REQUEST_INCLUDE,
      orderBy: { requested_at: "desc" },
      take: 200,
    });
    const names = await entityNames(records);
    return {
      data: records.map((record) => this.toResponse(admin, record, names)),
      can_approve: approver,
    };
  }

  private static toResponse(
    admin: AdminUser,
    record: Parameters<typeof toIdentifierChangeRequestResponse>[0],
    names: Map<string, string>,
  ): IdentifierChangeRequestResponse {
    const isPending = record.status === IdentifierChangeRequestStatus.PENDING;
    return toIdentifierChangeRequestResponse(record, {
      entityName: names.get(`${record.entity_type}:${record.entity_id}`) ?? null,
      masked: record.entity_type === "Employee" && !canSeeEmployeePii(admin),
      canDecide: isPending && canApprove(admin) && record.requested_by !== admin.id,
      canCancel: isPending && record.requested_by === admin.id,
    });
  }
}
