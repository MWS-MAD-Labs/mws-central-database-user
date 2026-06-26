import { z } from "zod";

export class AuthValidation {
  static readonly GOOGLE_LOGIN = z.object({
    code: z.string().min(1, "Authorization code is required"),
  });
}
