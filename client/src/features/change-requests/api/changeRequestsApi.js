import { apiRequest } from '../../../lib/api.js'
import { compactSearchParams } from '../../../lib/url.js'

const BASE = '/api/admin/identifier-change-requests'

export const changeRequestsApi = {
  async list(params = {}) {
    const query = compactSearchParams(params).toString()
    return apiRequest(`${BASE}${query ? `?${query}` : ''}`)
  },

  async create(payload) {
    const response = await apiRequest(BASE, { method: 'POST', body: payload })
    return response.data
  },

  async approve(id, decisionNote) {
    const response = await apiRequest(`${BASE}/${id}/approve`, {
      method: 'PATCH',
      body: decisionNote ? { decision_note: decisionNote } : {},
    })
    return response.data
  },

  async reject(id, decisionNote) {
    const response = await apiRequest(`${BASE}/${id}/reject`, {
      method: 'PATCH',
      body: { decision_note: decisionNote },
    })
    return response.data
  },

  async cancel(id) {
    const response = await apiRequest(`${BASE}/${id}/cancel`, { method: 'PATCH' })
    return response.data
  },
}
