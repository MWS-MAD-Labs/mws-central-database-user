import type { Context } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type { AdminVariables, EmployeeVariables } from "../../type/hono-context";
import {
  toAdminResponse,
  toEmployeeAuthResponse,
  type GoogleLoginRequest,
} from "../../model/auth-model";
import { EmployeePhotoService } from "../../service/employee-photo-service";
import { AuthService } from "../../service/auth-service";
import { EmployeeService } from "../../service/employee-service";
import { prismaClient } from "../../lib/prisma";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class AuthController {
  static async loginWithGoogle(c: Context) {
    const request = (await c.req.json()) as GoogleLoginRequest;

    const response = await AuthService.loginWithGoogle(
      request,
      getAuditRequestContext(c),
    );

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict" as const,
      path: "/",
    };

    setCookie(c, "access_token", response.accessToken, {
      ...cookieOptions,
      maxAge: 60 * 15,
    });

    if (response.refreshToken) {
      setCookie(c, "refresh_token", response.refreshToken, {
        ...cookieOptions,
        maxAge: 60 * 60 * 24 * 7,
      });
    }

    return c.json({ data: response.data });
  }

  static async me(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    // An admin is made from an employee. When that employee is still held, the Profile shows their record.
    const employee = admin.person_id
      ? await prismaClient.employee.findFirst({ where: { person_id: admin.person_id, deleted_at: null }, select: { id: true } })
      : null;
    return c.json({ data: { ...(await toAdminResponse(admin)), employee_id: employee?.id ?? null } });
  }

  // The signed-in employee's own record for the Profile page, and the identifiers it leaves out once they ask for them.
  static async employeeDetail(c: Context<{ Variables: EmployeeVariables }>) {
    c.header("Cache-Control", "no-store");
    return c.json({ data: await EmployeeService.getOwn(c.var.employee.id) });
  }

  static async employeeRevealPii(c: Context<{ Variables: EmployeeVariables }>) {
    c.header("Cache-Control", "no-store");
    return c.json({ data: await EmployeeService.revealOwnPii(c.var.employee.id, getAuditRequestContext(c)) });
  }

  static async employeeMe(c: Context<{ Variables: EmployeeVariables }>) {
    const employee = c.var.employee;
    return c.json({ data: toEmployeeAuthResponse(employee) });
  }

  // The signed-in employee's own photo. The person is the one in the session, nothing in the request names one.
  static async employeePhoto(c: Context<{ Variables: EmployeeVariables }>) {
    const employee = c.var.employee;
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      throw new ResponseError(400, "A file is required under the 'file' field");
    }
    await EmployeePhotoService.uploadOwn(
      employee.id,
      employee.employee!.id,
      file,
      getAuditRequestContext(c),
    );
    return c.json({ data: true });
  }

  static async employeeLogout(c: Context) {
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict" as const,
      path: "/",
    };

    deleteCookie(c, "access_token", cookieOptions);

    return c.json({ data: "Logged out successfully" });
  }

  static async refresh(c: Context) {
    const refreshToken = getCookie(c, "refresh_token");

    if (!refreshToken) {
      throw new ResponseError(401, "Refresh token not found.");
    }

    const { accessToken, refreshToken: newRefreshToken } =
      await AuthService.refresh({ refreshToken });

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict" as const,
      path: "/",
    };

    setCookie(c, "access_token", accessToken, {
      ...cookieOptions,
      maxAge: 60 * 15,
    });

    setCookie(c, "refresh_token", newRefreshToken, {
      ...cookieOptions,
      maxAge: 60 * 60 * 24 * 7,
    });

    return c.json({ data: "Token refreshed successfully" });
  }

  static async logout(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    await AuthService.logout({ id: admin.id }, getAuditRequestContext(c));

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict" as const,
      path: "/",
    };

    deleteCookie(c, "access_token", cookieOptions);
    deleteCookie(c, "refresh_token", cookieOptions);

    return c.json({ data: "Logged out successfully" });
  }
}
