import { z } from "zod";
import { LIMITS } from "../constants/limits";
import { SpecialNeedType } from "../generated/prisma/client";

const NEED_TYPE_VALUES = Object.values(SpecialNeedType) as [SpecialNeedType, ...SpecialNeedType[]];

const optionalText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} cannot be blank`).max(max, `${label} is too long`).optional();

const today = () => new Date().toISOString().slice(0, 10);
const date = (label: string) =>
  z.iso.date({ message: `${label} must be a valid date` }).refine((value) => value <= today(), `${label} cannot be in the future`).optional();

// The profile as typed in the form, without the student.
export const SpecialNeedsProfileFields = z
  .object({
    needs: z
      .array(z.object({
        need_type: z.enum(NEED_TYPE_VALUES, { message: "Need type must be a valid format" }),
        description: z.string().trim().min(1, "Need description is required").max(LIMITS.SPECIAL_NEEDS_DESCRIPTION_MAX, "Need description is too long"),
      }).strict())
      .min(1, "Choose at least one need type")
      .max(NEED_TYPE_VALUES.length)
      .refine((needs) => new Set(needs.map((need) => need.need_type)).size === needs.length, "Need types cannot repeat"),
    learning_support_summary: optionalText("Learning support summary", LIMITS.SPECIAL_NEEDS_SUMMARY_MAX),
    accommodations: optionalText("Accommodations", LIMITS.SPECIAL_NEEDS_ACCOMMODATIONS_MAX),
    has_professional_report: z.boolean().optional(),
    report_date: date("Report date"),
    identified_date: date("Identified date"),
  })
  .strict()
  .refine((data) => data.report_date === undefined || data.has_professional_report === true, {
    message: "Report date requires a professional report",
    path: ["report_date"],
  });

export class SpecialNeedsProfileValidation {
  static readonly SAVE = z.object({ student_id: z.string().min(1, "Student ID is required"), profile: SpecialNeedsProfileFields });
  static readonly ID = z.object({ student_id: z.string().min(1, "Student ID is required") });
}
