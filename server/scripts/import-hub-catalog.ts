// One time move of the Hub's own catalog into Application Access.
//
//   In the Hub:      bun run export:catalog > catalog.json
//   In Central:      bun run import:hub-catalog catalog.json [--publish] [--dry-run]
//
// Nothing that already exists in Central is touched. Applications start unpublished (unless --publish), so
// they show in the Hub only after roles and groups are set up and they are published.
import { readFileSync } from "fs";
import { isHubIcon } from "../src/constants/hub-icons";
import { prismaClient } from "../src/lib/prisma";
import { resolveOrganizationId } from "../src/service/application-entitlement-service";
import { addressProblem } from "../src/utils/application-id";

type HubRow = {
  id: string;
  name: string;
  icon?: string | null;
  description?: string | null;
  category?: string | null;
  href?: string | null;
  sso_app_id?: string | null;
  sso_entry_url?: string | null;
  sso_logout_url?: string | null;
  sso_central_entitlement_app_id?: string | null;
};

const CATEGORIES = ["reporting", "students", "workplace", "operations", "utilities"];
const ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

export type PlannedApplication = {
  application_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  launch_url: string | null;
  logout_url: string | null;
  launch_mode: "SSO" | "LINK";
  notes: string[];
};

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

// What one Hub row becomes in Central, with a note for everything that had to change.
export function planApplication(row: HubRow): PlannedApplication | { skipped: string } {
  const notes: string[] = [];
  const sso = Boolean(row.sso_app_id && row.sso_entry_url);
  // The application id is the one the Central access is under, so a card linked to Central keeps that id.
  const applicationId = (row.sso_central_entitlement_app_id || row.id).trim();
  if (!ID_PATTERN.test(applicationId) || applicationId === "me") return { skipped: `id "${applicationId}" is not a valid application id` };

  const name = row.name.replace(/\s+/g, " ").trim();
  const trimmedName = clip(name, 60);
  if (trimmedName !== name) notes.push("name shortened to 60 characters");

  const description = (row.description ?? "").replace(/\s+/g, " ").replace(/[<>]/g, "").trim();
  const trimmedDescription = clip(description, 50);
  if (trimmedDescription !== description) notes.push("description shortened to 50 characters");

  let icon: string | null = row.icon ?? null;
  if (icon && !isHubIcon(icon)) {
    notes.push(`icon "${icon}" is not one the Hub can draw, default used`);
    icon = null;
  }
  const category = row.category && CATEGORIES.includes(row.category) ? row.category : null;
  if (row.category && !category) notes.push(`category "${row.category}" is not one of the five, default used`);

  const address = (sso ? row.sso_entry_url : row.href) ?? null;
  let launchUrl = address?.trim() || null;
  const problem = launchUrl ? addressProblem(launchUrl) : null;
  if (problem) {
    notes.push(`launch address not kept: ${problem}`);
    launchUrl = null;
  }
  let logoutUrl = row.sso_logout_url?.trim() || null;
  if (logoutUrl && addressProblem(logoutUrl)) {
    notes.push("logout address not kept");
    logoutUrl = null;
  }
  return {
    application_id: applicationId,
    name: trimmedName,
    description: trimmedDescription || null,
    icon,
    category,
    launch_url: launchUrl,
    logout_url: logoutUrl,
    launch_mode: sso ? "SSO" : "LINK",
    notes,
  };
}

export async function importHubCatalog(rows: HubRow[], options: { publish?: boolean; dryRun?: boolean } = {}) {
  const report = { created: [] as string[], existing: [] as string[], skipped: [] as string[], notes: [] as string[] };
  for (const row of rows) {
    const plan = planApplication(row);
    if ("skipped" in plan) {
      report.skipped.push(`${row.id}: ${plan.skipped}`);
      continue;
    }
    const exists = await prismaClient.application.findUnique({ where: { application_id: plan.application_id } });
    if (exists) {
      report.existing.push(plan.application_id);
      continue;
    }
    for (const note of plan.notes) report.notes.push(`${plan.application_id}: ${note}`);
    if (!options.dryRun) {
      await resolveOrganizationId(plan.application_id);
      await prismaClient.application.create({
        data: {
          application_id: plan.application_id,
          name: plan.name,
          description: plan.description,
          icon: plan.icon,
          category: plan.category,
          launch_url: plan.launch_url,
          logout_url: plan.logout_url,
          launch_mode: plan.launch_mode,
          // Only an application that can be reached is worth publishing from here.
          published: Boolean(options.publish && plan.launch_url),
        },
      });
    }
    report.created.push(plan.application_id);
  }
  return report;
}

if (import.meta.main) {
  const file = process.argv.find((arg, index) => index > 1 && !arg.startsWith("--"));
  if (!file) {
    console.error("Usage: bun run import:hub-catalog <catalog.json> [--publish] [--dry-run]");
    process.exit(1);
  }
  const rows = JSON.parse(readFileSync(file, "utf8")) as HubRow[];
  const dryRun = process.argv.includes("--dry-run");
  const report = await importHubCatalog(rows, { publish: process.argv.includes("--publish"), dryRun });
  console.log(`${dryRun ? "Would create" : "Created"} ${report.created.length}: ${report.created.join(", ") || "-"}`);
  console.log(`Already in Central ${report.existing.length}: ${report.existing.join(", ") || "-"}`);
  for (const line of report.skipped) console.log(`Skipped ${line}`);
  for (const line of report.notes) console.log(`Note ${line}`);
  await prismaClient.$disconnect();
}
