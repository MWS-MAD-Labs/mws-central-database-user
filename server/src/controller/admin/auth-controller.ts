import type { Context } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type { AdminVariables, EmployeeVariables } from "../../type/hono-context";
import {
  toAdminResponse,
  toEmployeeAuthResponse,
  type GoogleLoginRequest,
} from "../../model/auth-model";
import { AuthService } from "../../service/auth-service";
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
    return c.json({ data: toAdminResponse(admin) });
  }

  static async employeeMe(c: Context<{ Variables: EmployeeVariables }>) {
    const employee = c.var.employee;
    return c.json({ data: toEmployeeAuthResponse(employee) });
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
