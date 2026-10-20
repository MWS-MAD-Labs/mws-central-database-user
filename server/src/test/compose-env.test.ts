import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The server only sees the variables docker-compose.yml lists. One that is read in the code but missing there never
// reaches the container, whatever the stack's .env says (DEPLOYMENT_ENVIRONMENT was lost this way and staging named
// its connections DEVELOPMENT).
const OPTIONAL_DEPLOY_VARIABLES = [
  "DEPLOYMENT_ENVIRONMENT",
  "HUB_PUBLIC_URL",
  "HUB_APPLICATION_ID",
  "CENTRAL_API_PUBLIC_URL",
  "IDENTIFIER_CHANGE_APPROVER_EMAILS",
  "OFFICE_HOURS_START",
  "OFFICE_HOURS_END",
  "SATURDAY_DEFAULT_ACTIVE",
  "MINIO_REGION",
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "test" || name === "generated") continue;
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("docker-compose server environment", () => {
  const compose = readFileSync(join(import.meta.dir, "../../../docker-compose.yml"), "utf8");
  const code = sourceFiles(join(import.meta.dir, "..")).map((file) => readFileSync(file, "utf8")).join("\n");

  it("passes on every deployment variable the server reads", () => {
    for (const name of OPTIONAL_DEPLOY_VARIABLES) {
      expect(code).toContain(`process.env.${name}`);
      expect(compose).toContain(`- ${name}=\${${name}:-}`);
    }
  });
});
