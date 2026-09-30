import { IntegrationEnvironment } from "../generated/prisma/client";

export function getIntegrationEnvironment(): IntegrationEnvironment {
  const value = process.env.DEPLOYMENT_ENVIRONMENT?.trim().toUpperCase();
  if (value && value in IntegrationEnvironment) {
    return IntegrationEnvironment[value as keyof typeof IntegrationEnvironment];
  }
  return IntegrationEnvironment.DEVELOPMENT;
}
