import { apiRequest } from './api.js'
import { compactSearchParams } from './url.js'

export function createCrudApi(basePath) {
  return {
    async list(params) {
      const searchParams = compactSearchParams(params)
      const query = searchParams.toString()
      return apiRequest(`${basePath}${query ? `?${query}` : ''}`)
    },

    async get(id) {
      const response = await apiRequest(`${basePath}/${id}`)
      return response.data
    },

    async countTotal() {
      const response = await apiRequest(`${basePath}/count-total`)
      return response.data.total
    },

    // Cheap { count, updated_at } signature for consumers that compare list versions.
    async getVersion(params) {
      const searchParams = compactSearchParams(params)
      const query = searchParams.toString()
      const response = await apiRequest(`${basePath}/version${query ? `?${query}` : ''}`)
      return response.data
    },

    async create(payload) {
      const response = await apiRequest(basePath, {
        method: 'POST',
        body: payload,
      })
      return response.data
    },

    async update(id, payload) {
      const response = await apiRequest(`${basePath}/${id}`, {
        method: 'PATCH',
        body: payload,
      })
      return response.data
    },

    async remove(id) {
      const response = await apiRequest(`${basePath}/delete/${id}`, {
        method: 'PATCH',
      })
      return response.data
    },

    async restore(id) {
      const response = await apiRequest(`${basePath}/restore/${id}`, {
        method: 'PATCH',
      })
      return response.data
    },
  }
}

export function createBulkCrudApi(basePath) {
  return {
    async bulkRemove(ids) {
      const response = await apiRequest(`${basePath}/bulk/delete`, {
        method: 'PATCH',
        body: { ids },
      })
      return response.data
    },

    async bulkRestore(ids) {
      const response = await apiRequest(`${basePath}/bulk/restore`, {
        method: 'PATCH',
        body: { ids },
      })
      return response.data
    },
  }
}
