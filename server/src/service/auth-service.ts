import { sign } from "hono/jwt";
import { randomBytes } from "crypto";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import { GoogleAuth } from "../utils/google-auth";
import { Validation } from "../validation/validation";
import { AuthValidation } from "../validation/auth-validation";
import {
  toAdminResponse,
  toEmployeeAuthResponse,
  type GoogleLoginResponse,
  type GoogleLoginRequest,
  type GoogleLogoutRequest,
  type RefreshRequest,
} from "../model/auth-model";
import { hashToken } from "../utils/hash-token";
import {
  AuditAction,
  AuditSource,
  EmployeeStatus,
  PersonType,
} from "../generated/prisma/client";
import { AuditService } from "./audit-service";
import type { AuditRequestContext } from "../model/audit-log-model";

const ACCESS_TOKEN_EXP = 60 * 15;
const REFRESH_TOKEN_EXP = 7 * 24 * 60 * 60;

export class AuthService {
  static async loginWithGoogle(
    request: GoogleLoginRequest,
    context: AuditRequestContext = {},
  ): Promise<{
    data: GoogleLoginResponse;
    accessToken: string;
    refreshToken?: string;
  }> {
    const validatedRequest = Validation.validate(
      AuthValidation.GOOGLE_LOGIN,
      request,
    );

    const googlePayload = await GoogleAuth.verifyCode(validatedRequest.code);
    if (!googlePayload) {
      await AuditService.record({
        action: AuditAction.LOGIN_FAILED,
        source: AuditSource.UI,
        new_values: { reason: "invalid Google authorization code" },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });
      throw new ResponseError(401, "Invalid Google authorization code.");
    }

    const allowedDomain = process.env.ALLOWED_DOMAIN!;
    if (!googlePayload.email.endsWith(`@${allowedDomain}`)) {
      await AuditService.record({
        action: AuditAction.LOGIN_FAILED,
        source: AuditSource.UI,
        new_values: {
          attempted_email: googlePayload.email,
          reason: "domain not allowed",
        },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });
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

    if (admin && admin.is_active) {
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

      await AuditService.record({
        action: AuditAction.LOGIN,
        source: AuditSource.UI,
        admin_id: updatedAdmin.id,
        new_values: { email: updatedAdmin.email, role: updatedAdmin.role },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });

      return {
        data: toAdminResponse(updatedAdmin),
        accessToken,
        refreshToken,
      };
    }

    const person = await prismaClient.person.findFirst({
      where: {
        email: googlePayload.email,
        person_type: PersonType.EMPLOYEE,
        deleted_at: null,
        employee: {
          status: EmployeeStatus.ACTIVE,
          deleted_at: null,
        },
      },
      include: {
        employee: {
          include: { unit: true, job_position: true, job_level: true },
        },
      },
    });

    if (!person || !person.employee) {
      await AuditService.record({
        action: AuditAction.LOGIN_FAILED,
        source: AuditSource.UI,
        new_values: {
          attempted_email: googlePayload.email,
          reason: "not an active employee",
        },
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });
      throw new ResponseError(
        403,
        "You are not authorized to access this panel.",
      );
    }

    const employeeAccessPayload = {
      id: person.employee.id,
      email: person.email,
      type: "employee" as const,
      exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXP,
    };
    const accessToken = await sign(
      employeeAccessPayload,
      process.env.JWT_SECRET!,
      "HS256",
    );

    // No admin_id/api_client_id - AuditLog has no FK to Employee, this is
    // the best traceability available without a schema change.
    await AuditService.record({
      action: AuditAction.LOGIN,
      source: AuditSource.UI,
      new_values: {
        email: person.email,
        employee_id: person.employee.id,
        type: "employee",
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return {
      data: toEmployeeAuthResponse(person),
      accessToken,
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

  static async logout(
    request: GoogleLogoutRequest,
    context: AuditRequestContext = {},
  ): Promise<void> {
    await prismaClient.adminUser.update({
      where: { id: request.id },
      data: {
        refresh_token_hash: null,
        refresh_token_exp: null,
      },
    });

    await AuditService.record({
      action: AuditAction.LOGOUT,
      source: AuditSource.UI,
      admin_id: request.id,
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });
  }
}
