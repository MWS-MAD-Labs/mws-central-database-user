import { describe, afterEach, beforeEach, it, expect, spyOn } from "bun:test";
import {
  AdminUserTest,
  ApiClientTest,
  AuditLogTest,
  MasterDataTest,
} from "./test-utils";
import {
  AuditAction,
  AuditSource,
  type MasterUnit,
  type MasterJobPosition,
  type MasterJobLevel,
} from "../generated/prisma/client";
import type { RecordAuditLogRequest } from "../model/audit-log-model";
import { AuditLogValidation } from "../validation/audit-log-validation";
import { AuditService } from "../service/audit-service";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";

describe("AuditLogValidation.RECORD", () => {
  describe("valid combinations", () => {
    it("accepts an entity action with entity_type, entity_id, and an admin actor", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "CREATE_STUDENT",
        source: "UI",
        entity_type: "Student",
        entity_id: "student-1",
        admin_id: "admin-1",
      });
      logger.debug(result);

      expect(result.success).toBe(true);
    });

    it("accepts an entity action attributed to an API client instead of an admin", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "UPDATE_EMPLOYEE",
        source: "API",
        entity_type: "Employee",
        entity_id: "employee-1",
        api_client_id: "client-1",
      });
      logger.debug(result);

      expect(result.success).toBe(true);
    });

    it("accepts an entity action with neither an admin nor an API client actor", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "DELETE_STUDENT",
        source: "IMPORT",
        entity_type: "Student",
        entity_id: "student-2",
      });
      logger.debug(result);

      expect(result.success).toBe(true);
    });

    it("accepts an entity action from a SYSTEM source with entity fields but no actor/network info", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "DEACTIVATE_EMPLOYEE",
        source: "SYSTEM",
        entity_type: "Employee",
        entity_id: "employee-2",
      });
      logger.debug(result);

      expect(result.success).toBe(true);
    });

    it("accepts a non-entity action without entity_type/entity_id", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "LOGIN",
        source: "UI",
        admin_id: "admin-1",
        ip_address: "127.0.0.1",
        user_agent: "Mozilla/5.0 (Test Runner)",
      });
      logger.debug(result);

      expect(result.success).toBe(true);
    });

    it("accepts a SYSTEM-sourced non-entity action with nothing but action and source", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "IMPORT_DATA",
        source: "SYSTEM",
      });
      logger.debug(result);

      expect(result.success).toBe(true);
    });

    it("accepts nested old_values/new_values JSON", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "UPDATE_STUDENT",
        source: "UI",
        entity_type: "Student",
        entity_id: "student-3",
        admin_id: "admin-1",
        old_values: { status: "ACTIVE", tags: ["scholarship"] },
        new_values: {
          status: "INACTIVE",
          tags: ["scholarship", "alumni"],
          meta: { reason: "graduated", verified: true, score: 92 },
        },
      });
      logger.debug(result);

      expect(result.success).toBe(true);
    });

    it("accepts a request with old_values/new_values omitted", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "LOGOUT",
        source: "UI",
        admin_id: "admin-1",
      });
      logger.debug(result);

      expect(result.success).toBe(true);
    });
  });

  describe("action & source enum validation", () => {
    it("rejects a missing action", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        source: "UI",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
    });

    it("rejects an unknown action value", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "NOT_A_REAL_ACTION",
        source: "UI",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
    });

    it("rejects a missing source", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "LOGIN",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
    });

    it("rejects an unknown source value", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "LOGIN",
        source: "NOT_A_REAL_SOURCE",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
    });
  });

  describe("entity_type / entity_id required by action", () => {
    it("rejects an entity action missing entity_type", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "CREATE_STUDENT",
        source: "UI",
        entity_id: "student-1",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.join(".") === "entity_type"),
        ).toBe(true);
      }
    });

    it("rejects an entity action missing entity_id", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "CREATE_STUDENT",
        source: "UI",
        entity_type: "Student",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.join(".") === "entity_id"),
        ).toBe(true);
      }
    });

    it("rejects an entity action missing both entity_type and entity_id", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "CREATE_STUDENT",
        source: "UI",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBe(2);
      }
    });

    it("rejects an empty entity_id", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "CREATE_STUDENT",
        source: "UI",
        entity_type: "Student",
        entity_id: "",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
    });

    it("rejects an entity_id longer than 50 characters", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "CREATE_STUDENT",
        source: "UI",
        entity_type: "Student",
        entity_id: "s".repeat(51),
      });
      logger.debug(result);

      expect(result.success).toBe(false);
    });

    it("rejects an entity_type that is not a real model name", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "CREATE_STUDENT",
        source: "UI",
        entity_type: "NotAModel",
        entity_id: "student-1",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
    });

    it("rejects a non-entity action that sets entity_type", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "LOGIN",
        source: "UI",
        entity_type: "Student",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.join(".") === "entity_type"),
        ).toBe(true);
      }
    });

    it("rejects a non-entity action that sets entity_id", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "LOGIN",
        source: "UI",
        entity_id: "student-1",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.join(".") === "entity_id"),
        ).toBe(true);
      }
    });
  });

  describe("actor & network fields by source", () => {
    it("rejects a SYSTEM-sourced entry with an admin_id", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "IMPORT_DATA",
        source: "SYSTEM",
        admin_id: "admin-1",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
    });

    it("rejects a SYSTEM-sourced entry with an api_client_id", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "IMPORT_DATA",
        source: "SYSTEM",
        api_client_id: "client-1",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
    });

    it("rejects a SYSTEM-sourced entry with an ip_address", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "IMPORT_DATA",
        source: "SYSTEM",
        ip_address: "127.0.0.1",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
    });

    it("rejects a SYSTEM-sourced entry with a user_agent", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "IMPORT_DATA",
        source: "SYSTEM",
        user_agent: "Mozilla/5.0 (Test Runner)",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
    });

    it("reports two issues when a SYSTEM entry sets both an actor and network info", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "LOGIN",
        source: "SYSTEM",
        admin_id: "admin-1",
        ip_address: "127.0.0.1",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBe(2);
        expect(
          result.error.issues.every((i) => i.path.join(".") === "source"),
        ).toBe(true);
      }
    });

    it("rejects an entry attributed to both an admin and an API client", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "LOGIN",
        source: "API",
        admin_id: "admin-1",
        api_client_id: "client-1",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.join(".") === "admin_id"),
        ).toBe(true);
      }
    });
  });

  describe("field format validation", () => {
    it("rejects an empty admin_id", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "LOGIN",
        source: "UI",
        admin_id: "",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
    });

    it("rejects an api_client_id longer than 50 characters", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "LOGIN",
        source: "API",
        api_client_id: "c".repeat(51),
      });
      logger.debug(result);

      expect(result.success).toBe(false);
    });

    it("rejects a malformed ip_address", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "LOGIN",
        source: "UI",
        ip_address: "not-an-ip",
      });
      logger.debug(result);

      expect(result.success).toBe(false);
    });

    it("rejects a user_agent longer than 512 characters", () => {
      const result = AuditLogValidation.RECORD.safeParse({
        action: "LOGIN",
        source: "UI",
        user_agent: "a".repeat(513),
      });
      logger.debug(result);

      expect(result.success).toBe(false);
    });
  });
});

