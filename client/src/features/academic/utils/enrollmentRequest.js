// The body of a bulk enrollment. When an SE teacher is going to be given to the students, the server is told, so it
// checks the whole group first and enrolls no one if a student cannot get one.
export function bulkEnrollmentRequest(studentIds, payload, supportTarget) {
  return {
    student_ids: studentIds,
    ...payload,
    ...(supportTarget ? { requires_special_education: true } : {}),
  };
}
