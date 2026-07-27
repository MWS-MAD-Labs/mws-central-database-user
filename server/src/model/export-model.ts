import type { ExportFormat } from "../utils/export-file";
import type { SearchEmployeeRequest } from "./employee-model";
import type { SearchStudentRequest } from "./student-model";

export type ExportStudentRequest = Omit<SearchStudentRequest, "page" | "size"> & {
  format: ExportFormat;
};

export type ExportEmployeeRequest = Omit<
  SearchEmployeeRequest,
  "page" | "size"
> & {
  format: ExportFormat;
};
