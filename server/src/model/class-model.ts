import type {
  AcademicYear,
  Class,
  ClassStatus,
  Grade,
} from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export const CLASS_SORT_FIELDS = [
  "name",
  "status",
  "created_at",
  "grade_level",
] as const;

export type ClassSortField = (typeof CLASS_SORT_FIELDS)[number];

export type CreateClassRequest = {
  name: string;
  grade_id: string;
  academic_year_id: string;
  homeroom_teacher_id?: string;
  status?: ClassStatus;
};

export type UpdateClassRequest = {
  id: string;
  name?: string;
  grade_id?: string;
  academic_year_id?: string;
  homeroom_teacher_id?: string | null;
  status?: ClassStatus;
};

export type GetClassRequest = {
  id: string;
};

export type DeleteClassRequest = {
  id: string;
};

export type SearchClassRequest = {
  page: number;
  size: number;
  search?: string;
  grade_id?: string;
  academic_year_id?: string;
  status?: ClassStatus;
  sort_by?: ClassSortField;
  sort_order?: "asc" | "desc";
};

export type ClassWithRelations = Class & {
  grade: Grade;
  academic_year: AcademicYear;
};

export type ClassResponse = {
  id: string;
  name: string;
  grade: {
    id: string;
    name: string;
    level: number;
  };
  academic_year: {
    id: string;
    name: string;
    status: AcademicYear["status"];
  };
  homeroom_teacher_id: string | null;
  status: ClassStatus;
  created_at: string;
  updated_at: string;
};

export function toClassResponse(klass: ClassWithRelations): ClassResponse {
  return {
    id: klass.id,
    name: klass.name,
    grade: {
      id: klass.grade.id,
      name: klass.grade.name,
      level: klass.grade.level,
    },
    academic_year: {
      id: klass.academic_year.id,
      name: klass.academic_year.name,
      status: klass.academic_year.status,
    },
    homeroom_teacher_id: klass.homeroom_teacher_id,
    status: klass.status,
    created_at: klass.created_at.toISOString(),
    updated_at: klass.updated_at.toISOString(),
  };
}

export function toClassAuditSnapshot(klass: Class): AuditValue {
  return {
    name: klass.name,
    grade_id: klass.grade_id,
    academic_year_id: klass.academic_year_id,
    homeroom_teacher_id: klass.homeroom_teacher_id,
    status: klass.status,
  };
}
