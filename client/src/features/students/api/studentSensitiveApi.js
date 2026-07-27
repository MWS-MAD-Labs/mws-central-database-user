import { apiRequest, ApiError } from '../../../lib/api.js'
import { compactSearchParams } from '../../../lib/url.js'

function buildQuery(params) {
  const query = compactSearchParams(params).toString()
  return query ? `?${query}` : ''
}

export const consentTypes = [
  'MEDIA_CONSENT',
  'PARENT_CONSENT',
  'DOCUMENTATION_CONSENT',
  'OTHER',
]

export const consentStatuses = ['PENDING', 'SIGNED', 'DECLINED', 'EXPIRED']
export const healthNoteCategories = ['HEALTH_INFO', 'SPECIAL_NEEDS']
export const healthNoteStatuses = ['ACTIVE', 'RESOLVED']

export const studentSensitiveApi = {
  async listConsents(studentId, params) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/consents${buildQuery(params)}`,
    )
    return response.data || []
  },

  async createConsent(studentId, payload) {
    const response = await apiRequest(`/api/admin/students/${studentId}/consents`, {
      method: 'POST',
      body: payload,
    })
    return response.data
  },

  async updateConsent(studentId, consentId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/consents/${consentId}`,
      { method: 'PATCH', body: payload },
    )
    return response.data
  },

  async removeConsent(studentId, consentId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/consents/delete/${consentId}`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async listAttachments(studentId, consentId, params) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/consents/${consentId}/attachments${buildQuery(params)}`,
    )
    return response.data || []
  },

  async uploadAttachment(studentId, consentId, file) {
    const formData = new FormData()
    formData.set('file', file)
    const response = await apiRequest(
      `/api/admin/students/${studentId}/consents/${consentId}/attachments`,
      { method: 'POST', body: formData },
    )
    return response.data
  },

  async removeAttachment(studentId, consentId, attachmentId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/consents/${consentId}/attachments/delete/${attachmentId}`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async getHealthRecord(studentId) {
    try {
      const response = await apiRequest(`/api/admin/students/${studentId}/health-record`)
      return response.data
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
  },

  async createHealthRecord(studentId, payload) {
    const response = await apiRequest(`/api/admin/students/${studentId}/health-record`, {
      method: 'POST',
      body: payload,
    })
    return response.data
  },

  async updateHealthRecord(studentId, payload) {
    const response = await apiRequest(`/api/admin/students/${studentId}/health-record`, {
      method: 'PATCH',
      body: payload,
    })
    return response.data
  },

  async listHealthNotes(studentId, params) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/health-notes${buildQuery(params)}`,
    )
    return response.data || []
  },

  async createHealthNote(studentId, payload) {
    const response = await apiRequest(`/api/admin/students/${studentId}/health-notes`, {
      method: 'POST',
      body: payload,
    })
    return response.data
  },

  async updateHealthNote(studentId, noteId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/health-notes/${noteId}`,
      { method: 'PATCH', body: payload },
    )
    return response.data
  },

  async removeHealthNote(studentId, noteId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/health-notes/delete/${noteId}`,
      { method: 'PATCH' },
    )
    return response.data
  },
}
