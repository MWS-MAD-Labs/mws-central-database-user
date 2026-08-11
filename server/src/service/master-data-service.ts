import { prismaClient } from "../lib/prisma";
import { createSimpleMasterDataService } from "./simple-master-data-service";

export const UnitService = createSimpleMasterDataService({
  entityLabel: "unit",
  entityType: "MasterUnit",
  delegate: (client) => client.masterUnit,
  referenceChecks: [
    {
      label: "employee(s)",
      count: (id) => prismaClient.employee.count({ where: { unit_id: id } }),
    },
    {
      label: "admin user(s)",
      count: (id) => prismaClient.adminUser.count({ where: { unit_id: id } }),
    },
  ],
});

export const BuildingService = createSimpleMasterDataService({
  entityLabel: "building",
  entityType: "MasterBuilding",
  delegate: (client) => client.masterBuilding,
  referenceChecks: [
    {
      label: "employee(s)",
      count: (id) =>
        prismaClient.employee.count({ where: { building_id: id } }),
    },
  ],
});

export const PCActivityMasterService = createSimpleMasterDataService({
  entityLabel: "PC activity",
  entityType: "MasterPCActivity",
  delegate: (client) => client.masterPCActivity,
  referenceChecks: [
    {
      label: "PC activity record(s)",
      count: (id) =>
        prismaClient.passionConnectionActivity.count({
          where: { activity_id: id },
        }),
    },
  ],
});
