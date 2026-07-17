import { AdminRole, type AdminUser } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import {
  toAcademicYearResponse,
  type AcademicYearResponse,
  type AcademicYearSortField,
  type CreateAcademicYearRequest,
  type DeleteAcademicYearRequest,
  type GetAcademicYearRequest,
  type SearchAcademicYearRequest,
  type UpdateAcademicYearRequest,
} from "../model/academic-year-model";
import type { Pageable } from "../model/page-model";
import { AcademicYearValidation } from "../validation/academic-year-validation";
import { Validation } from "../validation/validation";

export class AcademicYearService {
  static async create(
    admin: AdminUser,
    request: CreateAcademicYearRequest,
  ): Promise<AcademicYearResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can create an academic year",
      );
    }

    const createRequest = Validation.validate(
      AcademicYearValidation.CREATE,
      request,
    );

    const existing = await prismaClient.academicYear.findUnique({
      where: { name: createRequest.name },
    });
    if (existing) {
      throw new ResponseError(
        400,
        "An academic year with this name already exists",
      );
    }

    const year = await prismaClient.academicYear.create({
      data: {
        name: createRequest.name,
        start_date: createRequest.start_date
          ? new Date(createRequest.start_date)
          : undefined,
        end_date: createRequest.end_date
          ? new Date(createRequest.end_date)
          : undefined,
        status: createRequest.status,
      },
    });

    return toAcademicYearResponse(year);
  }

  static async update(
    admin: AdminUser,
    request: UpdateAcademicYearRequest,
  ): Promise<AcademicYearResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can update an academic year",
      );
    }

    const updateRequest = Validation.validate(
      AcademicYearValidation.UPDATE,
      request,
    );

    const existing = await prismaClient.academicYear.findUnique({
      where: { id: updateRequest.id },
    });
    if (!existing) {
      throw new ResponseError(404, "Academic year not found");
    }

    if (updateRequest.name && updateRequest.name !== existing.name) {
      const duplicate = await prismaClient.academicYear.findUnique({
        where: { name: updateRequest.name },
      });
      if (duplicate) {
        throw new ResponseError(
          400,
          "An academic year with this name already exists",
        );
      }
    }

    const nextStart = updateRequest.start_date
      ? new Date(updateRequest.start_date)
      : existing.start_date;
    const nextEnd = updateRequest.end_date
      ? new Date(updateRequest.end_date)
      : existing.end_date;
    if (nextStart && nextEnd && nextStart >= nextEnd) {
      throw new ResponseError(400, "start_date must be before end_date");
    }

    const year = await prismaClient.academicYear.update({
      where: { id: updateRequest.id },
      data: {
        name: updateRequest.name,
        start_date: updateRequest.start_date
          ? new Date(updateRequest.start_date)
          : undefined,
        end_date: updateRequest.end_date
          ? new Date(updateRequest.end_date)
          : undefined,
        status: updateRequest.status,
      },
    });

    return toAcademicYearResponse(year);
  }

  static async remove(
    admin: AdminUser,
    request: DeleteAcademicYearRequest,
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete an academic year",
      );
    }

    const deleteRequest = Validation.validate(
      AcademicYearValidation.DELETE,
      request,
    );

    const existing = await prismaClient.academicYear.findUnique({
      where: { id: deleteRequest.id },
    });
    if (!existing) {
      throw new ResponseError(404, "Academic year not found");
    }

    const [classCount, enrollmentCount, studentJoinCount] = await Promise.all([
      prismaClient.class.count({
        where: { academic_year_id: deleteRequest.id },
      }),
      prismaClient.studentClassEnrollment.count({
        where: { academic_year_id: deleteRequest.id },
      }),
      prismaClient.student.count({
        where: { join_academic_year_id: deleteRequest.id },
      }),
    ]);

    const usages: string[] = [];
    if (classCount > 0) usages.push(`${classCount} class(es)`);
    if (enrollmentCount > 0) usages.push(`${enrollmentCount} enrollment(s)`);
    if (studentJoinCount > 0) {
      usages.push(`${studentJoinCount} student(s) who joined in this year`);
    }

    if (usages.length > 0) {
      throw new ResponseError(
        400,
        `Cannot delete: this academic year is still referenced by ${usages.join(", ")}. Reassign or remove those first.`,
      );
    }

    await prismaClient.academicYear.delete({
      where: { id: deleteRequest.id },
    });

    return true;
  }

  static async get(
    admin: AdminUser,
    request: GetAcademicYearRequest,
  ): Promise<AcademicYearResponse> {
    void admin;

    const year = await prismaClient.academicYear.findUnique({
      where: { id: request.id },
    });
    if (!year) {
      throw new ResponseError(404, "Academic year not found");
    }

    return toAcademicYearResponse(year);
  }

  static async search(
    admin: AdminUser,
    request: SearchAcademicYearRequest,
  ): Promise<Pageable<AcademicYearResponse>> {
    void admin;

    const searchRequest = Validation.validate(
      AcademicYearValidation.SEARCH,
      request,
    );

    const skip = (searchRequest.page - 1) * searchRequest.size;
    const where = {
      name: searchRequest.search
        ? { contains: searchRequest.search, mode: "insensitive" as const }
        : undefined,
      status: searchRequest.status,
    };

    const totalItems = await prismaClient.academicYear.count({ where });

    const years = await prismaClient.academicYear.findMany({
      where,
      take: searchRequest.size,
      skip,
      orderBy: buildAcademicYearOrderBy(
        searchRequest.sort_by || "start_date",
        searchRequest.sort_order || "desc",
      ),
    });

    return {
      data: years.map(toAcademicYearResponse),
      paging: {
        size: searchRequest.size,
        current_page: searchRequest.page,
        total_page: Math.ceil(totalItems / searchRequest.size),
        total_item: totalItems,
      },
    };
  }
}

function buildAcademicYearOrderBy(
  sortBy: AcademicYearSortField,
  sortOrder: "asc" | "desc",
) {
  return { [sortBy]: sortOrder };
}
