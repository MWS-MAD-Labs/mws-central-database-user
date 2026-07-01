import { ResponseError } from "../error/response-error";
import {
  AdminRole,
  PersonType,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import {
  toEmployeeResponse,
  type CreateEmployeeRequest,
  type EmployeeResponse,
} from "../model/employee-model";
import { EmployeeValidation } from "../validation/employee-validation";
import { Validation } from "../validation/validation";

export class EmployeeService {
  static async create(
    admin: AdminUser,
    request: CreateEmployeeRequest,
  ): Promise<EmployeeResponse> {
    if (
      admin.role !== AdminRole.SUPER_ADMIN &&
      admin.role !== AdminRole.DATABASE_ADMIN
    ) {
      throw new ResponseError(403, "Forbidden: Insufficient permission");
    }

    const createRequest = Validation.validate(
      EmployeeValidation.CREATE,
      request,
    );

    const totalUserWithSameEmail = await prismaClient.person.count({
      where: {
        email: createRequest.email,
      },
    });

    const totalUserWithSameEmployeeId = await prismaClient.employee.count({
      where: {
        employee_id: createRequest.employee_id,
      },
    });

    if (totalUserWithSameEmail !== 0) {
      throw new ResponseError(400, "Email already registered");
    }

    if (totalUserWithSameEmployeeId !== 0) {
      throw new ResponseError(400, "Employee ID already registered");
    }

    const newPerson = await prismaClient.person.create({
      data: {
        full_name: createRequest.full_name,
        nick_name: createRequest.nick_name,
        email: createRequest.email,
        person_type: PersonType.EMPLOYEE,
        gender: createRequest.gender,
        religion: createRequest.religion,
        birth_place: createRequest.birth_place,
        birth_date: new Date(createRequest.birth_date),
        photo_url: createRequest.photo_url,

        employee: {
          create: {
            employee_id: createRequest.employee_id,
            employment_type: createRequest.employment_type,
            unit_id: createRequest.unit_id,
            job_position_id: createRequest.job_position_id,
            job_level_id: createRequest.job_level_id,
            building: createRequest.building,
            join_date: new Date(createRequest.join_date),
            assigned_class: createRequest.assigned_class,
          },
        },
      },
      include: {
        employee: {
          include: {
            unit: true,
            job_position: true,
            job_level: true,
          },
        },
      },
    });

    return toEmployeeResponse(newPerson);
  }
}
