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

  async bulkEndTeacherAssignments(classId, payload) {
    const response = await apiRequest(
      `/api/admin/classes/${classId}/teachers/bulk/end`,
      { method: 'PATCH', body: payload },
    )
    return response.data
  },

  async bulkRemoveTeacherAssignments(classId, payload) {
    const response = await apiRequest(
      `/api/admin/classes/${classId}/teachers/bulk`,
      { method: 'DELETE', body: payload },
    )
    return response.data
  },

  async bulkReopenTeacherAssignments(classId, payload) {
    const response = await apiRequest(
      `/api/admin/classes/${classId}/teachers/bulk/reopen`,
      { method: 'PATCH', body: payload },
    )
    return response.data
  },

}

// PC Activity rooms are scoped to unit(s)+grade(s), not to a single class -
// a top-level resource, not nested under classesApi anymore.
export const pcActivityRoomsApi = {
  async list(params) {
    const query = compactSearchParams(params).toString()
    return apiRequest(`/api/admin/pc-activity-rooms${query ? `?${query}` : ''}`)
  },

  async get(roomId) {
    const response = await apiRequest(`/api/admin/pc-activity-rooms/${roomId}`)
    return response.data
  },

  async create(payload) {
    const response = await apiRequest('/api/admin/pc-activity-rooms', {
      method: 'POST',
      body: payload,
    })
    return response.data
  },

  async update(roomId, payload) {
    const response = await apiRequest(`/api/admin/pc-activity-rooms/${roomId}`, {
      method: 'PATCH',
      body: payload,
    })
    return response.data
  },

  async remove(roomId) {
    const response = await apiRequest(`/api/admin/pc-activity-rooms/${roomId}`, {
      method: 'DELETE',
    })
    return response.data
  },

  async listMentors(roomId) {
    const response = await apiRequest(`/api/admin/pc-activity-rooms/${roomId}/mentors`)
    return response.data
  },

  async assignMentor(roomId, payload) {
    const response = await apiRequest(`/api/admin/pc-activity-rooms/${roomId}/mentors`, {
      method: 'POST',
      body: payload,
    })
    return response.data
  },

  async bulkAssignMentors(roomId, payload) {
    const response = await apiRequest(`/api/admin/pc-activity-rooms/${roomId}/mentors/bulk`, {
      method: 'POST',
      body: payload,
    })
    return response.data
  },

  async endMentorAssignment(roomId, assignmentId) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/mentors/${assignmentId}/end`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async removeMentorAssignment(roomId, assignmentId) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/mentors/${assignmentId}`,
      { method: 'DELETE' },
    )
    return response.data
  },

  async reopenMentorAssignment(roomId, assignmentId) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/mentors/${assignmentId}/reopen`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async moveMentorAssignment(roomId, assignmentId, payload) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/mentors/${assignmentId}/move`,
      { method: 'POST', body: payload },
    )
    return response.data
  },

  async bulkEndMentorAssignments(roomId, payload) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/mentors/bulk-end`,
      { method: 'POST', body: payload },
    )
    return response.data
  },

  async bulkRemoveMentorAssignments(roomId, payload) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/mentors/bulk-remove`,
      { method: 'POST', body: payload },
    )
    return response.data
  },

  async bulkReopenMentorAssignments(roomId, payload) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/mentors/bulk-reopen`,
      { method: 'POST', body: payload },
    )
    return response.data
  },

  async bulkMoveMentorAssignments(roomId, payload) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/mentors/bulk-move`,
      { method: 'POST', body: payload },
    )
    return response.data
  },

  async listEligibleStudents(roomId) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/eligible-students`,
    )
    return response.data
  },

  async listStudents(roomId) {
    const response = await apiRequest(`/api/admin/pc-activity-rooms/${roomId}/students`)
    return response.data
  },

  async bulkAssignStudents(roomId, payload) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/students/bulk`,
      { method: 'POST', body: payload },
    )
    return response.data
  },

  async endStudentAssignment(roomId, assignmentId) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/students/${assignmentId}/end`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async dropStudentAssignment(roomId, assignmentId) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/students/${assignmentId}`,
      { method: 'DELETE' },
    )
    return response.data
  },

  async reopenStudentAssignment(roomId, assignmentId) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/students/${assignmentId}/reopen`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async moveStudent(roomId, assignmentId, payload) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/students/${assignmentId}/move`,
      { method: 'POST', body: payload },
    )
    return response.data
  },

  async bulkEndStudentAssignments(roomId, payload) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/students/bulk-end`,
      { method: 'POST', body: payload },
    )
    return response.data
  },

  async bulkDropStudentAssignments(roomId, payload) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/students/bulk-drop`,
      { method: 'POST', body: payload },
    )
    return response.data
  },

  async bulkReopenStudentAssignments(roomId, payload) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/students/bulk-reopen`,
      { method: 'POST', body: payload },
    )
    return response.data
  },

  async bulkMoveStudentAssignments(roomId, payload) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/students/bulk-move`,
      { method: 'POST', body: payload },
    )
    return response.data
  },

  async reassignStudent(roomId, studentId, payload) {
    const response = await apiRequest(
      `/api/admin/pc-activity-rooms/${roomId}/students/${studentId}/reassign`,
      { method: 'POST', body: payload },
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

  async previewBackfill(payload) {
    const response = await apiRequest(
      '/api/admin/enrollments/preview-backfill',
      {
        method: 'POST',
        body: payload,
      },
    )
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

  async fixClass(studentId, enrollmentId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/enrollments/${enrollmentId}/fix-class`,
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
