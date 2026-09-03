import { apiRequest } from '../../../lib/api.js'
import { compactSearchParams } from '../../../lib/url.js'

export const employeeSortFields = [
  'created_at',
  'full_name',
  'nick_name',
  'email',
  'employee_id',
  'status',
  'join_date',
]

export const employeeStatuses = [
  'ACTIVE',
  'INACTIVE',
  'RESIGNED',
  'ON_LEAVE',
  'ARCHIVED',
]

export const genderOptions = ['MALE', 'FEMALE']

export const religionOptions = [
  'ISLAM',
  'PROTESTANTISM',
  'CATHOLICISM',
  'HINDUISM',
  'BUDDHISM',
  'CONFUCIANISM',
  'OTHER',
]

export const employmentTypes = [
  'PERMANENT',
  'CONTRACT',
  'PART_TIME',
  'PROBATION',
  'FREELANCE',
  'WFH',
]

export const maritalStatuses = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']

export const educationLevels = [
  'SD',
  'SMP',
  'SMA_SMK',
  'D1',
  'D2',
  'D3',
  'D4',
  'S1',
  'S2',
  'S3',
]

export const employeesApi = {
  async list(params) {
    const searchParams = compactSearchParams(params)
    const query = searchParams.toString()
    return apiRequest(`/api/admin/employees${query ? `?${query}` : ''}`)
  },

  async get(id) {
    const response = await apiRequest(`/api/admin/employees/${id}`)
    return response.data
  },

  async countTotal() {
    const response = await apiRequest('/api/admin/employees/count-total')
    return response.data.total
  },

  async create(payload) {
    const response = await apiRequest('/api/admin/employees', {
      method: 'POST',
      body: payload,
    })
    return response.data
  },

  async update(id, payload) {
    const response = await apiRequest(`/api/admin/employees/${id}`, {
      method: 'PATCH',
      body: payload,
    })
    return response.data
  },

  async bulkUpdate(ids, payload) {
    const response = await apiRequest('/api/admin/employees/bulk/update', {
      method: 'PATCH',
      body: { ids, ...payload },
    })
    return response.data
  },

  async bulkExtendContract(ids, { durationMonths, contractEndDate, baselineOverrides } = {}) {
    const response = await apiRequest(
      '/api/admin/employees/bulk/extend-contract',
      {
        method: 'PATCH',
        body: {
          ids,
          duration_months: durationMonths,
          contract_end_date: contractEndDate,
          baseline_overrides: baselineOverrides?.length
            ? baselineOverrides
            : undefined,
        },
      },
    )
    return response.data
  },

  async remove(id) {
    const response = await apiRequest(`/api/admin/employees/delete/${id}`, {
      method: 'PATCH',
    })
    return response.data
  },

  async bulkRemove(ids) {
    const response = await apiRequest('/api/admin/employees/bulk/delete', {
      method: 'PATCH',
      body: { ids },
    })
    return response.data
  },

  async restore(id) {
    const response = await apiRequest(`/api/admin/employees/restore/${id}`, {
      method: 'PATCH',
    })
    return response.data
  },

  async bulkRestore(ids) {
    const response = await apiRequest('/api/admin/employees/bulk/restore', {
      method: 'PATCH',
      body: { ids },
    })
    return response.data
  },

  async uploadPhoto(id, file) {
    const formData = new FormData()
    // Blob (e.g. a cropped photo) has no filename of its own - give it one
    // so the server sees a normal upload either way.
    if (file instanceof Blob && !(file instanceof File)) {
      formData.set('file', file, 'photo.jpg')
    } else {
      formData.set('file', file)
    }
    const response = await apiRequest(`/api/admin/employees/${id}/photo`, {
      method: 'POST',
      body: formData,
    })
    return response.data
  },

  async removePhoto(id) {
    const response = await apiRequest(`/api/admin/employees/${id}/photo`, {
      method: 'DELETE',
    })
    return response.data
  },

  // Matching only, by filename - lets the caller show a review step before
  // any file is actually uploaded.
  async previewBulkPhotos(fileNames) {
    const response = await apiRequest(
      '/api/admin/employees/photos/bulk-preview',
      {
        method: 'POST',
        body: { file_names: fileNames },
      },
    )
    return response.data
  },

  async commitBulkPhotos(mappings, files) {
    const formData = new FormData()
    formData.set('mappings', JSON.stringify(mappings))
    for (const file of files) {
      formData.append('files', file)
    }
    const response = await apiRequest(
      '/api/admin/employees/photos/bulk-commit',
      {
        method: 'POST',
        body: formData,
      },
    )
    return response.data
  },

  async getMutationHistory(id) {
    const response = await apiRequest(
      `/api/admin/employees/${id}/mutation-history`,
    )
    return response.data
  },

  async getEducationSuggestions() {
    const response = await apiRequest('/api/admin/employees/education-suggestions')
    return response.data
  },

  async rollbackMutation(id, historyId) {
    const response = await apiRequest(
      `/api/admin/employees/${id}/mutation-history/${historyId}/rollback`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async getTeachingAssignments(id) {
    const response = await apiRequest(
      `/api/admin/employees/${id}/teaching-assignments`,
    )
    return response.data
  },

  async getSupportAssignments(id) {
    const response = await apiRequest(
      `/api/admin/employees/${id}/support-assignments`,
    )
    return response.data
  },

  async getPcActivityMentorships(id) {
    const response = await apiRequest(
      `/api/admin/employees/${id}/pc-activity-mentorships`,
    )
    return response.data
  },

  async extendContract(id, contractEndDate) {
    const response = await apiRequest(`/api/admin/employees/${id}/extend-contract`, {
      method: 'PATCH',
      body: { contract_end_date: contractEndDate },
    })
    return response.data
  },

  async getDisciplinaryActions(id) {
    const response = await apiRequest(
      `/api/admin/employees/${id}/disciplinary-actions`,
    )
    return response.data
  },

  async createDisciplinaryAction(id, payload) {
    const response = await apiRequest(
      `/api/admin/employees/${id}/disciplinary-actions`,
      { method: 'POST', body: payload },
    )
    return response.data
  },

  async updateDisciplinaryAction(id, actionId, payload) {
    const response = await apiRequest(
      `/api/admin/employees/${id}/disciplinary-actions/${actionId}`,
      { method: 'PATCH', body: payload },
    )
    return response.data
  },

  async resolveDisciplinaryAction(id, actionId, payload) {
    const response = await apiRequest(
      `/api/admin/employees/${id}/disciplinary-actions/${actionId}/resolve`,
      { method: 'PATCH', body: payload },
    )
    return response.data
  },

  async revokeDisciplinaryAction(id, actionId) {
    const response = await apiRequest(
      `/api/admin/employees/${id}/disciplinary-actions/${actionId}/revoke`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async getDisciplinaryActionAttachments(id, actionId, params) {
    const searchParams = compactSearchParams(params)
    const query = searchParams.toString()
    const response = await apiRequest(
      `/api/admin/employees/${id}/disciplinary-actions/${actionId}/attachments${query ? `?${query}` : ''}`,
    )
    return response.data || []
  },

  async uploadDisciplinaryActionAttachment(id, actionId, file) {
    const formData = new FormData()
    formData.set('file', file)
    const response = await apiRequest(
      `/api/admin/employees/${id}/disciplinary-actions/${actionId}/attachments`,
      { method: 'POST', body: formData },
    )
    return response.data
  },

  async removeDisciplinaryActionAttachment(id, actionId, attachmentId) {
    const response = await apiRequest(
      `/api/admin/employees/${id}/disciplinary-actions/${actionId}/attachments/delete/${attachmentId}`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async restoreDisciplinaryActionAttachment(id, actionId, attachmentId) {
    const response = await apiRequest(
      `/api/admin/employees/${id}/disciplinary-actions/${actionId}/attachments/restore/${attachmentId}`,
      { method: 'PATCH' },
    )
    return response.data
  },
}

export const disciplinaryActionTypes = ['SURAT_TEGURAN', 'SURAT_PERINGATAN']

// English display text - the enum value itself stays Indonesian (matches
// the source documents these track), only the label shown in the UI is English.
export const disciplinaryActionTypeLabels = {
  SURAT_TEGURAN: 'Warning Letter',
  SURAT_PERINGATAN: 'Reprimand Letter',
}

// Not a fixed company-wide rule - the admin picks how long a record stays
// active per issuance. Values are in days so "7 days" doesn't have to
// awkwardly share a unit with "3 months".
export const disciplinaryActionValidityOptions = [
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '1 month' },
  { value: 90, label: '3 months' },
  { value: 180, label: '6 months' },
  { value: 365, label: '12 months' },
]
