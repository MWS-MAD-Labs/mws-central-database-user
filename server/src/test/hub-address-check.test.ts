import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { checkApplicationAddress, checkHubAddress, checkHubSecret } from "../service/hub-address-check";
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

  it("says a Hub has no keys when it is up but cannot publish them", async () => {
    // What the Hub does without HUB_SSO_PRIVATE_KEY: /health is fine, the keys path is a 500.
    const keyless = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/health") return Response.json({ data: "ok" });
        if (path === "/.well-known/jwks.json") return Response.json({ errors: "Internal server error" }, { status: 500 });
        return new Response("not found", { status: 404 });
      },
    });
    // Something else that also fails on the keys path but is not a Hub.
    const broken = Bun.serve({ port: 0, fetch: () => new Response("boom", { status: 500 }) });
    try {
      expect(await checkHubAddress(`http://127.0.0.1:${keyless.port}`)).toBe("no_keys");
      expect(await checkHubAddress(`http://127.0.0.1:${broken.port}`)).toBe("not_hub");
    } finally {
      keyless.stop(true);
      broken.stop(true);
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

    it("exposes the Hub URL configured for this Central environment", async () => {
      await AdminUserTest.delete();
      await MasterDataTest.delete();
      await MasterDataTest.create();
      const previousEnvironment = process.env.DEPLOYMENT_ENVIRONMENT;
      const previousHubUrl = process.env.HUB_PUBLIC_URL;
      process.env.DEPLOYMENT_ENVIRONMENT = "staging";
      process.env.HUB_PUBLIC_URL = "https://app-stg.mws.web.id/";
      try {
        const { accessToken } = await AdminUserTest.createSuperAdmin();
        const response = await TestRequest.get(`${ACCESS}/context`, accessToken);
        expect(response.status).toBe(200);
        expect((await response.json()).data).toEqual({
          environment: "staging",
          suggested_hub_url: "https://app-stg.mws.web.id",
        });
      } finally {
        if (previousEnvironment === undefined) delete process.env.DEPLOYMENT_ENVIRONMENT;
        else process.env.DEPLOYMENT_ENVIRONMENT = previousEnvironment;
        if (previousHubUrl === undefined) delete process.env.HUB_PUBLIC_URL;
        else process.env.HUB_PUBLIC_URL = previousHubUrl;
      }
    });
  });

  describe("hub secret check", () => {
    const SECRET = "a".repeat(32);
    let hub: ReturnType<typeof Bun.serve>;
    beforeAll(() => {
      hub = Bun.serve({
        port: 0,
        fetch(request) {
          const path = new URL(request.url).pathname;
          if (path !== "/sso/secret-check") return new Response("nope", { status: 404 });
          return request.headers.get("x-hub-internal-secret") === SECRET ? Response.json({ data: { ok: true } }) : new Response("no", { status: 401 });
        },
      });
    });
    afterAll(() => hub.stop(true));
    const at = () => `http://127.0.0.1:${hub.port}`;

    it("says ok, wrong, no_check, unreachable or refused", async () => {
      expect(await checkHubSecret(at(), SECRET)).toBe("ok");
      expect(await checkHubSecret(at(), "b".repeat(32))).toBe("wrong");
      expect(await checkHubSecret(base(), SECRET)).toBe("no_check");
      const closed = Bun.serve({ port: 0, fetch: () => new Response("x") });
      const port = closed.port;
      closed.stop(true);
      expect(await checkHubSecret(`http://127.0.0.1:${port}`, SECRET)).toBe("unreachable");
      expect(await checkHubSecret("http://169.254.169.254", SECRET)).toBe("refused");
    });

    it("POST /hub-secret-check gives only the verdict, to a Super Admin only, and cleans a pasted line", async () => {
      await AdminUserTest.delete();
      await MasterDataTest.delete();
      await MasterDataTest.create();
      try {
        const { accessToken } = await AdminUserTest.createSuperAdmin();
        const ask = async (body: object) => {
          const response = await TestRequest.post(`${ACCESS}/hub-secret-check`, body, accessToken);
          return { status: response.status, body: await response.json() };
        };
        const ok = await ask({ address: at(), secret: `HUB_INTERNAL_SECRET="${SECRET}"` });
        expect(ok.body).toEqual({ data: { verdict: "ok" } });
        expect((await ask({ address: at(), secret: "c".repeat(32) })).body).toEqual({ data: { verdict: "wrong" } });
        // Another line of the .env is turned away before anything is asked.
        expect((await ask({ address: at(), secret: 'CENTRAL_API_TOKEN="mws_abc.def"' })).status).toBe(400);
        expect(JSON.stringify(ok.body)).not.toContain(SECRET);

        const { accessToken: other } = await AdminUserTest.createDatabaseAdmin();
        expect((await TestRequest.post(`${ACCESS}/hub-secret-check`, { address: at(), secret: SECRET }, other)).status).toBe(403);
      } finally {
        await AdminUserTest.delete();
        await MasterDataTest.delete();
      }
    });
  });

  describe("application address check", () => {
    it("counts any answer under 500 as up, and a missing or broken one as not", async () => {
      const app = Bun.serve({
        port: 0,
        fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === "/") return new Response("not here", { status: 404 });
          return new Response("x", { status: 200 });
        },
      });
      const redirecting = Bun.serve({ port: 0, fetch: () => new Response("", { status: 302, headers: { Location: "/auth/sso" } }) });
      const broken = Bun.serve({ port: 0, fetch: () => new Response("bad gateway", { status: 502 }) });
      const closed = Bun.serve({ port: 0, fetch: () => new Response("x") });
      const closedPort = closed.port;
      closed.stop(true);
      try {
        expect(await checkApplicationAddress(`http://127.0.0.1:${app.port}`)).toBe("ok");
        expect(await checkApplicationAddress(`http://127.0.0.1:${redirecting.port}`)).toBe("ok");
        expect(await checkApplicationAddress(`http://127.0.0.1:${broken.port}`)).toBe("unreachable");
        expect(await checkApplicationAddress(`http://127.0.0.1:${closedPort}`)).toBe("unreachable");
        expect(await checkApplicationAddress("http://169.254.169.254")).toBe("refused");
        expect(await checkApplicationAddress("ftp://x.example.com")).toBe("refused");
      } finally {
        app.stop(true);
        redirecting.stop(true);
        broken.stop(true);
      }
    });

    it("GET /application-address-check gives only the verdict, to a Super Admin only", async () => {
      await AdminUserTest.delete();
      await MasterDataTest.delete();
      await MasterDataTest.create();
      try {
        const { accessToken } = await AdminUserTest.createSuperAdmin();
        const ask = async (url: string, token = accessToken) => TestRequest.get(`${ACCESS}/application-address-check?url=${encodeURIComponent(url)}`, token);
        expect((await (await ask(base())).json()).data).toEqual({ verdict: "ok" });
        expect((await (await ask("http://app.example.com")).json()).data).toEqual({ verdict: "refused" });
        expect((await (await ask("")).json()).data).toEqual({ verdict: "refused" });
        const { accessToken: other } = await AdminUserTest.createDatabaseAdmin();
        expect((await ask(base(), other)).status).toBe(403);
      } finally {
        await AdminUserTest.delete();
        await MasterDataTest.delete();
      }
    });
  });
});