describe("AuditService.record", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await ApiClientTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await ApiClientTest.delete();
    await MasterDataTest.delete();
  });

  it("persists an entity action attributed to an admin, including old/new JSON values, ip, and user agent", async () => {
    await AdminUserTest.createSuperAdmin(masterData.unit.id);
    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });

    const request: RecordAuditLogRequest = {
      action: AuditAction.UPDATE_EMPLOYEE,
      source: AuditSource.UI,
      entity_type: "Employee",
      entity_id: "employee-1",
      admin_id: admin.id,
      old_values: { status: "ACTIVE", tags: ["staff"] },
      new_values: {
        status: "INACTIVE",
        tags: ["staff", "alumni"],
        meta: { reason: "resigned", verified: true },
      },
      ip_address: "203.0.113.10",
      user_agent: "Mozilla/5.0 (Test Runner)",
    };

    await AuditService.record(request);

    const created = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: "employee-1" },
    });
    logger.debug(created);

    expect(created.action).toBe(AuditAction.UPDATE_EMPLOYEE);
    expect(created.source).toBe(AuditSource.UI);
    expect(created.entity_type).toBe("Employee");
    expect(created.admin_id).toBe(admin.id);
    expect(created.api_client_id).toBeNull();
    expect(created.old_values).toEqual({ status: "ACTIVE", tags: ["staff"] });
    expect(created.new_values).toEqual({
      status: "INACTIVE",
      tags: ["staff", "alumni"],
      meta: { reason: "resigned", verified: true },
    });
    expect(created.ip_address).toBe("203.0.113.10");
    expect(created.user_agent).toBe("Mozilla/5.0 (Test Runner)");
  });

  it("persists a SYSTEM-sourced entry with null actor and network fields", async () => {
    const request: RecordAuditLogRequest = {
      action: AuditAction.IMPORT_DATA,
      source: AuditSource.SYSTEM,
    };

    await AuditService.record(request);

    const created = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.IMPORT_DATA },
    });
    logger.debug(created);

    expect(created.source).toBe(AuditSource.SYSTEM);
    expect(created.entity_type).toBeNull();
    expect(created.entity_id).toBeNull();
    expect(created.admin_id).toBeNull();
    expect(created.api_client_id).toBeNull();
    expect(created.ip_address).toBeNull();
    expect(created.user_agent).toBeNull();
  });

  it("persists an entity action attributed to an API client", async () => {
    const apiClient = await ApiClientTest.create();

    const request: RecordAuditLogRequest = {
      action: AuditAction.DOWNLOAD_ATTACHMENT,
      source: AuditSource.API,
      entity_type: "ConsentAttachment",
      entity_id: "attachment-1",
      api_client_id: apiClient.id,
    };

    await AuditService.record(request);

    const created = await prismaClient.auditLog.findFirstOrThrow({
      where: { entity_id: "attachment-1" },
    });
    logger.debug(created);

    expect(created.api_client_id).toBe(apiClient.id);
    expect(created.admin_id).toBeNull();
  });

  it("defaults old_values and new_values to JSON null when omitted", async () => {
    const request: RecordAuditLogRequest = {
      action: AuditAction.LOGIN,
      source: AuditSource.UI,
    };

    await AuditService.record(request);

    const created = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.LOGIN },
    });
    logger.debug(created);

    expect(created.old_values).toBeNull();
    expect(created.new_values).toBeNull();
  });

  it("rejects invalid input before touching the database", async () => {
    const invalidRequest = {
      action: AuditAction.CREATE_STUDENT,
      source: AuditSource.UI,
      entity_type: "Student",
    } as unknown as RecordAuditLogRequest;

    await expect(AuditService.record(invalidRequest)).rejects.toThrow();

    const rowCount = await prismaClient.auditLog.count();
    expect(rowCount).toBe(0);
  });

  it("swallows a foreign-key violation outside a transaction, logs it, and writes no row", async () => {
    const errorSpy = spyOn(logger, "error");

    const request: RecordAuditLogRequest = {
      action: AuditAction.UPDATE_STUDENT,
      source: AuditSource.UI,
      entity_type: "Student",
      entity_id: "student-fk-test",
      admin_id: "admin-does-not-exist",
    };

    await AuditService.record(request);

    const loggedOurFailure = errorSpy.mock.calls.some(
      (call) => String(call[0]) === "Failed to write audit log",
    );
    expect(loggedOurFailure).toBe(true);

    const rowCount = await prismaClient.auditLog.count({
      where: { entity_id: "student-fk-test" },
    });
    expect(rowCount).toBe(0);

    errorSpy.mockRestore();
  });

  it("rethrows a foreign-key violation inside a transaction so the caller can roll back", async () => {
    const request: RecordAuditLogRequest = {
      action: AuditAction.DELETE_STUDENT,
      source: AuditSource.UI,
      entity_type: "Student",
      entity_id: "student-fk-tx-test",
      admin_id: "admin-does-not-exist",
    };

    await expect(
      prismaClient.$transaction(async (tx) => {
        await AuditService.record(request, tx);
      }),
    ).rejects.toThrow();

    const rowCount = await prismaClient.auditLog.count({
      where: { entity_id: "student-fk-tx-test" },
    });
    expect(rowCount).toBe(0);
  });
});
