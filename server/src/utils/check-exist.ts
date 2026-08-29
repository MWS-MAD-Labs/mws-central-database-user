import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { Employee, Intern, Person } from "../generated/prisma/client";

export class CheckExist {
  static async checkEmployeeExists(
    id: string,
  ): Promise<Employee & { person: Person }> {
    const employee = await prismaClient.employee.findUnique({
      where: {
        id: id,
        deleted_at: null,
      },
      include: {
        person: true,
      },
    });

    if (!employee) {
      throw new ResponseError(404, "Employee not found");
    }

    return employee;
  }

  static async checkInternExists(
    id: string,
  ): Promise<Intern & { person: Person }> {
    const intern = await prismaClient.intern.findUnique({
      where: {
        id: id,
        deleted_at: null,
      },
      include: {
        person: true,
      },
    });

    if (!intern) {
      throw new ResponseError(404, "Intern not found");
    }

    return intern;
  }
}
