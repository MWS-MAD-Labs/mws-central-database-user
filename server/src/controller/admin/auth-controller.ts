import type { Context } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type { AdminVariables } from "../../type/hono-context";
import {
  toAdminResponse,
  type GoogleLoginRequest,
} from "../../model/auth-model";
import { AuthService } from "../../service/auth-service";
import { ResponseError } from "../../error/response-error";

export class AuthController {
  static async loginWithGoogle(c: Context) {
    try {
      const request = (await c.req.json()) as GoogleLoginRequest;

      const response = await AuthService.loginWithGoogle(request);

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

      setCookie(c, "refresh_token", response.refreshToken, {
        ...cookieOptions,
        maxAge: 60 * 60 * 24 * 7,
      });

      return c.json({ data: response.admin });
    } catch (error) {
      throw error;
    }
  }

  static async me(c: Context<{ Variables: AdminVariables }>) {
    try {
      const admin = c.var.admin;
      return c.json({ data: toAdminResponse(admin) });
    } catch (error) {
      throw error;
    }
  }

  static async refresh(c: Context) {
    try {
      const refreshToken = getCookie(c, "refresh_token");

      if (!refreshToken) {
        throw new ResponseError(401, "Refresh token not found.");
      }

      const accessToken = await AuthService.refresh({ refreshToken });

      setCookie(c, "access_token", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict",
        path: "/",
        maxAge: 60 * 15,
      });

      return c.json({ data: "Token refreshed successfully" });
    } catch (error) {
      throw error;
    }
  }

  static async logout(c: Context<{ Variables: AdminVariables }>) {
    try {
      const admin = c.var.admin;

      await AuthService.logout({ id: admin.id });

      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict" as const,
        path: "/",
      };

      deleteCookie(c, "access_token", cookieOptions);
      deleteCookie(c, "refresh_token", cookieOptions);

      return c.json({ data: "Logged out successfully" });
    } catch (error) {
      throw error;
    }
  }
}
