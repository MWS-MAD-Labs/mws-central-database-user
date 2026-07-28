import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import { ImportService } from "../../service/import-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";
import type {
  ImportEmployeeFieldKey,
  ImportStudentFieldKey,
} from "../../model/import-model";
import type { SheetSelector } from "../../utils/import-file";

// A workbook's sheet can be picked by exact name or by 0-based index -
// name wins if both are given. Neither means "first sheet" (unchanged
// default behavior for single-sheet files).
function resolveSheetSelector(
  body: Record<string, string | File>,
): SheetSelector | undefined {
  const sheetName = body["sheet_name"];
  if (typeof sheetName === "string" && sheetName.length > 0) {
    return sheetName;
  }

  const sheetIndex = body["sheet_index"];
  if (typeof sheetIndex === "string" && sheetIndex.length > 0) {
    const parsed = Number(sheetIndex);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new ResponseError(
        400,
        "sheet_index must be a non-negative integer",
      );
    }
    return parsed;
  }

  return undefined;
}

export class ImportController {
  static async previewStudents(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      throw new ResponseError(400, "A file is required under the 'file' field");
    }

    let mapping: Partial<Record<string, ImportStudentFieldKey>> | undefined;
    const mappingField = body["mapping"];
    if (typeof mappingField === "string" && mappingField.length > 0) {
      try {
        mapping = JSON.parse(mappingField);
      } catch {
        throw new ResponseError(400, "mapping must be valid JSON");
      }
    }

    const response = await ImportService.previewStudents(
      admin,
      file,
      mapping,
      resolveSheetSelector(body),
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async commitStudents(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const jobId = c.req.param("jobId");
    if (!jobId) {
      throw new ResponseError(400, "Import job ID is required in parameter");
    }

    const response = await ImportService.commitStudents(
      admin,
      jobId,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async getJob(c: Context<{ Variables: AdminVariables }>) {
    const jobId = c.req.param("jobId");
    if (!jobId) {
      throw new ResponseError(400, "Import job ID is required in parameter");
    }

    const response = await ImportService.getJob(jobId);

    return c.json({ data: response });
  }

  static async rollbackStudents(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const jobId = c.req.param("jobId");
    if (!jobId) {
      throw new ResponseError(400, "Import job ID is required in parameter");
    }

    const response = await ImportService.rollbackStudents(
      admin,
      jobId,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async cleanup(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const daysQuery = c.req.query("days");
    const days = daysQuery ? Number(daysQuery) : 7;
    if (!Number.isFinite(days) || days < 0) {
      throw new ResponseError(400, "days must be a non-negative number");
    }

    const response = await ImportService.cleanupJobs(
      admin,
      days,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async previewEmployees(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      throw new ResponseError(400, "A file is required under the 'file' field");
    }

    let mapping: Partial<Record<string, ImportEmployeeFieldKey>> | undefined;
    const mappingField = body["mapping"];
    if (typeof mappingField === "string" && mappingField.length > 0) {
      try {
        mapping = JSON.parse(mappingField);
      } catch {
        throw new ResponseError(400, "mapping must be valid JSON");
      }
    }

    const response = await ImportService.previewEmployees(
      admin,
      file,
      mapping,
      resolveSheetSelector(body),
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async commitEmployees(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const jobId = c.req.param("jobId");
    if (!jobId) {
      throw new ResponseError(400, "Import job ID is required in parameter");
    }

    const response = await ImportService.commitEmployees(
      admin,
      jobId,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async rollbackEmployees(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const jobId = c.req.param("jobId");
    if (!jobId) {
      throw new ResponseError(400, "Import job ID is required in parameter");
    }

    const response = await ImportService.rollbackEmployees(
      admin,
      jobId,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async getEmployeeJob(c: Context<{ Variables: AdminVariables }>) {
    const jobId = c.req.param("jobId");
    if (!jobId) {
      throw new ResponseError(400, "Import job ID is required in parameter");
    }

    const response = await ImportService.getEmployeeJob(jobId);

    return c.json({ data: response });
  }
}
