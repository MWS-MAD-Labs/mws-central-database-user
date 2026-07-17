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
  start_date?: string;
  end_date?: string;
  status?: AcademicYearStatus;
};

export type UpdateAcademicYearRequest = {
  id: string;
  name?: string;
  start_date?: string;
  end_date?: string;
  status?: AcademicYearStatus;
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
  start_date: string | null;
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
    start_date: year.start_date ? year.start_date.toISOString() : null,
    end_date: year.end_date ? year.end_date.toISOString() : null,
    status: year.status,
    created_at: year.created_at.toISOString(),
  };
}
