import { Hono } from "hono";
import { AcademicYearApiController } from "../../controller/internal/academic-year-api-controller";
import { requireScope } from "../../middleware/api-client-auth-middleware";
import type { ApiClientVariables } from "../../type/hono-context";
import { API_SCOPES } from "../../constants/api-scopes";

export const academicYearApiRouter = new Hono<{ Variables: ApiClientVariables }>();

// Read with the scope that reads the classes: the active year is what the classes belong to.
academicYearApiRouter.get("/", requireScope(API_SCOPES.CLASSES_READ), (c) => AcademicYearApiController.list(c));
