import { apiRequest } from '../../../lib/api.js'
import { compactSearchParams } from '../../../lib/url.js'

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
  async list(params) {
    const searchParams = compactSearchParams(params)
    const query = searchParams.toString()
    return apiRequest(`/api/admin/interns${query ? `?${query}` : ''}`)
  },

  async get(id) {
    const response = await apiRequest(`/api/admin/interns/${id}`)
    return response.data
  },

  async countTotal() {
    const response = await apiRequest('/api/admin/interns/count-total')
    return response.data.total
  },

  async create(payload) {
    const response = await apiRequest('/api/admin/interns', {
      method: 'POST',
      body: payload,
    })
    return response.data
  },

  async update(id, payload) {
    const response = await apiRequest(`/api/admin/interns/${id}`, {
      method: 'PATCH',
      body: payload,
    })
    return response.data
  },

  async remove(id) {
    const response = await apiRequest(`/api/admin/interns/delete/${id}`, {
      method: 'PATCH',
    })
    return response.data
  },

  async restore(id) {
    const response = await apiRequest(`/api/admin/interns/restore/${id}`, {
      method: 'PATCH',
    })
    return response.data
  },
}
