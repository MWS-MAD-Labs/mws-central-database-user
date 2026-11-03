import { z } from "zod";

export class ApplicationLogoValidation {
  static readonly NAME = z
    .string()
    .trim()
    .min(1, "Give the logo a name")
    .max(64, "The name is too long (64 characters at most)");

  static readonly RENAME = z.object({
    id: z.string().min(1),
    name: ApplicationLogoValidation.NAME,
  });
}
