import { AcademicYearStatus } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import type { AcademicYearWithSemestersResponse } from "../model/academic-semester-model";

const date = (value: Date) => value.toISOString().slice(0, 10);

export class AcademicYearApiService {
  // The active academic year with its semesters, like the classes the same API lists. Empty if there is none.
  static async listActive(): Promise<AcademicYearWithSemestersResponse[]> {
    const years = await prismaClient.academicYear.findMany({
      where: { status: AcademicYearStatus.ACTIVE },
      include: { semesters: { orderBy: { position: "asc" } } },
      orderBy: { start_date: "asc" },
    });
    return years.map((year) => ({
      academic_year_id: year.id,
      academic_year: year.name,
      start_date: date(year.start_date),
      end_date: year.end_date ? date(year.end_date) : null,
      semesters: year.semesters.map((semester) => ({
        semester_id: semester.id,
        name: semester.name,
        position: semester.position,
        start_date: date(semester.start_date),
        end_date: date(semester.end_date),
      })),
    }));
  }
}
