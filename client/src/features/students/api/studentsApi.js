import { apiRequest } from '../../../lib/api.js'
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
  async list(params) {
    const searchParams = compactSearchParams(params)
    const query = searchParams.toString()
    return apiRequest(`/api/admin/students${query ? `?${query}` : ''}`)
  },

  async get(id) {
    const response = await apiRequest(`/api/admin/students/${id}`)
    return response.data
  },

  async create(payload) {
    const response = await apiRequest('/api/admin/students', {
      method: 'POST',
      body: payload,
    })
    return response.data
  },

  async update(id, payload) {
    const response = await apiRequest(`/api/admin/students/${id}`, {
      method: 'PATCH',
      body: payload,
    })
    return response.data
  },

  async remove(id) {
    const response = await apiRequest(`/api/admin/students/delete/${id}`, {
      method: 'PATCH',
    })
    return response.data
  },

  async restore(id) {
    const response = await apiRequest(`/api/admin/students/restore/${id}`, {
      method: 'PATCH',
    })
    return response.data
  },
}
