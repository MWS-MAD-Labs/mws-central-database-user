import { z } from "zod";

export class StudentPhotoValidation {
  static readonly UPLOAD = z.object({
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly DELETE = z.object({
    student_id: z.string().min(1, "Student ID is required"),
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
          student_id: z.string().min(1, "Student ID is required"),
        }),
      )
      .min(1, "Select at least one file")
      .max(300, "Bulk upload can process up to 300 files at once"),
  });
}
