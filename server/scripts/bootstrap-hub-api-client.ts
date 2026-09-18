import "dotenv/config";
import { prismaClient } from "../src/lib/prisma";
import { generateApiToken } from "../src/utils/generate-api-token";
import { API_SCOPES } from "../src/constants/api-scopes";

const CLIENT_NAME = "MWS Hub";
const SCOPE_NAMES = [API_SCOPES.EMPLOYEES_READ, API_SCOPES.STUDENTS_READ];

async function main() {
  const scopes = await prismaClient.apiScope.findMany({
    where: { name: { in: SCOPE_NAMES } },
  });
  if (scopes.length !== SCOPE_NAMES.length) {
    throw new Error(
      "Missing api_scopes rows - run `bun run seed:api-scopes` first.",
    );
  }

  const generated = generateApiToken();

  const client = await prismaClient.apiClient.upsert({
    where: { name: CLIENT_NAME },
    update: {
      token_prefix: generated.token_prefix,
      token_hash: generated.token_hash,
      is_active: true,
    },
    create: {
      name: CLIENT_NAME,
      description: "mws-hub backend - resolves who signed in via Google against Central",
      token_prefix: generated.token_prefix,
      token_hash: generated.token_hash,
    },
  });

  // Replace prior grants with the required Hub scopes.
  await prismaClient.apiClientScope.deleteMany({ where: { client_id: client.id } });
  await prismaClient.apiClientScope.createMany({
    data: scopes.map((scope) => ({ client_id: client.id, scope_id: scope.id })),
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
