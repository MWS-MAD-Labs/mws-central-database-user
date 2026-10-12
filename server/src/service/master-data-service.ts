import { prismaClient } from "../lib/prisma";
import { slugifyApplicationId } from "../utils/application-id";
import { createSimpleMasterDataService, type SimpleMasterDataDelegate } from "./simple-master-data-service";

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
    {
      label: "grade(s)",
      count: (id) => prismaClient.grade.count({ where: { unit_id: id } }),
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

// Institution and major suggestions are not foreign-key referenced.
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

// What kind of tool an application is, and which product space it belongs to. Applications refer to a row by
// its key, so the key stays when the name is renamed, and a row in use cannot be deleted.
export const ApplicationCategoryService = createSimpleMasterDataService({
  entityLabel: "category",
  entityType: "ApplicationCategory",
  // The key is always sent for these two, which Prisma needs and the shared type leaves optional.
  delegate: (client) => client.applicationCategory as unknown as SimpleMasterDataDelegate,
  keyFrom: slugifyApplicationId,
  referenceChecks: [
    {
      label: "application(s)",
      count: async (id) => {
        const row = await prismaClient.applicationCategory.findUnique({ where: { id } });
        return row ? prismaClient.application.count({ where: { category: row.key } }) : 0;
      },
    },
  ],
});

export const ApplicationScopeService = createSimpleMasterDataService({
  entityLabel: "scope",
  entityType: "ApplicationScope",
  delegate: (client) => client.applicationScope as unknown as SimpleMasterDataDelegate,
  keyFrom: slugifyApplicationId,
  referenceChecks: [
    {
      label: "application(s)",
      count: async (id) => {
        const row = await prismaClient.applicationScope.findUnique({ where: { id } });
        return row ? prismaClient.application.count({ where: { scope: row.key } }) : 0;
      },
    },
  ],
});
