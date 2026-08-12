import { apiRequest } from '../../../lib/api.js'

export const dashboardApi = {
  async summary() {
    const response = await apiRequest('/api/dashboard/summary')
    return response.data
  },
}
