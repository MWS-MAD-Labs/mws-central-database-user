import { apiRequest } from "../../../lib/api.js";

export const apiClientsApi = {
  async list() {
    const response = await apiRequest("/api/admin/api-clients");
    return response.data || [];
  },

  // Single source of truth for both the "Internal API reference" table and
  // the scope checkboxes in the create/edit dialogs below - comes from the
  // backend's own endpoint manifest, so a new /api/internal/* route (and
  // its scope) shows up here automatically instead of needing this file
  // updated by hand too.
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

  async rotate(id) {
    const response = await apiRequest(`/api/admin/api-clients/rotate/${id}`, {
      method: "PATCH",
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

  async testInternal(path, token) {
    return apiRequest(path, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      skipAuthRefresh: true,
    });
  },
};
