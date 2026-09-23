import { z } from "zod";
import { PC_DAY_VALUES } from "./pc-activity-validation";

export class ClassPcActivityValidation {
  static readonly ASSIGN = z.object({
    class_id: z.string().min(1, "Class ID is required"),
    activity_id: z.string().min(1, "PC Activity ID is required"),
    day: z.enum(PC_DAY_VALUES, { message: "Day must be a valid format" }),
    academic_year_id: z
      .string()
      .min(1, "Academic year ID cannot be an empty string")
      .optional(),
  });

  static readonly REMOVE = z.object({
    id: z.string().min(1, "Class PC activity ID is required"),
    class_id: z.string().min(1, "Class ID is required"),
  });

  static readonly BULK_ENROLL_STUDENTS = z.object({
    class_activity_id: z.string().min(1, "Class PC activity ID is required"),
    class_id: z.string().min(1, "Class ID is required"),
    student_ids: z
      .array(z.string().min(1, "Student ID is required"))
      .min(1, "Select at least one student")
      .max(100, "Bulk enroll can process up to 100 students at once"),
  });
}
