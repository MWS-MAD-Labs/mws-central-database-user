import { apiRequest } from '../../../lib/api.js'
import { compactSearchParams } from '../../../lib/url.js'

const BASE = '/api/admin/identifier-change-requests'

export const changeRequestsApi = {
  async list(params = {}) {
    const query = compactSearchParams(params).toString()
    return apiRequest(`${BASE}${query ? `?${query}` : ''}`)
  },

  // The requester's own requests, with the count of decisions not opened yet.
  async listMine(params = {}) {
    const query = compactSearchParams(params).toString()
    return apiRequest(`${BASE}/mine${query ? `?${query}` : ''}`)
  },

  async markMineSeen() {
    const response = await apiRequest(`${BASE}/mine/seen`, { method: 'POST' })
    return response.data
  },

  // { employee, student }: whether anyone can currently review a request.
  async approverStatus() {
    const response = await apiRequest(`${BASE}/approver-status`)
    return response.data
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
