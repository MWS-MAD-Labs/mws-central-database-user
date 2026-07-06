import { ResponseError } from "../error/response-error";
import {
  AdminRole,
  PersonType,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import {
  toEmployeeDetailResponse,
  toEmployeeResponse,
  type CreateEmployeeRequest,
  type EmployeeDetailResponse,
  type EmployeeResponse,
  type UpdateEmployeeRequest,
} from "../model/employee-model";
import { CheckExist } from "../utils/check-exist";
import { EmployeeValidation } from "../validation/employee-validation";
import { Validation } from "../validation/validation";

export class EmployeeService {
  static async create(
    admin: AdminUser,
    request: CreateEmployeeRequest,
  ): Promise<EmployeeResponse> {
    if (admin.role === AdminRole.VIEWER) {
      throw new ResponseError(403, "Forbidden: Viewer cannot create data");
    }

    if (admin.role === AdminRole.DATABASE_ADMIN) {
      if (!admin.can_create_data) {
        throw new ResponseError(
          403,
          "Forbidden: You don't have permission to create data",
        );
      }

      if (admin.unit_id !== request.unit_id) {
        throw new ResponseError(
          403,
          "Forbidden: You can only create employees within your unit scope",
        );
      }
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
            status: createRequest.status,
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
  static async update(
    admin: AdminUser,
    request: UpdateEmployeeRequest,
  ): Promise<EmployeeResponse> {
    if (admin.role === AdminRole.VIEWER) {
      throw new ResponseError(403, "Forbidden: Viewer cannot update data");
    }

    const updateRequest = Validation.validate(
      EmployeeValidation.UPDATE,
      request,
    );

    const existingEmployee = await CheckExist.checkEmployeeExists(
      updateRequest.id,
    );

    if (admin.role === AdminRole.DATABASE_ADMIN) {
      if (existingEmployee.unit_id !== admin.unit_id) {
        throw new ResponseError(
          403,
          "Forbidden: This employee is outside your unit scope",
        );
      }

      if (updateRequest.unit_id && updateRequest.unit_id !== admin.unit_id) {
        throw new ResponseError(
          403,
          "Forbidden: You cannot transfer an employee to a different unit",
        );
      }
    }

    if (
      updateRequest.email &&
      updateRequest.email !== existingEmployee.person.email
    ) {
      const emailCount = await prismaClient.person.count({
        where: { email: updateRequest.email },
      });
      if (emailCount !== 0) {
        throw new ResponseError(
          400,
          "Email already registered to another person",
        );
      }
    }

    if (
      updateRequest.employee_id &&
      updateRequest.employee_id !== existingEmployee.employee_id
    ) {
      const empIdCount = await prismaClient.employee.count({
        where: { employee_id: updateRequest.employee_id },
      });
      if (empIdCount !== 0) {
        throw new ResponseError(400, "Employee ID already registered");
      }
    }

    const updatedPerson = await prismaClient.person.update({
      where: {
        id: existingEmployee.person_id,
      },
      data: {
        full_name: updateRequest.full_name,
        nick_name: updateRequest.nick_name,
        email: updateRequest.email,
        gender: updateRequest.gender,
        religion: updateRequest.religion,
        birth_place: updateRequest.birth_place,
        birth_date: updateRequest.birth_date
          ? new Date(updateRequest.birth_date)
          : undefined,
        photo_url: updateRequest.photo_url,

        employee: {
          update: {
            employee_id: updateRequest.employee_id,
            employment_type: updateRequest.employment_type,
            status: updateRequest.status,
            unit_id: updateRequest.unit_id,
            job_position_id: updateRequest.job_position_id,
            job_level_id: updateRequest.job_level_id,
            building: updateRequest.building,
            join_date: updateRequest.join_date
              ? new Date(updateRequest.join_date)
              : undefined,
            assigned_class: updateRequest.assigned_class,
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

    return toEmployeeResponse(updatedPerson);
  }

  static async get(
    admin: AdminUser,
    employeeId: string,
  ): Promise<EmployeeResponse | EmployeeDetailResponse> {
    const person = await prismaClient.person.findFirst({
      where: {
        employee: {
          id: employeeId,
          deleted_at: null,
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

    if (!person || !person.employee) {
      throw new ResponseError(404, "Employee not found");
    }

    if (admin.role !== AdminRole.SUPER_ADMIN) {
      if (person.employee.unit_id !== admin.unit_id) {
        throw new ResponseError(404, "Employee not found");
      }
    }

    if (admin.role === AdminRole.SUPER_ADMIN) {
      return toEmployeeDetailResponse(person);
    }

    return toEmployeeResponse(person);
  }
}
