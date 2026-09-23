import type { ExportFormat } from "../utils/export-file";
import type { SearchEmployeeRequest } from "./employee-model";
import type { SearchStudentRequest } from "./student-model";
import type { ClassTeacherRole } from "../generated/prisma/client";

export type ExportMode = "standard" | "sensitive";

export type ExportStudentRequest = Omit<SearchStudentRequest, "page" | "size"> & {
  format: ExportFormat;
  export_mode?: ExportMode;
  // Which academic year's class rosters to break out as extra xlsx sheets.
  // Falls back to the currently ACTIVE academic year when omitted.
  roster_academic_year_id?: string;
};

export type ExportEmployeeRequest = Omit<
  SearchEmployeeRequest,
  "page" | "size"
> & {
  format: ExportFormat;
  export_mode?: ExportMode;
};

export type WorkforceTeacherAssignmentExportRow = {
  class_name: string;
  academic_year: string;
  member_name: string;
  member_type: "EMPLOYEE" | "INTERN";
  member_id: string;
  employee_id: string | null;
  email: string;
  role: ClassTeacherRole;
  subject: string | null;
  start_date: string;
  end_date: string | null;
};
