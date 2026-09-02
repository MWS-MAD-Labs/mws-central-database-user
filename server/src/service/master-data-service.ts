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

// PC activities are no longer built on this generic factory - see
// PCActivityMasterService in pc-activity-service.ts, which adds a
// default_mentor_id the {name}-only shape here has no room for.

// Employee.institution_name/major stay free-text (not FKs to these tables) -
// see the schema comment on MasterInstitution. No referenceChecks, so
// removing an entry here never blocks on existing employee data.
export const InstitutionService = createSimpleMasterDataService({
  entityLabel: "institution",
  entityType: "MasterInstitution",
  delegate: (client) => client.masterInstitution,
  referenceChecks: [],
});

export const MajorService = createSimpleMasterDataService({
  entityLabel: "major",
  entityType: "MasterMajor",
  delegate: (client) => client.masterMajor,
  referenceChecks: [],
});
