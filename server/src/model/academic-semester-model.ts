import type { AcademicSemester } from "../generated/prisma/client";

export type AcademicSemesterResponse = {
  id: string;
  academic_year_id: string;
  name: string;
  position: number;
  start_date: string;
  end_date: string;
  half_end_date: string;
};

export function toAcademicSemesterResponse(row: AcademicSemester): AcademicSemesterResponse {
  return {
    id: row.id,
    academic_year_id: row.academic_year_id,
    name: row.name,
    position: row.position,
    start_date: row.start_date.toISOString(),
    end_date: row.end_date.toISOString(),
    half_end_date: row.half_end_date.toISOString(),
  };
}

export function toAcademicSemesterAuditSnapshot(row: AcademicSemester) {
  return {
    academic_year_id: row.academic_year_id,
    name: row.name,
    position: row.position,
    start_date: row.start_date.toISOString(),
    end_date: row.end_date.toISOString(),
    half_end_date: row.half_end_date.toISOString(),
  };
}

// What an application reads: the active year and its parts.
export type AcademicYearWithSemestersResponse = {
  academic_year_id: string;
  academic_year: string;
  start_date: string;
  end_date: string | null;
  semesters: { semester_id: string; name: string; position: number; start_date: string; end_date: string }[];
};
