import type { Context } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { GoogleAuth } from "../../utils/google-auth";
import { AuthService } from "../../service/auth-service";
import { ResponseError } from "../../error/response-error";
import type { AdminVariables } from "../../type/hono-context";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "Strict" as const,
  path: "/",
};

export class AuthController {
  static async redirect(c: Context) {
    const url = GoogleAuth.getAuthUrl();
    return c.redirect(url);
  }

  static async callback(c: Context) {
    const code = c.req.query("code");

    if (!code) {
      throw new ResponseError(400, "Authorization code is missing");
    }

    const { accessToken, refreshToken } = await AuthService.loginWithGoogle(code);

    // Access token: 15 menit
    setCookie(c, "admin_token", accessToken, {
      ...COOKIE_OPTS,
      maxAge: 60 * 15,
    });

    // Refresh token: 7 hari
    setCookie(c, "admin_refresh_token", refreshToken, {
      ...COOKIE_OPTS,
      maxAge: 60 * 60 * 24 * 7,
    });

    const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5173";
    return c.redirect(`${clientUrl}/dashboard`);
  }

  static async refresh(c: Context) {
    const refreshToken = getCookie(c, "admin_refresh_token");

    if (!refreshToken) {
      throw new ResponseError(401, "Refresh token missing");
    }

    const { accessToken } = await AuthService.refresh(refreshToken);

    setCookie(c, "admin_token", accessToken, {
      ...COOKIE_OPTS,
      maxAge: 60 * 15,
    });

    return c.json({ data: "OK" });
  }

  static async me(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const response = await AuthService.me(admin.id);
    return c.json({ data: response });
  }

  static async logout(c: Context) {
    const refreshToken = getCookie(c, "admin_refresh_token");

    if (refreshToken) {
      await AuthService.logout(refreshToken);
    }

    deleteCookie(c, "admin_token", COOKIE_OPTS);
    deleteCookie(c, "admin_refresh_token", COOKIE_OPTS);

    return c.json({ data: "OK" });
  }
}
