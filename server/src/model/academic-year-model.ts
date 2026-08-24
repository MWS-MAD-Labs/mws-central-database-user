import type { AcademicYear, AcademicYearStatus } from "../generated/prisma/client";

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
};

export type GetUnresolvedEnrollmentCountRequest = {
  id: string;
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
