import { apiRequest } from '../../../lib/api.js'

async function me() {
  const response = await apiRequest('/api/auth/me')
  return response.data
}

async function employeeMe() {
  const response = await apiRequest('/api/auth/employee/me')
  return response.data
}

export const authApi = {
  async currentUser() {
    try {
      return await me()
    } catch (error) {
      if (error.status !== 401) {
        throw error
      }
    }

    try {
      return await employeeMe()
    } catch (error) {
      if (error.status === 401) {
        return null
      }
      throw error
    }
  },

  async loginWithGoogle(code) {
    const response = await apiRequest('/api/auth/google', {
      method: 'POST',
      body: { code },
      skipAuthRefresh: true,
    })

    return response.data
  },

  async logout(type) {
    const path =
      type === 'employee' ? '/api/auth/employee/logout' : '/api/auth/logout'

    return apiRequest(path, {
      method: 'POST',
      skipAuthRefresh: true,
    })
  },
}
