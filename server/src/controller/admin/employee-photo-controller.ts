import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import { EmployeePhotoService } from "../../service/employee-photo-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";
import type {
  BulkCommitEmployeePhotoMapping,
  BulkPreviewEmployeePhotoRequest,
} from "../../model/employee-photo-model";

export class EmployeePhotoController {
  static async upload(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");

    if (!employeeId) {
      throw new ResponseError(400, "Employee ID is required in parameter");
    }

    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      throw new ResponseError(400, "A file is required under the 'file' field");
    }

    const response = await EmployeePhotoService.upload(
      admin,
      { employee_id: employeeId },
      file,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");

    if (!employeeId) {
      throw new ResponseError(400, "Employee ID is required in parameter");
    }

    const response = await EmployeePhotoService.remove(
      admin,
      { employee_id: employeeId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async bulkPreview(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const body = (await c.req.json()) as BulkPreviewEmployeePhotoRequest;

    const response = await EmployeePhotoService.bulkPreview(
      admin,
      body,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async bulkCommit(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const body = await c.req.parseBody({ all: true });
    const mappingRaw = body["mappings"];
    if (typeof mappingRaw !== "string") {
      throw new ResponseError(
        400,
        "A 'mappings' field (JSON array) is required",
      );
    }

    let mappings: BulkCommitEmployeePhotoMapping[];
    try {
      mappings = JSON.parse(mappingRaw);
    } catch {
      throw new ResponseError(400, "'mappings' must be valid JSON");
    }

    const filesRaw = body["files"];
    const fileList = Array.isArray(filesRaw)
      ? filesRaw
      : filesRaw
        ? [filesRaw]
        : [];
    const files = new Map<string, File>();
    for (const entry of fileList) {
      if (entry instanceof File) {
        files.set(entry.name, entry);
      }
    }

    const response = await EmployeePhotoService.bulkCommit(
      admin,
      { mappings },
      files,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }
}
