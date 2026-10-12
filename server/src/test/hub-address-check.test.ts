import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { checkHubAddress } from "../service/hub-address-check";
import { AdminUserTest, MasterDataTest, TestRequest } from "./test-utils";

const ACCESS = "/api/admin/application-access";

describe("hub address check", () => {
  let server: ReturnType<typeof Bun.serve>;
  const base = () => `http://127.0.0.1:${server.port}`;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/hub/.well-known/jwks.json") return new Response("redirected", { status: 302, headers: { Location: "http://elsewhere" } });
        if (path !== "/.well-known/jwks.json") return new Response("not found", { status: 404 });
        const host = request.headers.get("host") ?? "";
        return host ? Response.json({ keys: [{ kty: "RSA", kid: "k1" }] }) : new Response("no");
      },
    });
  });
  afterAll(() => server.stop(true));

  it("says ok for an address that publishes sign-in keys", async () => {
    expect(await checkHubAddress(base())).toBe("ok");
  });

  it("says it is not a Hub when something else answers", async () => {
    const other = Bun.serve({ port: 0, fetch: () => new Response("<html>a website</html>", { status: 200 }) });
    const plain = Bun.serve({ port: 0, fetch: () => Response.json({ hello: "world" }) });
    try {
      expect(await checkHubAddress(`http://127.0.0.1:${other.port}`)).toBe("not_hub");
      expect(await checkHubAddress(`http://127.0.0.1:${plain.port}`)).toBe("not_hub");
    } finally {
      other.stop(true);
      plain.stop(true);
    }
  });

  it("says unreachable when nothing answers", async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response("x") });
    const port = closed.port;
    closed.stop(true);
    expect(await checkHubAddress(`http://127.0.0.1:${port}`)).toBe("unreachable");
  });

  it("refuses to ask where it must not", async () => {
    expect(await checkHubAddress("http://169.254.169.254")).toBe("refused");
    expect(await checkHubAddress("http://metadata.google.internal")).toBe("refused");
    expect(await checkHubAddress("ftp://hub.example.com")).toBe("refused");
    expect(await checkHubAddress("http://user:pass@hub.example.com")).toBe("refused");
    expect(await checkHubAddress("not an address")).toBe("refused");
  });

  describe("GET /api/admin/application-access/hub-address-check", () => {
    beforeAll(async () => {
      await AdminUserTest.delete();
      await MasterDataTest.delete();
      await MasterDataTest.create();
    });
    afterAll(async () => {
      await AdminUserTest.delete();
      await MasterDataTest.delete();
    });

    it("gives only the verdict, to a Super Admin only, and refuses what could not be saved", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin();
      const ask = async (url: string) =>
        (await (await TestRequest.get(`${ACCESS}/hub-address-check?url=${encodeURIComponent(url)}`, accessToken)).json()).data;
      expect(await ask(base())).toEqual({ verdict: "ok" });
      // A path is not part of an address, and a public name over http is not kept, so neither is asked.
      expect(await ask(`${base()}/x`)).toEqual({ verdict: "refused" });
      expect(await ask("http://hub.example.com")).toEqual({ verdict: "refused" });
      expect(await ask("")).toEqual({ verdict: "refused" });

      const { accessToken: other } = await AdminUserTest.createDatabaseAdmin();
      expect((await TestRequest.get(`${ACCESS}/hub-address-check?url=${encodeURIComponent(base())}`, other)).status).toBe(403);
    });
  });
});
