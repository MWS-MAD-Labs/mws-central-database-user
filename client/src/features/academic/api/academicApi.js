import { apiRequest } from '../../../lib/api.js'
import { compactSearchParams } from '../../../lib/url.js'

function buildQuery(params) {
  const searchParams = compactSearchParams(params)
  const query = searchParams.toString()
  return query ? `?${query}` : ''
}

function makeCrudApi(path) {
  return {
    async list(params) {
      return apiRequest(`${path}${buildQuery(params)}`)
    },

    async get(id) {
      const response = await apiRequest(`${path}/${id}`)
      return response.data
    },

    async create(payload) {
      const response = await apiRequest(path, {
        method: 'POST',
        body: payload,
      })
      return response.data
    },

    async update(id, payload) {
      const response = await apiRequest(`${path}/${id}`, {
        method: 'PATCH',
        body: payload,
      })
      return response.data
    },

    async remove(id) {
      const response = await apiRequest(`${path}/${id}`, {
        method: 'DELETE',
      })
      return response.data
    },
  }
}

export const academicYearStatuses = ['UPCOMING', 'ACTIVE', 'COMPLETED']
export const classStatuses = ['ACTIVE', 'INACTIVE', 'UPCOMING']
export const enrollmentStatuses = [
  'ACTIVE',
  'COMPLETED',
  'TRANSFERRED',
  'WITHDRAWN',
]
export const enrollmentCloseStatuses = ['COMPLETED', 'TRANSFERRED', 'WITHDRAWN']

export const academicYearsApi = {
  ...makeCrudApi('/api/admin/academic-years'),

  async getUnresolvedEnrollmentCount(id) {
    const response = await apiRequest(
      `/api/admin/academic-years/${id}/unresolved-enrollments`,
    )
    return response.data
  },

  async bulkCreate(payload) {
    const response = await apiRequest('/api/admin/academic-years/bulk', {
      method: 'POST',
      body: payload,
    })
    return response.data
  },

  async getOutOfRangeEnrollmentCount(id, params) {
    const response = await apiRequest(
      `/api/admin/academic-years/${id}/out-of-range-enrollments${buildQuery(params)}`,
    )
    return response.data
  },
}
export const gradesApi = makeCrudApi('/api/admin/grades')
export const classTeacherRoles = ['HOMEROOM', 'SUPPORTING_HOMEROOM', 'SUBJECT_TEACHER']

export const classesApi = {
  ...makeCrudApi('/api/admin/classes'),

  async teacherAssignments(id) {
    const response = await apiRequest(
      `/api/admin/classes/${id}/teacher-assignments`,
    )
    return response.data
  },

  async assignTeacher(classId, payload) {
    const response = await apiRequest(
      `/api/admin/classes/${classId}/teachers`,
      { method: 'POST', body: payload },
    )
    return response.data
  },

  async endTeacherAssignment(classId, assignmentId, endDate) {
    const response = await apiRequest(
      `/api/admin/classes/${classId}/teachers/${assignmentId}/end`,
      { method: 'PATCH', body: endDate ? { end_date: endDate } : {} },
    )
    return response.data
  },

  async removeTeacherAssignment(classId, assignmentId) {
    const response = await apiRequest(
      `/api/admin/classes/${classId}/teachers/${assignmentId}`,
      { method: 'DELETE' },
    )
    return response.data
  },

  async reopenTeacherAssignment(classId, assignmentId) {
    const response = await apiRequest(
      `/api/admin/classes/${classId}/teachers/${assignmentId}/reopen`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async bulkMoveTeacherAssignments(classId, payload) {
    const response = await apiRequest(
      `/api/admin/classes/${classId}/teachers/bulk/move`,
      { method: 'PATCH', body: payload },
    )
    return response.data
  },
}

export const enrollmentsApi = {
  async list(params) {
    return apiRequest(`/api/admin/enrollments${buildQuery(params)}`)
  },

  async history(studentId, params) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/enrollments${buildQuery(params)}`,
    )
    return response.data
  },

  async create(studentId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/enrollments`,
      {
        method: 'POST',
        body: payload,
      },
    )
    return response.data
  },

  async bulkCreate(payload) {
    const response = await apiRequest('/api/admin/enrollments/bulk', {
      method: 'POST',
      body: payload,
    })
    return response.data
  },

  async promote(studentId, enrollmentId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/enrollments/${enrollmentId}/promote`,
      {
        method: 'PATCH',
        body: payload,
      },
    )
    return response.data
  },

  async bulkPromote(payload) {
    const response = await apiRequest('/api/admin/enrollments/bulk/promote', {
      method: 'PATCH',
      body: payload,
    })
    return response.data
  },

  async transfer(studentId, enrollmentId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/enrollments/${enrollmentId}/transfer`,
      {
        method: 'PATCH',
        body: payload,
      },
    )
    return response.data
  },

  async close(studentId, enrollmentId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/enrollments/${enrollmentId}/close`,
      {
        method: 'PATCH',
        body: payload,
      },
    )
    return response.data
  },

  async bulkTransfer(payload) {
    const response = await apiRequest('/api/admin/enrollments/bulk/transfer', {
      method: 'PATCH',
      body: payload,
    })
    return response.data
  },

  async bulkClose(payload) {
    const response = await apiRequest('/api/admin/enrollments/bulk/close', {
      method: 'PATCH',
      body: payload,
    })
    return response.data
  },

  async reactivate(studentId, enrollmentId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/enrollments/${enrollmentId}/reactivate`,
      { method: 'PATCH', body: payload },
    )
    return response.data
  },

  async bulkReactivate(payload) {
    const response = await apiRequest('/api/admin/enrollments/bulk/reactivate', {
      method: 'PATCH',
      body: payload,
    })
    return response.data
  },

  // Soft-deletes an enrollment. When it's the product of a promote, the
  // backend also reactivates the enrollment it was promoted from in the
  // same call - "Drop" and "Rollback" are the same action now.
  async remove(studentId, enrollmentId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/enrollments/delete/${enrollmentId}`,
      { method: 'PATCH', body: payload },
    )
    return response.data
  },

  async bulkRemove(payload) {
    const response = await apiRequest('/api/admin/enrollments/bulk/delete', {
      method: 'PATCH',
      body: payload,
    })
    return response.data
  },

  async restore(studentId, enrollmentId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/enrollments/restore/${enrollmentId}`,
      { method: 'PATCH' },
    )
    return response.data
  },
}
