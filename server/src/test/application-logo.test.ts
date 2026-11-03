import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import sharp from "sharp";
import { AdminUserTest, MasterDataTest, TestRequest } from "./test-utils";
import { prismaClient } from "../lib/prisma";
import { LOGO_SIZE, LogoImageError, processLogo } from "../utils/image-processing";
import { ApplicationOnboardingService } from "../service/application-onboarding-service";
import { AuditAction } from "../generated/prisma/client";

const png = (width: number, height: number, color = { r: 200, g: 30, b: 40, alpha: 1 }) =>
  sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();

describe("processLogo", () => {
  it("makes every logo 256 x 256, transparent and WebP, wide or tall", async () => {
    for (const [width, height] of [[800, 200], [200, 800], [300, 300]] as const) {
      const out = await processLogo(await png(width, height));
      const meta = await sharp(out.buffer).metadata();
      expect([meta.format, meta.width, meta.height, meta.hasAlpha]).toEqual(["webp", LOGO_SIZE, LOGO_SIZE, true]);
      expect([out.width, out.height]).toEqual([LOGO_SIZE, LOGO_SIZE]);
    }
  });

  it("fits the picture inside without cropping or stretching, leaving the rest transparent", async () => {
    const out = await processLogo(await png(800, 200));
    const raw = await sharp(out.buffer).ensureAlpha().raw().toBuffer();
    const alphaAt = (x: number, y: number) => raw[(y * LOGO_SIZE + x) * 4 + 3];
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(LOGO_SIZE - 1, LOGO_SIZE - 1)).toBe(0);
    expect(alphaAt(LOGO_SIZE / 2, LOGO_SIZE / 2)).toBe(255);
    // a 4:1 picture is 232 wide and 58 tall: a row far above and below the middle is empty
    expect(alphaAt(LOGO_SIZE / 2, 20)).toBe(0);
    expect(alphaAt(LOGO_SIZE / 2, LOGO_SIZE - 20)).toBe(0);
  });

  it("refuses what is not a usable picture", async () => {
    await expect(processLogo(Buffer.from("not a picture"))).rejects.toBeInstanceOf(LogoImageError);
    const gif = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#fff" } }).gif().toBuffer();
    await expect(processLogo(gif)).rejects.toBeInstanceOf(LogoImageError);
    await expect(processLogo(await png(64, 64))).rejects.toThrow(/too small/);
  });

  const svg = (body: string, size = 'width="1278" height="1295" viewBox="0 0 1278 1295"') =>
    Buffer.from(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ${size}>${body}</svg>`);

  it("takes an SVG: drawn to 256 x 256 transparent WebP, tall or small alike", async () => {
    for (const buffer of [
      svg('<rect width="1278" height="1295" fill="#7e1518"/>'),
      svg('<rect width="40" height="20" fill="#7e1518"/>', 'width="40" height="20"'),
    ]) {
      const out = await processLogo(buffer);
      const meta = await sharp(out.buffer).metadata();
      expect([meta.format, meta.width, meta.height, meta.hasAlpha]).toEqual(["webp", LOGO_SIZE, LOGO_SIZE, true]);
    }
  });

  it("refuses an SVG that runs or reaches out, or has no size", async () => {
    await expect(processLogo(svg("<script>alert(1)</script>"))).rejects.toThrow(/scripts/);
    await expect(processLogo(svg('<foreignObject><div>hi</div></foreignObject>'))).rejects.toThrow(/scripts or embedded/);
    await expect(
      processLogo(Buffer.from('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">&x;</svg>')),
    ).rejects.toBeInstanceOf(LogoImageError);
    await expect(processLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).rejects.toBeInstanceOf(LogoImageError);
  });
});

describe("application logos", () => {
  beforeEach(async () => {
    await AdminUserTest.delete();
    await MasterDataTest.delete();
    await MasterDataTest.create();
    await prismaClient.application.deleteMany({ where: { application_id: { startsWith: "test-logo-" } } });
    await prismaClient.applicationLogo.deleteMany({ where: { name: { startsWith: "TEST_" } } });
  });

  afterEach(async () => {
    await prismaClient.application.deleteMany({ where: { application_id: { startsWith: "test-logo-" } } });
    await prismaClient.applicationLogo.deleteMany({ where: { name: { startsWith: "TEST_" } } });
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  async function upload(accessToken: string, name: string, bytes: Buffer) {
    const form = new FormData();
    form.set("name", name);
    form.set("file", new File([new Uint8Array(bytes)], "logo.png", { type: "image/png" }));
    return TestRequest.postMultipart("/api/admin/application-logos", form, accessToken);
  }

  it("uploads, lists, serves the normalized image and records the audit", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const response = await upload(accessToken, "TEST_Millennia", await png(640, 320));
    expect(response.status).toBe(200);
    const created = (await response.json()).data;
    expect([created.name, created.width, created.height]).toEqual(["TEST_Millennia", 256, 256]);

    const list = await (await TestRequest.get("/api/admin/application-logos", accessToken)).json();
    expect(list.data.map((item: { name: string }) => item.name)).toContain("TEST_Millennia");

    const image = await TestRequest.get(`/api/admin/application-logos/${created.id}/image`, accessToken);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/webp");
    const meta = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);

    const audit = await prismaClient.auditLog.findFirst({ where: { action: AuditAction.CREATE_APPLICATION_LOGO, entity_id: created.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects a repeated name, a fake picture, and anyone but a Super Admin", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    expect((await upload(accessToken, "TEST_One", await png(300, 300))).status).toBe(200);
    expect((await upload(accessToken, "test_one", await png(300, 300))).status).toBe(409);
    const fake = await upload(accessToken, "TEST_Fake", Buffer.from("not a picture"));
    expect(fake.status).toBe(400);
    const { accessToken: other } = await AdminUserTest.createDatabaseAdmin();
    expect((await upload(other, "TEST_Other", await png(300, 300))).status).toBe(403);
  });

  it("renames, and refuses to delete a logo an application uses", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const created = (await (await upload(accessToken, "TEST_Used", await png(300, 300))).json()).data;
    const renamed = await TestRequest.patch(`/api/admin/application-logos/${created.id}`, { name: "TEST_Renamed" }, accessToken);
    expect((await renamed.json()).data.name).toBe("TEST_Renamed");

    await prismaClient.application.create({
      data: { application_id: "test-logo-app", name: "Logo App", logo_id: created.id },
    });
    const blocked = await TestRequest.delete(`/api/admin/application-logos/${created.id}`, accessToken);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).errors).toContain("Logo App");

    await prismaClient.application.update({ where: { application_id: "test-logo-app" }, data: { logo_id: null } });
    expect((await TestRequest.delete(`/api/admin/application-logos/${created.id}`, accessToken)).status).toBe(200);
    expect(await prismaClient.applicationLogo.count({ where: { id: created.id } })).toBe(0);
  });

  it("keeps one picture per application: a logo replaces the icon and an icon replaces the logo", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const admin = await prismaClient.adminUser.findFirstOrThrow({ where: { email: "test_superadmin@millennia21.id" } });
    const logo = (await (await upload(accessToken, "TEST_Pick", await png(300, 300))).json()).data;
    await prismaClient.application.create({ data: { application_id: "test-logo-pick", name: "Pick", icon: "AppWindow" } });

    const withLogo = await ApplicationOnboardingService.update(admin, { application_id: "test-logo-pick", logo_id: logo.id });
    expect([withLogo.logo_id, withLogo.icon]).toEqual([logo.id, null]);

    const withIcon = await ApplicationOnboardingService.update(admin, { application_id: "test-logo-pick", icon: "AppWindow" });
    expect([withIcon.logo_id, withIcon.icon]).toEqual([null, "AppWindow"]);

    await expect(
      ApplicationOnboardingService.update(admin, { application_id: "test-logo-pick", logo_id: "does-not-exist" }),
    ).rejects.toThrow(/does not exist/);
  });

  it("gives the Hub the version of the logo in the catalog and the image itself", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const logo = (await (await upload(accessToken, "TEST_Hub", await png(300, 300))).json()).data;
    await prismaClient.application.create({
      data: { application_id: "test-logo-hub", name: "Hub Logo App", published: true, launch_url: "https://logo.example.org/sso", logo_id: logo.id },
    });
    const published = await ApplicationOnboardingService.listPublished();
    const row = published.find((item) => item.id === "test-logo-hub");
    expect(row?.logo).toEqual({ version: 1 });
    const image = await ApplicationOnboardingService.publishedLogo("test-logo-hub");
    expect(image.contentType).toBe("image/webp");
    await expect(ApplicationOnboardingService.publishedLogo("test-logo-none")).rejects.toThrow(/no logo/);
  });
});
