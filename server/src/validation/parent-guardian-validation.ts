import { z } from "zod";
import { ParentType } from "../generated/prisma/client";
import { indonesianPhone } from "./validation";

const PARENT_TYPE_VALUES = Object.keys(ParentType) as [
  keyof typeof ParentType,
  ...(keyof typeof ParentType)[],
];

export class ParentGuardianValidation {
  static readonly CREATE = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    type: z.enum(PARENT_TYPE_VALUES, {
      message: "Type must be a valid format",
    }),
    full_name: z
      .string()
      .min(1, "Full name is required")
      .max(50, "Full name is too long"),
    phone: indonesianPhone().optional(),
    email: z.email("Invalid email format").optional(),
    address: z.string().max(200, "Address is too long").optional(),
    is_primary: z.boolean().optional(),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "Parent/guardian ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
    type: z
      .enum(PARENT_TYPE_VALUES, {
        message: "Type must be a valid format",
      })
      .optional(),
    full_name: z
      .string()
      .min(1, "Full name is required")
      .max(50, "Full name is too long")
      .optional(),
    phone: indonesianPhone().optional(),
    email: z.email("Invalid email format").optional(),
    address: z.string().max(200, "Address is too long").optional(),
    is_primary: z.boolean().optional(),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "Parent/guardian ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly RESTORE = z.object({
    id: z.string().min(1, "Parent/guardian ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly GET_LIST = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    is_deleted: z.boolean().default(false).optional(),
  });
}
