import { describe, expect, it, mock } from "bun:test";
import { apiClientsApi } from "../../../src/features/api-clients/api/apiClientsApi.js";

function response(data, extra = {}) {
  return new Response(JSON.stringify({ data, ...extra }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("apiClientsApi", () => {
  it("loads profiles and preserves server environment metadata", async () => {
    globalThis.fetch = mock(async () =>
      response([{ id: "profile-1", code: "roster", name: "Roster" }], {
        environment: "staging",
      }),
    );

    await expect(apiClientsApi.listProfiles()).resolves.toEqual({
      profiles: [{ id: "profile-1", code: "roster", name: "Roster" }],
      environment: "staging",
    });
    expect(globalThis.fetch.mock.calls[0][0]).toBe(
      "/api/admin/application-integration-profiles",
    );
  });

  it("sends profile creation and compatible rotation payloads", async () => {
    const fetchMock = mock(async () => response({ id: "client-1" }));
    globalThis.fetch = fetchMock;

    await apiClientsApi.create({
      profile_id: "profile-1",
      purpose: "roster-sync",
      description: "Nightly sync",
    });
    await apiClientsApi.rotate({
      id: "client-1",
      mode: "graceful",
      graceSeconds: 86400,
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      profile_id: "profile-1",
      purpose: "roster-sync",
      description: "Nightly sync",
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/admin/api-clients/rotate/client-1",
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      immediate: false,
      grace_hours: 24,
    });

    await apiClientsApi.rotate({ id: "client-1", mode: "emergency" });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      immediate: true,
      grace_hours: 0,
    });
  });
});
