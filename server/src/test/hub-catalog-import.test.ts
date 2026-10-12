import { afterEach, describe, expect, it } from "bun:test";
import { prismaClient } from "../lib/prisma";
import { importHubCatalog, planApplication } from "../../scripts/import-hub-catalog";

const IDS = ["test-imp-link", "test-imp-sso", "test-imp-long"];

describe("importing the Hub catalog", () => {
  afterEach(async () => {
    await prismaClient.applicationOrganization.deleteMany({ where: { application_id: { in: IDS } } });
    await prismaClient.application.deleteMany({ where: { application_id: { in: IDS } } });
  });

  it("plans a plain link and a single sign-on application differently", () => {
    const link = planApplication({ id: "guide", name: "MWS Guide", href: "https://guide.mws.web.id/", category: "workplace", icon: "BookOpen" });
    expect(link).toMatchObject({ application_id: "guide", launch_mode: "LINK", launch_url: "https://guide.mws.web.id/", icon: "BookOpen", category: "workplace" });

    const sso = planApplication({
      id: "emotional-checkin",
      name: "Daily Check-in",
      href: "http://localhost:5174/daily-checkin",
      sso_app_id: "daily-checkin",
      sso_entry_url: "http://localhost:5174/auth/sso",
      sso_logout_url: "http://localhost:5174/auth/logout-silent",
      sso_central_entitlement_app_id: "daily-checkin",
    });
    // The id is the one the Central access is under.
    expect(sso).toMatchObject({ application_id: "daily-checkin", launch_mode: "SSO", launch_url: "http://localhost:5174/auth/sso" });
  });

  it("changes only what Central would refuse, and says so", () => {
    const plan = planApplication({
      id: "tool",
      name: "T".repeat(80),
      description: "x".repeat(80),
      icon: "Cash",
      category: "Finance",
      href: "http://public.example.com/path",
    }) as ReturnType<typeof planApplication> & { notes: string[] };
    expect(plan).toMatchObject({ icon: null, category: "utilities", launch_url: null });
    expect((plan as { name: string }).name.length).toBe(60);
    expect((plan as { description: string }).description.length).toBe(50);
    expect(plan.notes.join(" ")).toContain("name shortened");
    expect(plan.notes.join(" ")).toContain("icon \"Cash\"");
    expect(plan.notes.join(" ")).toContain("category \"Finance\"");
    expect(plan.notes.join(" ")).toContain("launch address not kept");
  });

  it("skips an id Central cannot use", () => {
    expect(planApplication({ id: "Bad Id!", name: "x" })).toEqual({ skipped: 'id "Bad Id!" is not a valid application id' });
  });

  it("creates what is missing, leaves what exists, and publishes only on request", async () => {
    const rows = [
      { id: "test-imp-link", name: "Link App", href: "https://link.example.com/a" },
      { id: "test-imp-sso", name: "Sso App", href: "https://sso.example.com", sso_app_id: "test-imp-sso", sso_entry_url: "https://sso.example.com/auth/sso" },
    ];
    const dry = await importHubCatalog(rows, { dryRun: true });
    expect(dry.created).toEqual(["test-imp-link", "test-imp-sso"]);
    expect(await prismaClient.application.count({ where: { application_id: { in: IDS } } })).toBe(0);

    const first = await importHubCatalog(rows);
    expect(first.created).toEqual(["test-imp-link", "test-imp-sso"]);
    const link = await prismaClient.application.findUniqueOrThrow({ where: { application_id: "test-imp-link" } });
    expect(link).toMatchObject({ launch_mode: "LINK", published: false, name: "Link App" });
    expect((await prismaClient.application.findUniqueOrThrow({ where: { application_id: "test-imp-sso" } })).launch_mode).toBe("SSO");
    expect(await prismaClient.applicationOrganization.count({ where: { application_id: "test-imp-link" } })).toBe(1);

    await prismaClient.application.update({ where: { application_id: "test-imp-link" }, data: { name: "Renamed in Central" } });
    const again = await importHubCatalog(rows, { publish: true });
    expect(again.created).toEqual([]);
    expect(again.existing).toEqual(["test-imp-link", "test-imp-sso"]);
    expect((await prismaClient.application.findUniqueOrThrow({ where: { application_id: "test-imp-link" } })).name).toBe("Renamed in Central");

    const published = await importHubCatalog([{ id: "test-imp-long", name: "Published", href: "https://pub.example.com" }], { publish: true });
    expect(published.created).toEqual(["test-imp-long"]);
    expect((await prismaClient.application.findUniqueOrThrow({ where: { application_id: "test-imp-long" } })).published).toBe(true);
  });
});
