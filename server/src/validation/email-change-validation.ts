import { z } from "zod";
import { emailWithAllowedDomain } from "./validation";

export class EmailChangeValidation {
  static readonly CHANGE = z.object({
    email: emailWithAllowedDomain(),
    reason: z.string().trim().min(5, "Say why the email changes (at least 5 characters)").max(200, "The reason is too long"),
  });
}
