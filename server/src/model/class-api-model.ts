export type ClassListRequest = {
  page: number;
  size: number;
};

export type ClassWithRelationsForApi = {
  id: string;
  name: string;
  grade: { id: string; name: string; unit: { id: string; name: string } | null };
  additional_grades: { grade: { id: string; name: string } }[];
  academic_year: { id: string; name: string; start_date: Date; end_date: Date | null };
};

// Minimal active class data for external consumers - independent of
// whether the class has a teacher assigned yet.
export type ClassResponseForApi = {
  class_id: string;
  class_name: string;
  grade_id: string;
  grade_name: string;
  additional_grade_ids: string[];
  additional_grade_names: string[];
  unit_id: string | null;
  unit_name: string | null;
  academic_year_id: string;
  academic_year: string;
  academic_year_start_date: string;
  academic_year_end_date: string | null;
};

export function toClassResponseForApi(
  klass: ClassWithRelationsForApi,
): ClassResponseForApi {
  return {
    class_id: klass.id,
    class_name: klass.name,
    grade_id: klass.grade.id,
    grade_name: klass.grade.name,
    additional_grade_ids: klass.additional_grades.map((entry) => entry.grade.id),
    additional_grade_names: klass.additional_grades.map(
      (entry) => entry.grade.name,
    ),
    unit_id: klass.grade.unit?.id ?? null,
    unit_name: klass.grade.unit?.name ?? null,
    academic_year_id: klass.academic_year.id,
    academic_year: klass.academic_year.name,
    academic_year_start_date: new Date(klass.academic_year.start_date).toISOString().slice(0, 10),
    academic_year_end_date: klass.academic_year.end_date ? new Date(klass.academic_year.end_date).toISOString().slice(0, 10) : null,
  };
}
