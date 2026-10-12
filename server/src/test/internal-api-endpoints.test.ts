import { describe, expect, it } from "bun:test";
import { INTERNAL_API_ENDPOINTS } from "../constants/internal-api-endpoints";
import { internalRouter } from "../routes/internal";

const normalize = (method: string, path: string) =>
  `${method} ${path.split("?")[0]!.replace(/\{[^}]+\}/g, ":p").replace(/:[A-Za-z_]+/g, ":p").replace(/\/+$/, "")}`;

describe("internal API manifest", () => {
  it("lists every internal route, and nothing that is not a route", () => {
    const routes = new Set(
      internalRouter.routes
        .filter((route) => route.method !== "ALL")
        .map((route) => normalize(route.method, `/api/internal${route.path}`)),
    );
    const documented = new Set(INTERNAL_API_ENDPOINTS.map((doc) => normalize(doc.method, doc.path)));

    expect([...routes].filter((route) => !documented.has(route)).sort()).toEqual([]);
    expect([...documented].filter((route) => !routes.has(route)).sort()).toEqual([]);
  });
});
