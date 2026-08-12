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
export const parentTypes = ['FATHER', 'MOTHER', 'GUARDIAN']
export const vaccineTypes = [
  'POLIO',
  'DPT',
  'MEASLES',
  'HEPATITIS_B',
  'BCG',
  'MMR',
  'COVID_1',
  'COVID_2',
]
export const pcDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY']
export const studentSupportRoles = ['SPECIAL_ED']

export const studentSensitiveApi = {
  async listParents(studentId, params) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/parents${buildQuery(params)}`,
    )
    return response.data || []
  },

  async createParent(studentId, payload) {
    const response = await apiRequest(`/api/admin/students/${studentId}/parents`, {
      method: 'POST',
      body: payload,
    })
    return response.data
  },

  async updateParent(studentId, parentId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/parents/${parentId}`,
      { method: 'PATCH', body: payload },
    )
    return response.data
  },

  async removeParent(studentId, parentId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/parents/delete/${parentId}`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async restoreParent(studentId, parentId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/parents/restore/${parentId}`,
      { method: 'PATCH' },
    )
    return response.data
  },

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

  async restoreConsent(studentId, consentId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/consents/restore/${consentId}`,
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

  async restoreAttachment(studentId, consentId, attachmentId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/consents/${consentId}/attachments/restore/${attachmentId}`,
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

  async removeHealthRecord(studentId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/health-record/delete`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async restoreHealthRecord(studentId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/health-record/restore`,
      { method: 'PATCH' },
    )
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

  async restoreHealthNote(studentId, noteId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/health-notes/restore/${noteId}`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async listVaccines(studentId, params) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/vaccine-records${buildQuery(params)}`,
    )
    return response.data || []
  },

  async createVaccine(studentId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/vaccine-records`,
      { method: 'POST', body: payload },
    )
    return response.data
  },

  async updateVaccine(studentId, vaccineId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/vaccine-records/${vaccineId}`,
      { method: 'PATCH', body: payload },
    )
    return response.data
  },

  async removeVaccine(studentId, vaccineId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/vaccine-records/delete/${vaccineId}`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async restoreVaccine(studentId, vaccineId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/vaccine-records/restore/${vaccineId}`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async listPcActivities(studentId, params) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/pc-activities${buildQuery(params)}`,
    )
    return response.data || []
  },

  async createPcActivity(studentId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/pc-activities`,
      { method: 'POST', body: payload },
    )
    return response.data
  },

  async updatePcActivity(studentId, activityId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/pc-activities/${activityId}`,
      { method: 'PATCH', body: payload },
    )
    return response.data
  },

  async removePcActivity(studentId, activityId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/pc-activities/delete/${activityId}`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async restorePcActivity(studentId, activityId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/pc-activities/restore/${activityId}`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async listSupportAssignments(studentId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/support-assignments`,
    )
    return response.data || []
  },

  async createSupportAssignment(studentId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/support-assignments`,
      { method: 'POST', body: payload },
    )
    return response.data
  },

  async endSupportAssignment(studentId, assignmentId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/support-assignments/${assignmentId}/end`,
      { method: 'PATCH' },
    )
    return response.data
  },

  // Not student-scoped - active SPECIAL_ED assignment count per employee,
  // across every student, so the assign UI can show existing caseload.
  async getSupportAssignmentCaseload() {
    const response = await apiRequest('/api/admin/support-assignments/caseload')
    return response.data || []
  },

  // Bulk check for a roster view (e.g. Class Detail) - which of these
  // student IDs currently have an active SPECIAL_ED support assignment.
  async getActiveSupportStudentIds(studentIds) {
    if (!studentIds.length) return []
    const response = await apiRequest(
      `/api/admin/support-assignments/active-student-ids?student_ids=${studentIds.join(',')}`,
    )
    return response.data || []
  },
}
