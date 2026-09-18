import { apiRequest } from '../../../lib/api.js'
import { createBulkCrudApi, createCrudApi } from '../../../lib/crudApi.js'
import { compactSearchParams } from '../../../lib/url.js'

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

export const studentStatuses = [
  'REGISTERED',
  'ACTIVE',
  'INACTIVE',
  'GRADUATED',
  'TRANSFERRED',
  'WITHDRAWN',
  'ARCHIVED',
]

export const studentEntryTypes = ['PRE_K', 'PSB', 'TRANSFER']

export const terminalStudentStatuses = ['GRADUATED', 'TRANSFERRED', 'WITHDRAWN']

export const studentSortFields = [
  'created_at',
  'full_name',
  'nick_name',
  'email',
  'gender',
  'nis',
  'nisn',
  'status',
  'class',
  'grade',
  'join_year',
]

export const studentsApi = {
  ...createCrudApi('/api/admin/students'),
  ...createBulkCrudApi('/api/admin/students'),

  async listBackfillCandidates(params) {
    const searchParams = compactSearchParams(params)
    const query = searchParams.toString()
    return apiRequest(
      `/api/admin/students/backfill-candidates${query ? `?${query}` : ''}`,
    )
  },

  async reissueNis(id, entryType, joinFields) {
    const response = await apiRequest(`/api/admin/students/${id}/reissue-nis`, {
      method: 'PATCH',
      body: {
        entry_type: entryType,
        join_grade_id: joinFields?.joinGradeId || undefined,
        join_academic_year_id: joinFields?.joinAcademicYearId || undefined,
      },
    })
    return response.data
  },

  async getMutationHistory(id) {
    const response = await apiRequest(
      `/api/admin/students/${id}/mutation-history`,
    )
    return response.data
  },

  async rollbackMutation(id, historyId) {
    const response = await apiRequest(
      `/api/admin/students/${id}/mutation-history/${historyId}/rollback`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async deactivate(id) {
    const response = await apiRequest(`/api/admin/students/${id}/deactivate`, {
      method: 'PATCH',
    })
    return response.data
  },

  async bulkDeactivate(ids) {
    const response = await apiRequest('/api/admin/students/bulk/deactivate', {
      method: 'PATCH',
      body: { ids },
    })
    return response.data
  },

  async reactivate(id) {
    const response = await apiRequest(`/api/admin/students/${id}/reactivate`, {
      method: 'PATCH',
    })
    return response.data
  },

  async bulkReactivate(ids) {
    const response = await apiRequest('/api/admin/students/bulk/reactivate', {
      method: 'PATCH',
      body: { ids },
    })
    return response.data
  },

  async uploadPhoto(id, file) {
    const formData = new FormData()
    if (file instanceof Blob && !(file instanceof File)) {
      formData.set('file', file, 'photo.jpg')
    } else {
      formData.set('file', file)
    }
    const response = await apiRequest(`/api/admin/students/${id}/photo`, {
      method: 'POST',
      body: formData,
    })
    return response.data
  },

  async removePhoto(id) {
    const response = await apiRequest(`/api/admin/students/${id}/photo`, {
      method: 'DELETE',
    })
    return response.data
  },

  async previewBulkPhotos(fileNames) {
    const response = await apiRequest('/api/admin/students/photos/bulk-preview', {
      method: 'POST',
      body: { file_names: fileNames },
    })
    return response.data
  },

  async commitBulkPhotos(mappings, files) {
    const formData = new FormData()
    formData.set('mappings', JSON.stringify(mappings))
    for (const file of files) {
      formData.append('files', file)
    }
    const response = await apiRequest('/api/admin/students/photos/bulk-commit', {
      method: 'POST',
      body: formData,
    })
    return response.data
  },
}
