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

  async bulkExtendContract(ids, durationMonths) {
    const response = await apiRequest(
      '/api/admin/employees/bulk/extend-contract',
      {
        method: 'PATCH',
        body: { ids, duration_months: durationMonths },
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

  async getMutationHistory(id) {
    const response = await apiRequest(
      `/api/admin/employees/${id}/mutation-history`,
    )
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

  async extendContract(id, contractEndDate) {
    const response = await apiRequest(`/api/admin/employees/${id}/extend-contract`, {
      method: 'PATCH',
      body: { contract_end_date: contractEndDate },
    })
    return response.data
  },
}
