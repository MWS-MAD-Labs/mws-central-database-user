export function invalidateMasterData(queryClient, resourceId) {
  queryClient.invalidateQueries({ queryKey: ['master-data', resourceId] })
  queryClient.invalidateQueries({ queryKey: ['student-form-options'] })
  queryClient.invalidateQueries({ queryKey: ['employee-form-options'] })
}
