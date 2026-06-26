import { sign } from "hono/jwt";
import { randomBytes } from "crypto";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import { GoogleAuth } from "../utils/google-auth";
import { Validation } from "../validation/validation";
import { AuthValidation } from "../validation/auth-validation";
import {
  toAdminResponse,
  type AdminResponse,
  type GoogleLoginRequest,
  type GoogleLogoutRequest,
  type RefreshRequest,
} from "../model/auth-model";
import { hashToken } from "../utils/hash-token";

const ACCESS_TOKEN_EXP = 60 * 15;
const REFRESH_TOKEN_EXP = 7 * 24 * 60 * 60;

export class AuthService {
  static async loginWithGoogle(request: GoogleLoginRequest): Promise<{
    admin: AdminResponse;
    accessToken: string;
    refreshToken: string;
  }> {
    const validatedRequest = Validation.validate(
      AuthValidation.GOOGLE_LOGIN,
      request,
    );

    const googlePayload = await GoogleAuth.verifyCode(validatedRequest.code);
    if (!googlePayload) {
      throw new ResponseError(401, "Invalid Google authorization code.");
    }

    const allowedDomain = process.env.ALLOWED_DOMAIN!;
    if (!googlePayload.email.endsWith(`@${allowedDomain}`)) {
      throw new ResponseError(
        403,
        "Access denied. Only MWS accounts are allowed.",
      );
    }

    const admin = await prismaClient.adminUser.findUnique({
      where: {
        email: googlePayload.email,
      },
    });

    if (!admin) {
      throw new ResponseError(
        403,
        "You are not authorized to access this panel.",
      );
    }

    if (!admin.is_active) {
      throw new ResponseError(403, "Your account has been deactivated.");
    }

    const accessPayload = {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXP,
    };
    const accessToken = await sign(
      accessPayload,
      process.env.JWT_SECRET!,
      "HS256",
    );

    const refreshToken = randomBytes(32).toString("hex");
    const refreshTokenExp = new Date(Date.now() + REFRESH_TOKEN_EXP * 1000);

    const updatedAdmin = await prismaClient.adminUser.update({
      where: { id: admin.id },
      data: {
        google_id: admin.google_id ?? googlePayload.google_id,
        avatar_url: googlePayload.avatar_url,
        last_login: new Date(),
        refresh_token_hash: hashToken(refreshToken),
        refresh_token_exp: refreshTokenExp,
      },
    });

    return {
      admin: toAdminResponse(updatedAdmin),
      accessToken,
      refreshToken,
    };
  }

  static async refresh(
    request: RefreshRequest,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const admin = await prismaClient.adminUser.findFirst({
      where: { refresh_token_hash: hashToken(request.refreshToken) },
    });

    if (!admin) {
      throw new ResponseError(401, "Invalid or expired refresh token.");
    }

    if (!admin.is_active) {
      throw new ResponseError(403, "Your account has been deactivated.");
    }

    if (!admin.refresh_token_exp || admin.refresh_token_exp < new Date()) {
      throw new ResponseError(
        401,
        "Refresh token has expired. Please login again.",
      );
    }

    const accessPayload = {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXP,
    };

    const newRefreshToken = randomBytes(32).toString("hex");
    const newRefreshTokenExp = new Date(Date.now() + REFRESH_TOKEN_EXP * 1000);

    const [accessToken] = await Promise.all([
      sign(accessPayload, process.env.JWT_SECRET!, "HS256"),
      prismaClient.adminUser.update({
        where: { id: admin.id },
        data: {
          refresh_token_hash: hashToken(newRefreshToken),
          refresh_token_exp: newRefreshTokenExp,
          last_login: new Date(),
        },
      }),
    ]);

    return { accessToken, refreshToken: newRefreshToken };
  }

  static async logout(request: GoogleLogoutRequest): Promise<void> {
    await prismaClient.adminUser.update({
      where: { id: request.id },
      data: {
        refresh_token_hash: null,
        refresh_token_exp: null,
      },
    });
  }
}
