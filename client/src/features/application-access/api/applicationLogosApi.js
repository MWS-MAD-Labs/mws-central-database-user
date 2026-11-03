import { apiFileRequest, apiRequest } from "../../../lib/api.js";

const PATH = "/api/admin/application-logos";

export const applicationLogosApi = {
  async list() {
    const response = await apiRequest(PATH);
    return response.data;
  },

  async upload({ name, file }) {
    const body = new FormData();
    body.set("name", name);
    body.set("file", file);
    const response = await apiRequest(PATH, { method: "POST", body });
    return response.data;
  },

  async rename(id, name) {
    const response = await apiRequest(`${PATH}/${id}`, { method: "PATCH", body: { name } });
    return response.data;
  },

  async remove(id) {
    const response = await apiRequest(`${PATH}/${id}`, { method: "DELETE" });
    return response.data;
  },

  // The picture needs the admin cookie, so it is fetched and shown from a blob address.
  async image(id) {
    const { blob } = await apiFileRequest(`${PATH}/${id}/image`);
    return URL.createObjectURL(blob);
  },
};
