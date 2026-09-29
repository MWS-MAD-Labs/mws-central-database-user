import type { AcademicYear, AcademicYearStatus } from "../generated/prisma/client";
import type { BulkActionResponse } from "./bulk-action-model";

export const ACADEMIC_YEAR_SORT_FIELDS = [
  "name",
  "start_date",
  "end_date",
  "status",
  "created_at",
] as const;

export type AcademicYearSortField = (typeof ACADEMIC_YEAR_SORT_FIELDS)[number];

export type CreateAcademicYearRequest = {
  name: string;
  start_date: string;
  end_date?: string;
  status?: AcademicYearStatus;
};

// Creates July-June years and derives status from their dates.
export type BulkCreateAcademicYearRequest = {
  start_year: number;
  end_year: number;
};

export type BulkCreateAcademicYearResponse =
  BulkActionResponse<AcademicYearResponse>;

export type UpdateAcademicYearRequest = {
  id: string;
  name?: string;
  start_date?: string;
  end_date?: string;
  status?: AcademicYearStatus;
  // Class activation is opt-in.
  activate_classes?: boolean;
  // Confirms ending active enrollments and teacher assignments.
  confirm_unresolved_enrollments?: boolean;
  // Confirms that existing enrollment dates may fall outside the new range.
  confirm_date_range_change?: boolean;
};

export type GetUnresolvedEnrollmentCountRequest = {
  id: string;
};

export type GetOutOfRangeEnrollmentCountRequest = {
  id: string;
  start_date?: string;
  end_date?: string;
};

export type OutOfRangeEnrollmentCountResponse = {
  count: number;
};

export type UnresolvedEnrollmentClassEntry = {
  class_id: string;
  class_name: string;
  grade_name: string;
  active_student_count: number;
  active_teacher_assignment_count: number;
};

export type UnresolvedEnrollmentCountResponse = {
  active_enrollment_count: number;
  active_teacher_assignment_count: number;
  class_count: number;
  classes: UnresolvedEnrollmentClassEntry[];
};

export type GetAcademicYearRequest = {
  id: string;
};

export type DeleteAcademicYearRequest = {
  id: string;
};

export type SearchAcademicYearRequest = {
  page: number;
  size: number;
  search?: string;
  status?: AcademicYearStatus;
  sort_by?: AcademicYearSortField;
  sort_order?: "asc" | "desc";
};

export type AcademicYearResponse = {
  id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  status: AcademicYearStatus;
  // Any class, enrollment, or student who joined this year blocks deletion.
  has_dependents: boolean;
  created_at: string;
};

export function toAcademicYearResponse(
  year: AcademicYear,
  hasDependents = false,
): AcademicYearResponse {
  return {
    id: year.id,
    name: year.name,
    start_date: year.start_date.toISOString(),
    end_date: year.end_date ? year.end_date.toISOString() : null,
    status: year.status,
    has_dependents: hasDependents,
    created_at: year.created_at.toISOString(),
  };
}

export function toAcademicYearAuditSnapshot(year: AcademicYear) {
  return {
    name: year.name,
    start_date: year.start_date.toISOString(),
    end_date: year.end_date ? year.end_date.toISOString() : null,
    status: year.status,
  };
}
