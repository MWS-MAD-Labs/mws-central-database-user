export function invalidateStudentRelation(queryClient, studentId, relation) {
  queryClient.invalidateQueries({ queryKey: ['students', studentId, relation] })
}
