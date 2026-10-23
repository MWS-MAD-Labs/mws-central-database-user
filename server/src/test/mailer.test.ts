import { describe, expect, it } from "bun:test";
import { readSmtpConfig } from "../lib/mailer";

describe("smtp settings", () => {
  it("is off until a host and a sender are set", () => {
    expect(readSmtpConfig({})).toBeNull();
    expect(readSmtpConfig({ SMTP_HOST: "smtp.gmail.com" })).toBeNull();
    expect(readSmtpConfig({ SMTP_FROM: "no-reply@millennia21.id" })).toBeNull();
  });

  it("reads the block Exima uses", () => {
    expect(
      readSmtpConfig({
        SMTP_HOST: "smtp.gmail.com",
        SMTP_PORT: "465",
        SMTP_SECURE: "true",
        SMTP_USER: "no-reply@millennia21.id",
        SMTP_PASSWORD: "app-password",
        SMTP_FROM: "Central <no-reply@millennia21.id>",
      }),
    ).toEqual({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      from: "Central <no-reply@millennia21.id>",
      user: "no-reply@millennia21.id",
      pass: "app-password",
    });
  });

  it("reads the password as SMTP_PASS too, like MTSS, and prefers SMTP_PASSWORD", () => {
    const base = { SMTP_HOST: "smtp.gmail.com", SMTP_FROM: "a@b.id", SMTP_USER: "a@b.id" };
    expect(readSmtpConfig({ ...base, SMTP_PASS: "from-mtss" })?.pass).toBe("from-mtss");
    expect(readSmtpConfig({ ...base, SMTP_PASS: "old", SMTP_PASSWORD: "new" })?.pass).toBe("new");
  });

  it("uses port 587 unless told, and treats port 465 as secure without SMTP_SECURE", () => {
    const base = { SMTP_HOST: "smtp.gmail.com", SMTP_FROM: "a@b.id" };
    expect(readSmtpConfig(base)).toMatchObject({ port: 587, secure: false });
    expect(readSmtpConfig({ ...base, SMTP_PORT: "465" })).toMatchObject({ port: 465, secure: true });
    expect(readSmtpConfig({ ...base, SMTP_PORT: "2525", SMTP_SECURE: "true" })).toMatchObject({ port: 2525, secure: true });
  });

  it("sends without a login when no user is set (a relay that allows the server's IP)", () => {
    const config = readSmtpConfig({ SMTP_HOST: "smtp-relay.gmail.com", SMTP_FROM: "a@b.id" });
    expect(config?.user).toBeUndefined();
    expect(config?.pass).toBeUndefined();
  });
});
