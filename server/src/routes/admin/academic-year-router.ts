import { Hono } from "hono";
import { AcademicYearController } from "../../controller/admin/academic-year-controller";
import type { AdminVariables } from "../../type/hono-context";

export const academicYearRouter = new Hono<{ Variables: AdminVariables }>();

academicYearRouter.post("/", (c) => AcademicYearController.create(c));
academicYearRouter.post("/bulk", (c) => AcademicYearController.bulkCreate(c));
academicYearRouter.get("/", (c) => AcademicYearController.search(c));
academicYearRouter.patch("/:id", (c) => AcademicYearController.update(c));
academicYearRouter.get("/:id", (c) => AcademicYearController.get(c));
academicYearRouter.get("/:id/unresolved-enrollments", (c) =>
  AcademicYearController.getUnresolvedEnrollmentCount(c),
);
academicYearRouter.get("/:id/out-of-range-enrollments", (c) =>
  AcademicYearController.getOutOfRangeEnrollmentCount(c),
);
academicYearRouter.delete("/:id", (c) => AcademicYearController.remove(c));
