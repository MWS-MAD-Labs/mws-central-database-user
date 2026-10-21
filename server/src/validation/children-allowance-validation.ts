import { z } from "zod";
import { MAX_CHILDREN } from "../utils/employee-children-rules";

export class ChildrenAllowanceValidation {
  static readonly UPDATE = z
    .object({
      max_children: z
        .number({ message: "Maximum children must be a whole number" })
        .int("Maximum children must be a whole number")
        .min(1, "Maximum children must be at least 1")
        .max(MAX_CHILDREN, `Maximum children can be at most ${MAX_CHILDREN}`)
        .nullable(),
      age_limit: z
        .number({ message: "Age limit must be a whole number" })
        .int("Age limit must be a whole number")
        .min(1, "Age limit must be at least 1")
        .max(60, "Age limit can be at most 60"),
      count_biological: z.boolean(),
      count_adopted: z.boolean(),
      count_step: z.boolean(),
    })
    .refine((rule) => rule.count_biological || rule.count_adopted || rule.count_step, {
      message: "Pick at least one kind of child",
      path: ["count_biological"],
    });
}
