import "dotenv/config";
import { prismaClient } from "../src/lib/prisma";
import { generateApiToken } from "../src/utils/generate-api-token";
import { API_SCOPES } from "../src/constants/api-scopes";
import { syncApiScopes } from "../src/lib/sync-api-scopes";
import { getIntegrationEnvironment } from "../src/utils/integration-environment";

const CLIENT_NAME = "MWS Hub";
const SCOPE_NAMES = [
  API_SCOPES.EMPLOYEES_READ,
  API_SCOPES.STUDENTS_READ,
  API_SCOPES.APPLICATION_ENTITLEMENTS_READ,
];

async function main() {
  await syncApiScopes();
  const profile = await prismaClient.applicationIntegrationProfile.findUniqueOrThrow({
    where: { code: "hub" },
  });

  const generated = generateApiToken();

  const client = await prismaClient.$transaction(async (tx) => {
    const existing = await tx.apiClient.findUnique({ where: { name: CLIENT_NAME } });
    if (existing) {
      await tx.apiClientCredential.updateMany({
        where: { client_id: existing.id, status: { in: ["ACTIVE", "RETIRING"] } },
        data: { status: "REVOKED", revoked_at: new Date() },
      });
    }
    return tx.apiClient.upsert({
      where: { name: CLIENT_NAME },
      update: {
        token_prefix: generated.token_prefix,
        token_hash: generated.token_hash,
        is_active: true,
        status: "ACTIVE",
        disabled_at: null,
        profile_id: profile.id,
        environment: getIntegrationEnvironment(),
        purpose: "backend",
        credentials: {
          create: {
            token_prefix: generated.token_prefix,
            token_hash: generated.token_hash,
          },
        },
      },
      create: {
        name: CLIENT_NAME,
        description: "mws-hub backend - resolves who signed in via Google against Central",
        token_prefix: generated.token_prefix,
        token_hash: generated.token_hash,
        profile_id: profile.id,
        environment: getIntegrationEnvironment(),
        purpose: "backend",
        credentials: {
          create: {
            token_prefix: generated.token_prefix,
            token_hash: generated.token_hash,
          },
        },
      },
    });
  });

  console.log(`Client ready: ${client.name} (${client.id})`);
  console.log(`Scopes: ${SCOPE_NAMES.join(", ")}`);
  console.log("");
  console.log("Token (shown once - copy into mws-hub/backend/.env as CENTRAL_API_TOKEN):");
  console.log(generated.token);
}

main()
  .catch((error) => {
    console.error("Error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
