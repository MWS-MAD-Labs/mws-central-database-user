import {
  AdminRole,
  AuditAction,
  AuditSource,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toWorkingDayResponse,
  type CreateWorkingDayRequest,
  type DeleteWorkingDayRequest,
  type WorkingDayResponse,
} from "../model/working-day-model";
import { AuditService } from "./audit-service";
import { toWibMidnightIfSaturday } from "../utils/office-hours";
import { WorkingDayValidation } from "../validation/working-day-validation";
import { Validation } from "../validation/validation";

export class WorkingDayService {
  static async create(
    admin: AdminUser,
    request: CreateWorkingDayRequest,
    context: AuditRequestContext = {},
  ): Promise<WorkingDayResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can designate working Saturdays",
      );
    }

    const createRequest = Validation.validate(
      WorkingDayValidation.CREATE,
      request,
    );

    const wibMidnight = toWibMidnightIfSaturday(new Date(createRequest.date));
    if (!wibMidnight) {
      throw new ResponseError(
        400,
        "Date must fall on a Saturday — Mon-Fri are already working days and Sunday is always off",
      );
    }

    const existing = await prismaClient.workingDayOverride.findUnique({
      where: { date: wibMidnight },
    });
    if (existing) {
      throw new ResponseError(
        400,
        "This Saturday is already designated a working day",
      );
    }

    const workingDay = await prismaClient.$transaction(async (tx) => {
      const newWorkingDay = await tx.workingDayOverride.create({
        data: { date: wibMidnight, reason: createRequest.reason },
      });

      await AuditService.record(
        {
          action: AuditAction.CREATE_MASTER_DATA,
          source: AuditSource.UI,
          entity_type: "WorkingDayOverride",
          entity_id: newWorkingDay.id,
          admin_id: admin.id,
          new_values: {
            date: newWorkingDay.date.toISOString(),
            reason: newWorkingDay.reason,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return newWorkingDay;
    });

    return toWorkingDayResponse(workingDay);
  }

  static async list(admin: AdminUser): Promise<WorkingDayResponse[]> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can view working Saturdays",
      );
    }

    const workingDays = await prismaClient.workingDayOverride.findMany({
      orderBy: { date: "asc" },
    });

    return workingDays.map(toWorkingDayResponse);
  }

  static async remove(
    admin: AdminUser,
    request: DeleteWorkingDayRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can remove a working Saturday",
      );
    }

    const deleteRequest = Validation.validate(
      WorkingDayValidation.DELETE,
      request,
    );

    const existing = await prismaClient.workingDayOverride.findUnique({
      where: { id: deleteRequest.id },
    });
    if (!existing) {
      throw new ResponseError(404, "Working day not found");
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.workingDayOverride.delete({
        where: { id: deleteRequest.id },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_MASTER_DATA,
          source: AuditSource.UI,
          entity_type: "WorkingDayOverride",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: {
            date: existing.date.toISOString(),
            reason: existing.reason,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    return true;
  }
}
