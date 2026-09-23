export type ClassListRequest = {
  page: number;
  size: number;
};

export type ClassWithRelationsForApi = {
  id: string;
  name: string;
  grade: { name: string; unit: { name: string } | null };
  additional_grades: { grade: { name: string } }[];
  academic_year: { id: string; name: string; start_date: Date; end_date: Date | null };
};

// Minimal active class data for external consumers - independent of
// whether the class has a teacher assigned yet.
export type ClassResponseForApi = {
  class_id: string;
  class_name: string;
  grade_name: string;
  additional_grade_names: string[];
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
    grade_name: klass.grade.name,
    additional_grade_names: klass.additional_grades.map(
      (entry) => entry.grade.name,
    ),
    unit_name: klass.grade.unit?.name ?? null,
    academic_year_id: klass.academic_year.id,
    academic_year: klass.academic_year.name,
    academic_year_start_date: new Date(klass.academic_year.start_date).toISOString().slice(0, 10),
    academic_year_end_date: klass.academic_year.end_date ? new Date(klass.academic_year.end_date).toISOString().slice(0, 10) : null,
  };
}
