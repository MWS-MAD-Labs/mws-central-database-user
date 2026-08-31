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

// Generates one academic year per start year in [start_year, end_year] - e.g.
// start_year: 2020, end_year: 2025 creates "2020/2021" through "2025/2026"
// (6 years). Requires at least 2 years (end_year > start_year) - a single
// year belongs in the plain create() above instead. Each one gets July 1
// (year) - June 30 (year + 1), the same convention already used by every
// dev seed script in this repo, and a status resolved automatically:
// COMPLETED if it's already ended, UPCOMING if it hasn't started yet
// (however far in the future - there's no "too far" rejection outside of
// ACTIVE), ACTIVE only for the one year that actually contains today - and
// only when nothing else in the system already holds ACTIVE (see
// AcademicYearService.bulkCreate).
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
  // Opt-in only - activating a year never auto-activates its classes on its
  // own (a class may be deliberately INACTIVE for reasons unrelated to the
  // year, e.g. merged/disbanded). Set this to also bulk-activate every
  // currently-INACTIVE class in the year in the same request.
  activate_classes?: boolean;
  // Required when moving an ACTIVE year to COMPLETED/UPCOMING while it
  // still has students with an active enrollment, or teachers with an
  // active assignment, in its classes - moving out of ACTIVE
  // cascade-deactivates those classes and ends those teacher assignments
  // (see update() below), which would otherwise silently strand students
  // and leave assignments open-ended with no warning.
  confirm_unresolved_enrollments?: boolean;
  // Required when editing start_date/end_date would leave one or more of
  // this year's existing enrollments (any status - close()/promote()
  // snapshot dates that don't move once set, not just active ones) dated
  // outside the new range. Nothing about those rows changes automatically -
  // this only unblocks the save; see
  // AcademicYearService.getOutOfRangeEnrollmentCount for the same count the
  // UI previews before asking for this.
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

// Lets the UI warn with a real number before an ACTIVE -> COMPLETED/UPCOMING
// move, instead of the admin finding out after the fact that students got
// left behind in a now-INACTIVE class, or that teacher assignments got
// silently ended.
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
  created_at: string;
};

export function toAcademicYearResponse(
  year: AcademicYear,
): AcademicYearResponse {
  return {
    id: year.id,
    name: year.name,
    start_date: year.start_date.toISOString(),
    end_date: year.end_date ? year.end_date.toISOString() : null,
    status: year.status,
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
