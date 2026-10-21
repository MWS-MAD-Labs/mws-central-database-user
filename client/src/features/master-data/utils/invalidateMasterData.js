const EXTRA_INVALIDATIONS = {
  'pc-activities': [
    ['academic', 'pc-activities'],
    ['pc-activity-options'],
    ['pc-activity-mentor-options'],
  ],
}

export function invalidateMasterData(queryClient, resourceId) {
  queryClient.invalidateQueries({ queryKey: ['master-data', resourceId] })
  queryClient.invalidateQueries({ queryKey: ['student-form-options'] })
  queryClient.invalidateQueries({ queryKey: ['employee-form-options'] })
  for (const queryKey of EXTRA_INVALIDATIONS[resourceId] || []) {
    queryClient.invalidateQueries({ queryKey })
  }
}
