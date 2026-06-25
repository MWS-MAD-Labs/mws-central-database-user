import { sign } from "hono/jwt";
import { createHash, randomBytes } from "crypto";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import { GoogleAuth } from "../utils/google-auth";
import type { AdminResponse } from "../model/auth-model";

const ACCESS_TOKEN_EXP = 60 * 15;
const REFRESH_TOKEN_EXP = 7 * 24 * 60 * 60;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toAdminResponse(admin: {
  id: string;
  email: string;
  full_name: string;
  role: any;
  avatar_url: string | null;
  unit_scope: string | null;
}): AdminResponse {
  return {
    id: admin.id,
    email: admin.email,
    full_name: admin.full_name,
    role: admin.role,
    avatar_url: admin.avatar_url,
    unit_scope: admin.unit_scope,
  };
}

export class AuthService {
  static async loginWithGoogle(code: string): Promise<{
    admin: AdminResponse;
    accessToken: string;
    refreshToken: string;
  }> {
    const googlePayload = await GoogleAuth.verifyCode(code);
    if (!googlePayload) {
      throw new ResponseError(401, "Invalid Google authorization code");
    }

    const allowedDomain = process.env.ALLOWED_DOMAIN ?? "millennia21.id";
    if (!googlePayload.email.endsWith(`@${allowedDomain}`)) {
      throw new ResponseError(
        403,
        "Access denied. Only MWS accounts are allowed.",
      );
    }

    const admin = await prismaClient.adminUser.findFirst({
      where: { email: googlePayload.email },
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

  static async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    const admin = await prismaClient.adminUser.findFirst({
      where: { refresh_token_hash: hashToken(refreshToken) },
    });

    if (!admin) {
      throw new ResponseError(401, "Invalid refresh token");
    }

    if (!admin.is_active) {
      throw new ResponseError(403, "Your account has been deactivated.");
    }

    if (!admin.refresh_token_exp || admin.refresh_token_exp < new Date()) {
      throw new ResponseError(
        401,
        "Refresh token expired. Please login again.",
      );
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

    return { accessToken };
  }

  static async logout(refreshToken: string): Promise<void> {
    await prismaClient.adminUser.updateMany({
      where: { refresh_token_hash: hashToken(refreshToken) },
      data: {
        refresh_token_hash: null,
        refresh_token_exp: null,
      },
    });
  }

  static async me(adminId: string): Promise<AdminResponse> {
    const admin = await prismaClient.adminUser.findFirst({
      where: { id: adminId, is_active: true },
    });

    if (!admin) {
      throw new ResponseError(404, "Admin not found");
    }

    return toAdminResponse(admin);
  }
}
