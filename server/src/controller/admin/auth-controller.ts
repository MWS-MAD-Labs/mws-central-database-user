import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import type { GoogleLoginRequest } from "../../model/auth-model";
import { AuthService } from "../../service/auth-service";

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
}
