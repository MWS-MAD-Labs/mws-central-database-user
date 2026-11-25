import { createHash } from "crypto";
import { prismaClient } from "../lib/prisma";
import type {
  OrganizationUnitApiResponse,
  OrganizationUnitDirectoryVersion,
} from "../model/organization-unit-api-model";

export class OrganizationUnitApiService {
  static async list(): Promise<OrganizationUnitApiResponse[]> {
    const units = await prismaClient.masterUnit.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return units.map((unit) => ({
      id: unit.id,
      name: unit.name,
      parent_unit_id: unit.parent_id,
      created_at: unit.created_at.toISOString(),
      updated_at: unit.updated_at.toISOString(),
    }));
  }

  static async version(): Promise<OrganizationUnitDirectoryVersion> {
    const units = await prismaClient.masterUnit.findMany({
      select: { id: true, name: true, parent_id: true, updated_at: true },
      orderBy: { id: "asc" },
    });
    const key = createHash("sha256")
      .update(JSON.stringify(units.map((unit) => [unit.id, unit.name, unit.parent_id, unit.updated_at.toISOString()])))
      .digest("hex")
      .slice(0, 12);
    return { key, total: units.length };
  }
}
