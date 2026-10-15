import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createPrivateKey, createPublicKey, createSign, createVerify, randomBytes } from "node:crypto";
import { prismaClient } from "../lib/prisma";
import { hubKeyEnvItems } from "../utils/application-env";
import { defaultKid, makeHubSigningKey, pemForEnv, thumbprintOf } from "../utils/hub-signing-key";
import { AdminUserTest, MasterDataTest, TestRequest } from "./test-utils";

const ACCESS = "/api/admin/application-access";

describe("hub signing key", () => {
  it("makes a PKCS#8 key whose thumbprint belongs to the public half", () => {
    const key = makeHubSigningKey("k-test");
    expect(key.kid).toBe("k-test");
    expect(key.privatePem).toStartWith("-----BEGIN PRIVATE KEY-----");
    const jwk = createPublicKey(key.privatePem).export({ format: "jwk" });
    expect(thumbprintOf(jwk)).toBe(key.thumbprint);
    expect(key.thumbprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const signature = createSign("RSA-SHA256").update("hello").sign(key.privatePem);
    expect(createVerify("RSA-SHA256").update("hello").verify(createPublicKey({ key: jwk, format: "jwk" }), signature)).toBe(true);
  });

  it("makes a different key each time and a readable default name", () => {
    expect(makeHubSigningKey().thumbprint).not.toBe(makeHubSigningKey().thumbprint);
    expect(defaultKid(new Date("2026-03-09T00:00:00Z"))).toMatch(/^mws-hub-sso-2026-03-[0-9a-f]{4}$/);
  });

  it("writes the .env line so the Hub reads the same key back, with one backslash before each n", () => {
    const key = makeHubSigningKey();
    const [line] = hubKeyEnvItems(key.kid, pemForEnv(key.privatePem));
    expect(line!.line).not.toContain("\\\\n");
    // What the Hub does with the value it reads from the .env.
    const value = line!.line.slice('HUB_SSO_PRIVATE_KEY="'.length, -1);
    const restored = value.replace(/\\n/g, "\n");
    expect(restored.trim()).toBe(key.privatePem.trim());
    expect(thumbprintOf(createPublicKey(createPrivateKey(restored)).export({ format: "jwk" }))).toBe(key.thumbprint);
  });

  it("writes the PEM on one line and ignores things that are not RSA keys", () => {
    expect(pemForEnv("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n")).toBe("-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----");
    expect(thumbprintOf({ kty: "EC", x: "a", y: "b" })).toBeNull();
    expect(thumbprintOf({})).toBeNull();
  });
});

describe("POST /application-access/hub-signing-key", () => {
  let hubId: string;

  beforeEach(async () => {
    hubId = `test-hubkey-${randomBytes(4).toString("hex")}`;
    process.env.HUB_APPLICATION_ID = hubId;
    await MasterDataTest.create();
  });

  afterEach(async () => {
    delete process.env.HUB_APPLICATION_ID;
    await prismaClient.auditLog.deleteMany({ where: { action: "APPLICATION_HUB_KEY" } });
    await prismaClient.applicationOrganization.deleteMany({ where: { application_id: hubId } });
    await prismaClient.application.deleteMany({ where: { application_id: hubId } });
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("gives the private key once and keeps only its name and thumbprint", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const response = await TestRequest.post(`${ACCESS}/hub-signing-key`, {}, accessToken);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { data } = await response.json();
    expect(data.saved).toBe(false);
    const byKey = Object.fromEntries(data.env.map((item: { key: string }) => [item.key, item]));
    expect(byKey.HUB_SSO_PRIVATE_KEY.secret).toBe(true);
    expect(byKey.HUB_SSO_PRIVATE_KEY.value).toStartWith("-----BEGIN PRIVATE KEY-----\\n");
    expect(byKey.HUB_SSO_PRIVATE_KEY.value).not.toContain("\n");
    expect(byKey.HUB_SSO_KEY_ID.value).toBe(data.kid);

    // The wizard hands the name and thumbprint back when it adds the Hub, and nothing else is kept.
    const added = await TestRequest.post(`${ACCESS}/applications`, { name: "HUB", is_hub: true, hub_signing: { kid: data.kid, thumbprint: data.thumbprint } }, accessToken);
    expect(added.status).toBe(200);
    const row = await prismaClient.application.findUniqueOrThrow({ where: { application_id: hubId } });
    expect(row).toMatchObject({ hub_signing_kid: data.kid, hub_signing_thumbprint: data.thumbprint });
    expect(JSON.stringify(row)).not.toContain("PRIVATE KEY");
  });

  it("asks before replacing a key the Hub already has, and audits without the key", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const first = (await (await TestRequest.post(`${ACCESS}/hub-signing-key`, {}, accessToken)).json()).data;
    await TestRequest.post(`${ACCESS}/applications`, { name: "HUB", is_hub: true, hub_signing: { kid: first.kid, thumbprint: first.thumbprint } }, accessToken);

    expect((await TestRequest.post(`${ACCESS}/hub-signing-key`, {}, accessToken)).status).toBe(409);
    const second = await TestRequest.post(`${ACCESS}/hub-signing-key`, { confirm_replace: true }, accessToken);
    expect(second.status).toBe(200);
    const data = (await second.json()).data;
    expect(data.saved).toBe(true);
    expect(data.thumbprint).not.toBe(first.thumbprint);
    const row = await prismaClient.application.findUniqueOrThrow({ where: { application_id: hubId } });
    expect(row.hub_signing_thumbprint).toBe(data.thumbprint);

    const logs = await prismaClient.auditLog.findMany({ where: { action: "APPLICATION_HUB_KEY" } });
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(logs)).toContain(data.thumbprint);
  });

  it("is for a Super Admin only and rejects a thumbprint that is not one", async () => {
    const { accessToken: other } = await AdminUserTest.createDatabaseAdmin();
    expect((await TestRequest.post(`${ACCESS}/hub-signing-key`, {}, other)).status).toBe(403);
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const bad = await TestRequest.post(`${ACCESS}/applications`, { name: "HUB", is_hub: true, hub_signing: { kid: "k", thumbprint: "short" } }, accessToken);
    expect(bad.status).toBe(400);
  });
});

