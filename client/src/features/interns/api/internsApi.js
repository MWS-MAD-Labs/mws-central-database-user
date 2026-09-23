import { createBulkCrudApi, createCrudApi } from '../../../lib/crudApi.js'
import { apiRequest } from '../../../lib/api.js'

export const internSortFields = [
  'created_at',
  'full_name',
  'nick_name',
  'email',
  'status',
  'join_date',
  'end_date',
]

export const internStatuses = ['ACTIVE', 'COMPLETED', 'TERMINATED']

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

export const internsApi = {
  ...createCrudApi('/api/admin/interns'),
  ...createBulkCrudApi('/api/admin/interns'),
  async getTeachingAssignments(id) {
    const response = await apiRequest(
      `/api/admin/interns/${id}/teaching-assignments`,
    )
    return response.data
  },
  async getSupportAssignments(id) {
    const response = await apiRequest(
      `/api/admin/interns/${id}/support-assignments`,
    )
    return response.data
  },
  async getPcActivityMentorships(id) {
    const response = await apiRequest(
      `/api/admin/interns/${id}/pc-activity-mentorships`,
    )
    return response.data
  },
  async getMutationHistory(id) {
    const response = await apiRequest(`/api/admin/interns/${id}/mutation-history`)
    return response.data
  },
  async rollbackMutation(id, historyId) {
    const response = await apiRequest(
      `/api/admin/interns/${id}/mutation-history/${historyId}/rollback`,
      { method: 'PATCH' },
    )
    return response.data
  },
}
