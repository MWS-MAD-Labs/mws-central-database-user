import {
  academicYearsApi,
  classesApi,
  gradesApi,
} from '../../academic/api/academicApi.js'

export async function loadStudentFormOptions() {
  const [grades, academicYears, classes] = await Promise.all([
    gradesApi.list({
      page: 1,
      size: 100,
      sort_by: 'level',
      sort_order: 'asc',
    }),
    academicYearsApi.list({
      page: 1,
      size: 100,
      sort_by: 'start_date',
      sort_order: 'desc',
    }),
    classesApi.list({
      page: 1,
      size: 100,
      sort_by: 'grade_level',
      sort_order: 'asc',
    }),
  ])

  return {
    grades: grades.data || [],
    academicYears: academicYears.data || [],
    classes: classes.data || [],
  }
}
