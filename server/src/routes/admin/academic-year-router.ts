import { Hono } from "hono";
import { AcademicYearController } from "../../controller/admin/academic-year-controller";
import type { AdminVariables } from "../../type/hono-context";

export const academicYearRouter = new Hono<{ Variables: AdminVariables }>();

academicYearRouter.post("/", (c) => AcademicYearController.create(c));
academicYearRouter.get("/", (c) => AcademicYearController.search(c));
academicYearRouter.patch("/:id", (c) => AcademicYearController.update(c));
academicYearRouter.get("/:id", (c) => AcademicYearController.get(c));
academicYearRouter.delete("/:id", (c) => AcademicYearController.remove(c));
