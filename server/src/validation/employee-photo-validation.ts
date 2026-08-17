import { z } from "zod";

export class EmployeePhotoValidation {
  static readonly UPLOAD = z.object({
    employee_id: z.string().min(1, "Employee ID is required"),
  });

  static readonly DELETE = z.object({
    employee_id: z.string().min(1, "Employee ID is required"),
  });

  static readonly BULK_PREVIEW = z.object({
    file_names: z
      .array(z.string().min(1))
      .min(1, "Select at least one file")
      .max(300, "Bulk preview can process up to 300 files at once"),
  });

  static readonly BULK_COMMIT = z.object({
    mappings: z
      .array(
        z.object({
          file_name: z.string().min(1, "File name is required"),
          employee_id: z.string().min(1, "Employee ID is required"),
        }),
      )
      .min(1, "Select at least one file")
      .max(300, "Bulk upload can process up to 300 files at once"),
  });
}
