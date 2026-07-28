import type { ExportFormat } from "../utils/export-file";
import type { SearchEmployeeRequest } from "./employee-model";
import type { SearchStudentRequest } from "./student-model";

export type ExportStudentRequest = Omit<SearchStudentRequest, "page" | "size"> & {
  format: ExportFormat;
  // Which academic year's class rosters to break out as extra xlsx sheets.
  // Falls back to the currently ACTIVE academic year when omitted.
  roster_academic_year_id?: string;
};

export type ExportEmployeeRequest = Omit<
  SearchEmployeeRequest,
  "page" | "size"
> & {
  format: ExportFormat;
};
