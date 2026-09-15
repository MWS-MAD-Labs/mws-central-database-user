// Other pages read some resources through their own, differently-shaped
// query key instead of ['master-data', resourceId, params] - e.g. PC
// Activities also back Academic > PC Activity Mentors (['academic',
// 'pc-activities', ...]) and the Student PC Activities panel's activity
// dropdown (['pc-activity-options']). Those keys share no common prefix
// with Master Data's own, so a save there wouldn't otherwise reach them -
// without this, the other page would keep showing what it had cached
// until a full reload.
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
