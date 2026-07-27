import { apiRequest } from '../../../lib/api.js'
import { compactSearchParams } from '../../../lib/url.js'

export const auditActions = [
  'LOGIN',
  'LOGOUT',
  'CREATE_STUDENT',
  'UPDATE_STUDENT',
  'DELETE_STUDENT',
  'CREATE_EMPLOYEE',
  'UPDATE_EMPLOYEE',
  'DELETE_EMPLOYEE',
  'CREATE_CONSENT',
  'UPDATE_CONSENT',
  'DELETE_CONSENT',
  'CREATE_HEALTH_RECORD',
  'UPDATE_HEALTH_RECORD',
  'CREATE_HEALTH_NOTE',
  'UPDATE_HEALTH_NOTE',
  'API_TOKEN_CREATE',
  'API_TOKEN_ROTATE',
  'API_TOKEN_REVOKE',
  'EXPORT_DATA',
  'ACCESS_HEALTH_DATA',
]

export const auditSources = ['UI', 'API', 'SYSTEM', 'IMPORT']

export const auditLogsApi = {
  async list(params) {
    const query = compactSearchParams(params).toString()
    return apiRequest(`/api/admin/audit-logs${query ? `?${query}` : ''}`)
  },
}
