import { z } from "zod";
import { IDENTIFIER_CHANGE_ENTITY_TYPES } from "../model/identifier-change-request-model";

export class IdentifierChangeRequestValidation {
  static readonly CREATE = z.object({
    entity_type: z.enum(IDENTIFIER_CHANGE_ENTITY_TYPES, {
      message: "Entity type must be Employee or Student",
    }),
    entity_id: z.string().min(1, "Entity ID is required"),
    field_name: z.string().min(1, "Field name is required"),
    new_value: z.string().trim().min(1, "New value is required").max(50),
    reason: z.string().trim().min(5, "Reason must be at least 5 characters").max(500),
  });

  static readonly APPROVE = z.object({
    id: z.string().min(1, "Request ID is required"),
    decision_note: z.string().trim().max(500).optional(),
  });

  static readonly REJECT = z.object({
    id: z.string().min(1, "Request ID is required"),
    decision_note: z
      .string()
      .trim()
      .min(1, "A note is required when rejecting")
      .max(500),
  });

  static readonly LIST = z.object({
    status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
    entity_type: z.enum(IDENTIFIER_CHANGE_ENTITY_TYPES).optional(),
    entity_id: z.string().min(1).optional(),
  });
}
