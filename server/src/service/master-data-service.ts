import { prismaClient } from "../lib/prisma";
import { createSimpleMasterDataService } from "./simple-master-data-service";

export const UnitService = createSimpleMasterDataService({
  entityLabel: "unit",
  entityType: "MasterUnit",
  delegate: prismaClient.masterUnit,
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

export const JobPositionService = createSimpleMasterDataService({
  entityLabel: "job position",
  entityType: "MasterJobPosition",
  delegate: prismaClient.masterJobPosition,
  referenceChecks: [
    {
      label: "employee(s)",
      count: (id) =>
        prismaClient.employee.count({ where: { job_position_id: id } }),
    },
  ],
});
