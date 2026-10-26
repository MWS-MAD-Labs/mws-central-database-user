import { Hono } from "hono";
import { AcademicYearController } from "../../controller/admin/academic-year-controller";
import { AcademicSemesterController } from "../../controller/admin/academic-semester-controller";
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
academicYearRouter.get("/:id/semesters", (c) => AcademicSemesterController.list(c));
academicYearRouter.post("/:id/semesters", (c) => AcademicSemesterController.create(c));
academicYearRouter.post("/:id/semesters/defaults", (c) => AcademicSemesterController.createDefaults(c));
academicYearRouter.patch("/semesters/:semesterId", (c) => AcademicSemesterController.update(c));
academicYearRouter.delete("/semesters/:semesterId", (c) => AcademicSemesterController.remove(c));
academicYearRouter.delete("/:id", (c) => AcademicYearController.remove(c));
