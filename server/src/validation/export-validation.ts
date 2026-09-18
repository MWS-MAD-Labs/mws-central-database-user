import { z } from "zod";
import { EmployeeValidation } from "./employee-validation";
import { StudentValidation } from "./student-validation";

const FORMAT = z.enum(["csv", "xlsx"], {
  message: "format must be either csv or xlsx",
});
const EXPORT_MODE = z.enum(["standard", "sensitive"]).default("standard");

export class ExportValidation {
  static readonly STUDENT = StudentValidation.SEARCH.omit({
    page: true,
    size: true,
    }).extend({ format: FORMAT, export_mode: EXPORT_MODE, roster_academic_year_id: z.string().optional() });

  static readonly EMPLOYEE = EmployeeValidation.SEARCH.omit({
    page: true,
    size: true,
  }).extend({ format: FORMAT, export_mode: EXPORT_MODE });
}
