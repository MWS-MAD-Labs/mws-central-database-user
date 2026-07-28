import { apiFileRequest, apiRequest } from '../../../lib/api.js'
import { compactSearchParams } from '../../../lib/url.js'

const entityPath = {
  students: 'students',
  employees: 'employees',
}

export const dataTransferApi = {
  async preview(entity, file) {
    const formData = new FormData()
    formData.append('file', file)

    const response = await apiRequest(
      `/api/admin/${entityPath[entity]}/import/preview`,
      {
        method: 'POST',
        body: formData,
      },
    )
    return response.data
  },

  async commit(entity, jobId) {
    const response = await apiRequest(
      `/api/admin/${entityPath[entity]}/import/${jobId}/commit`,
      { method: 'POST' },
    )
    return response.data
  },

  async rollback(entity, jobId) {
    const response = await apiRequest(
      `/api/admin/${entityPath[entity]}/import/${jobId}/rollback`,
      { method: 'POST' },
    )
    return response.data
  },

  async exportFile(entity, params) {
    const searchParams = compactSearchParams(params)
    const query = searchParams.toString()
    return apiFileRequest(
      `/api/admin/${entityPath[entity]}/export${query ? `?${query}` : ''}`,
    )
  },
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName || 'export'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
