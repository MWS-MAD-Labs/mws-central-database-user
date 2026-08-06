import { web } from "./application/web";

web.get("/", (c) => {
  return c.text("Halo, School Center is Running");
});

export default {
  port: 3000,
  fetch: web.fetch,
  // Default is 10s - bulk import commit processes rows sequentially and
  // can take well over that for a few hundred rows.
  idleTimeout: 120,
};