describe("hub address check with the key Central made", () => {
  let server: ReturnType<typeof Bun.serve>;
  let hubId: string;
  const key = makeHubSigningKey();
  const jwk = { ...createPublicKey(key.privatePem).export({ format: "jwk" }), kid: key.kid, use: "sig", alg: "RS256" };

  beforeEach(async () => {
    hubId = `test-hubkey-${randomBytes(4).toString("hex")}`;
    process.env.HUB_APPLICATION_ID = hubId;
    await MasterDataTest.create();
    server = Bun.serve({ port: 0, fetch: () => Response.json({ keys: [jwk] }) });
  });

  afterEach(async () => {
    server.stop(true);
    delete process.env.HUB_APPLICATION_ID;
    await prismaClient.applicationOrganization.deleteMany({ where: { application_id: hubId } });
    await prismaClient.application.deleteMany({ where: { application_id: hubId } });
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  const ask = async (token: string, thumbprint?: string) =>
    (await (await TestRequest.get(`${ACCESS}/hub-address-check?url=${encodeURIComponent(`http://127.0.0.1:${server.port}`)}${thumbprint ? `&thumbprint=${thumbprint}` : ""}`, token)).json()).data;

  it("says match, mismatch or unknown", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    expect(await ask(accessToken)).toEqual({ verdict: "ok", key: "unknown" });
    expect(await ask(accessToken, key.thumbprint)).toEqual({ verdict: "ok", key: "match" });
    expect(await ask(accessToken, makeHubSigningKey().thumbprint)).toEqual({ verdict: "ok", key: "mismatch" });

    // Once the Hub has a kept thumbprint, no query is needed.
    await prismaClient.application.create({ data: { application_id: hubId, name: "HUB", hub_signing_thumbprint: key.thumbprint } });
    expect(await ask(accessToken)).toEqual({ verdict: "ok", key: "match" });
    await prismaClient.application.update({ where: { application_id: hubId }, data: { hub_signing_thumbprint: makeHubSigningKey().thumbprint } });
    expect(await ask(accessToken)).toEqual({ verdict: "ok", key: "mismatch" });
  });
});

describe("adding an application before the Hub", () => {
  let hubId: string;
  beforeEach(async () => {
    hubId = `test-nohub-${randomBytes(4).toString("hex")}`;
    process.env.HUB_APPLICATION_ID = hubId;
    await MasterDataTest.create();
  });
  afterEach(async () => {
    delete process.env.HUB_APPLICATION_ID;
    await prismaClient.applicationOrganization.deleteMany({ where: { application_id: { in: [hubId, `${hubId}-app`] } } });
    await prismaClient.application.deleteMany({ where: { application_id: { in: [hubId, `${hubId}-app`] } } });
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("is refused until the Hub is added, link applications included", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const body = { application_id: `${hubId}-app`, name: "TEST_App", launch_url: "https://app.example.com/auth/sso" };
    const refused = await TestRequest.post(`${ACCESS}/applications`, body, accessToken);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(await refused.json())).toContain("Add the Hub first");
    const link = await TestRequest.post(`${ACCESS}/applications`, { ...body, launch_mode: "link" }, accessToken);
    expect(link.status).toBe(400);

    expect((await TestRequest.post(`${ACCESS}/applications`, { name: "HUB", is_hub: true }, accessToken)).status).toBe(200);
    expect((await TestRequest.post(`${ACCESS}/applications`, body, accessToken)).status).toBe(200);
  });
});
