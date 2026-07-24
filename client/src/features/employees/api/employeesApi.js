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
  'building',
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

  async remove(id) {
    const response = await apiRequest(`/api/admin/employees/delete/${id}`, {
      method: 'PATCH',
    })
    return response.data
  },

  async restore(id) {
    const response = await apiRequest(`/api/admin/employees/restore/${id}`, {
      method: 'PATCH',
    })
    return response.data
  },
}
