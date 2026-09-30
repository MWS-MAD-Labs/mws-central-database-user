import { apiRequest } from "../../../lib/api.js";

export const apiClientsApi = {
  async list() {
    const response = await apiRequest("/api/admin/api-clients");
    const data = response?.data ?? response ?? [];
    return Array.isArray(data) ? data : data.clients || [];
  },

  async listProfiles() {
    const response = await apiRequest(
      "/api/admin/application-integration-profiles",
    );
    const data = response?.data ?? response ?? [];
    return {
      profiles: Array.isArray(data) ? data : data.profiles || [],
      environment:
        response?.environment || data.environment || response?.meta?.environment || null,
    };
  },

  async createProfile(payload) {
    const response = await apiRequest("/api/admin/application-integration-profiles", {
      method: "POST",
      body: payload,
    });
    return response.data;
  },

  async updateProfile(id, payload) {
    const response = await apiRequest(
      `/api/admin/application-integration-profiles/${id}`,
      { method: "PATCH", body: payload },
    );
    return response.data;
  },

  async listProfileScopes() {
    const response = await apiRequest(
      "/api/admin/application-integration-profiles/scopes",
    );
    return response.data || [];
  },

  async listInternalEndpoints() {
    const response = await apiRequest("/api/admin/api-clients/internal-endpoints");
    return response.data || [];
  },

  async create(payload) {
    const response = await apiRequest("/api/admin/api-clients", {
      method: "POST",
      body: payload,
    });
    return response.data;
  },

  async revoke(id) {
    const response = await apiRequest(`/api/admin/api-clients/revoke/${id}`, {
      method: "PATCH",
    });
    return response.data;
  },

  async rotate({ id, mode = "graceful", graceSeconds = 86400 }) {
    const response = await apiRequest(`/api/admin/api-clients/rotate/${id}`, {
      method: "PATCH",
      body: {
        immediate: mode === "emergency",
        grace_hours: mode === "graceful" ? graceSeconds / 3600 : 0,
      },
    });
    return response.data;
  },

  async updateScopes(id, scopeNames) {
    const response = await apiRequest(`/api/admin/api-clients/${id}/scopes`, {
      method: "PATCH",
      body: { scope_names: scopeNames },
    });
    return response.data;
  },

  async revokeCredential(clientId, credentialId) {
    const response = await apiRequest(
      `/api/admin/api-clients/${clientId}/credentials/${credentialId}/revoke`,
      { method: "PATCH" },
    );
    return response.data;
  },

  async testInternal(path, token) {
    return apiRequest(path, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      skipAuthRefresh: true,
    });
  },
};
