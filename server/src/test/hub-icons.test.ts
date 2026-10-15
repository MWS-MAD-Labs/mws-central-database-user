import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { HUB_ICON_NAMES, isHubIcon } from "../constants/hub-icons";
import { parseHubIconNames, renderClientFile, renderServerFile } from "../../scripts/sync-hub-icons";

const SAMPLE = `import { A, B } from "lucide-react";

export const HUB_ICONS: Record<string, LucideIcon> = {
  Alpha,
  Beta,
  Gamma,
};

export const getAppIcon = () => null;
`;

describe("hub icon list", () => {
  it("is not empty and has no name twice", () => {
    expect(HUB_ICON_NAMES.length).toBeGreaterThan(50);
    expect(new Set(HUB_ICON_NAMES).size).toBe(HUB_ICON_NAMES.length);
    expect(isHubIcon("AppWindow")).toBe(true);
    expect(isHubIcon("Cash")).toBe(false);
  });

  it("is the same list in the client file", () => {
    const client = readFileSync(resolve(import.meta.dir, "../../../client/src/features/application-access/utils/hubIcons.js"), "utf8");
    const map = client.slice(client.indexOf("export const HUB_ICONS"), client.indexOf("export const HUB_ICON_NAMES"));
    const names = [...map.matchAll(/^\s{2}([A-Za-z0-9]+),$/gm)].map((match) => match[1]);
    expect(names).toEqual([...HUB_ICON_NAMES] as string[]);
  });

  it("reads the names out of the Hub file", () => {
    expect(parseHubIconNames(SAMPLE)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(() => parseHubIconNames("nothing here")).toThrow();
    expect(() => parseHubIconNames(SAMPLE.replace("Beta", "Alpha"))).toThrow("twice");
  });

  it("writes the generated files from a list", () => {
    const server = renderServerFile(["Alpha", "Beta"]);
    expect(server).toContain('"Alpha",\n  "Beta",\n');
    expect(renderClientFile(["Alpha", "Beta"])).toContain("export const HUB_ICONS = {\n  Alpha,\n  Beta,\n}");
  });

  it("matches the Hub, when the Hub repo is next to this one", () => {
    const hub = resolve(import.meta.dir, "../../../../mws-hub/frontend/src/data/hubCategories.ts");
    if (!existsSync(hub)) return;
    // Out of step: run `bun run sync:hub-icons`.
    expect([...HUB_ICON_NAMES] as string[]).toEqual(parseHubIconNames(readFileSync(hub, "utf8")));
  });
});
