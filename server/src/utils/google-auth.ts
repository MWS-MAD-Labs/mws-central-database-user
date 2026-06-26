import { OAuth2Client } from "google-auth-library";
import type { GooglePayload } from "../type/google-type";
import { logger } from "../lib/logger";

export class GoogleAuth {
  private static client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );

  static getAuthUrl(): string {
    return this.client.generateAuthUrl({
      access_type: "offline",
      scope: ["openid", "email", "profile"],
      prompt: "select_account",
    });
  }

  static async verifyCode(code: string): Promise<GooglePayload | null> {
    try {
      const { tokens } = await this.client.getToken(code);
      this.client.setCredentials(tokens);

      const ticket = await this.client.verifyIdToken({
        idToken: tokens.id_token!,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload) return null;

      return {
        email: payload.email!,
        name: payload.name || payload.email!.split("@")[0],
        google_id: payload.sub,
        avatar_url: payload.picture,
      };
    } catch (error) {
      logger.error("Google code exchange failed:", error);
      return null;
    }
  }
}
