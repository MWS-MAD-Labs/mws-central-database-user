import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  EmployeeStatus,
  InternStatus,
  PositionCapacityScope,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { assertJobPositionCapacity } from "../utils/job-position-capacity";

describe("job position capacity", () => {
  let positionId: string;
  let elementaryId: string;
  let juniorHighId: string;
  let jobLevelId: string;
  let buildingId: string;

  beforeEach(async () => {
    const [elementary, juniorHigh] = await Promise.all([
      prismaClient.masterUnit.findUniqueOrThrow({ where: { name: "Elementary" } }),
      prismaClient.masterUnit.findUniqueOrThrow({ where: { name: "Junior High" } }),
    ]);
    elementaryId = elementary.id;
    juniorHighId = juniorHigh.id;
    const position = await prismaClient.masterJobPosition.upsert({
      where: { name: "TEST_CAPACITY_PRINCIPAL" },
      update: {
        capacity_scope: PositionCapacityScope.PER_UNIT,
        max_active_holders: 1,
      },
      create: {
        name: "TEST_CAPACITY_PRINCIPAL",
        capacity_scope: PositionCapacityScope.PER_UNIT,
        max_active_holders: 1,
      },
    });
    positionId = position.id;
    jobLevelId = (
      await prismaClient.masterJobLevel.upsert({
        where: { name: "TEST_CAPACITY_LEVEL" },
        update: {},
        create: { name: "TEST_CAPACITY_LEVEL" },
      })
    ).id;
    buildingId = (
      await prismaClient.masterBuilding.upsert({
        where: { name: "TEST_CAPACITY_BUILDING" },
        update: {},
        create: { name: "TEST_CAPACITY_BUILDING" },
      })
    ).id;
    await prismaClient.intern.deleteMany({
      where: { email: { startsWith: "test_capacity_" } },
    });
    await prismaClient.employee.deleteMany({
      where: { person: { email: { startsWith: "test_capacity_" } } },
    });
    await prismaClient.person.deleteMany({
      where: { email: { startsWith: "test_capacity_" } },
    });
  });

  afterEach(async () => {
    await prismaClient.intern.deleteMany({
      where: { email: { startsWith: "test_capacity_" } },
    });
    await prismaClient.employee.deleteMany({
      where: { person: { email: { startsWith: "test_capacity_" } } },
    });
    await prismaClient.person.deleteMany({
      where: { email: { startsWith: "test_capacity_" } },
    });
    await prismaClient.masterJobPosition.deleteMany({
      where: { name: "TEST_CAPACITY_PRINCIPAL" },
    });
    await prismaClient.masterJobLevel.deleteMany({
      where: { name: "TEST_CAPACITY_LEVEL" },
    });
    await prismaClient.masterBuilding.deleteMany({
      where: { name: "TEST_CAPACITY_BUILDING" },
    });
  });

  it("enforces one active holder per unit while allowing another unit", async () => {
    await prismaClient.person.create({
      data: {
        full_name: "Capacity Holder",
        nick_name: "Holder",
        email: "test_capacity_holder@millennia21.id",
        person_type: "EMPLOYEE",
        gender: "MALE",
        religion: "ISLAM",
        birth_place: "Jakarta",
        birth_date: new Date("1990-01-01"),
        employee: {
          create: {
            employee_id: "99.88.001",
            status: EmployeeStatus.ACTIVE,
            employment_type: "PERMANENT",
            marital_status: "SINGLE",
            unit_id: elementaryId,
            job_position_id: positionId,
            job_level_id: jobLevelId,
            building_id: buildingId,
            join_date: new Date("2020-01-01"),
          },
        },
      },
    });

    let blocked: unknown;
    try {
      await prismaClient.$transaction((tx) =>
        assertJobPositionCapacity(tx, {
          jobPositionId: positionId,
          unitId: elementaryId,
          occupiesSlot: true,
        }),
      );
    } catch (error) {
      blocked = error;
    }
    expect(blocked).toBeDefined();

    await expect(
      prismaClient.$transaction((tx) =>
        assertJobPositionCapacity(tx, {
          jobPositionId: positionId,
          unitId: juniorHighId,
          occupiesSlot: true,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("releases the slot when the holder is inactive", async () => {
    const person = await prismaClient.person.create({
      data: {
        full_name: "Inactive Holder",
        nick_name: "Inactive",
        email: "test_capacity_inactive@millennia21.id",
        person_type: "EMPLOYEE",
        gender: "MALE",
        religion: "ISLAM",
        birth_place: "Jakarta",
        birth_date: new Date("1990-01-01"),
        employee: {
          create: {
            employee_id: "99.88.002",
            status: EmployeeStatus.INACTIVE,
            employment_type: "PERMANENT",
            marital_status: "SINGLE",
            unit_id: elementaryId,
            job_position_id: positionId,
            job_level_id: jobLevelId,
            building_id: buildingId,
            join_date: new Date("2020-01-01"),
          },
        },
      },
      include: { employee: true },
    });

    await expect(
      prismaClient.$transaction((tx) =>
        assertJobPositionCapacity(tx, {
          jobPositionId: positionId,
          unitId: elementaryId,
          employeeId: person.employee!.id,
          occupiesSlot: true,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("counts active interns as position holders", async () => {
    await prismaClient.intern.create({
      data: {
        full_name: "Capacity Intern",
        nick_name: "Intern",
        email: "test_capacity_intern@millennia21.id",
        gender: "MALE",
        religion: "ISLAM",
        status: InternStatus.ACTIVE,
        unit_id: elementaryId,
        job_position_id: positionId,
        building_id: buildingId,
        join_date: new Date("2026-01-01"),
        end_date: new Date("2027-01-01"),
      },
    });

    let blocked: unknown;
    try {
      await prismaClient.$transaction((tx) =>
        assertJobPositionCapacity(tx, {
          jobPositionId: positionId,
          unitId: elementaryId,
          occupiesSlot: true,
        }),
      );
    } catch (error) {
      blocked = error;
    }
    expect(blocked).toBeDefined();
  });

  it("enforces a global limit across different units", async () => {
    await prismaClient.masterJobPosition.update({
      where: { id: positionId },
      data: {
        capacity_scope: PositionCapacityScope.GLOBAL,
        max_active_holders: 1,
      },
    });
    await prismaClient.intern.create({
      data: {
        full_name: "Global Capacity Intern",
        nick_name: "Global",
        email: "test_capacity_global@millennia21.id",
        gender: "MALE",
        religion: "ISLAM",
        status: InternStatus.ACTIVE,
        unit_id: elementaryId,
        job_position_id: positionId,
        building_id: buildingId,
        join_date: new Date("2026-01-01"),
        end_date: new Date("2027-01-01"),
      },
    });

    let blocked: unknown;
    try {
      await prismaClient.$transaction((tx) =>
        assertJobPositionCapacity(tx, {
          jobPositionId: positionId,
          unitId: juniorHighId,
          occupiesSlot: true,
        }),
      );
    } catch (error) {
      blocked = error;
    }
    expect(blocked).toBeDefined();
  });
});
