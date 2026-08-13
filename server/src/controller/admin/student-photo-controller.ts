import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import { StudentPhotoService } from "../../service/student-photo-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";
import type {
  BulkCommitStudentPhotoMapping,
  BulkPreviewStudentPhotoRequest,
} from "../../model/student-photo-model";

export class StudentPhotoController {
  static async upload(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      throw new ResponseError(400, "A file is required under the 'file' field");
    }

    const response = await StudentPhotoService.upload(
      admin,
      { student_id: studentId },
      file,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const response = await StudentPhotoService.remove(
      admin,
      { student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async bulkPreview(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const body = (await c.req.json()) as BulkPreviewStudentPhotoRequest;

    const response = await StudentPhotoService.bulkPreview(
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

    let mappings: BulkCommitStudentPhotoMapping[];
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

    const response = await StudentPhotoService.bulkCommit(
      admin,
      { mappings },
      files,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }
}
