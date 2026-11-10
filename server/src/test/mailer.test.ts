import { describe, expect, it } from "bun:test";
import { buildRawMessage, gmailMailerForTests, readGmailConfig, readSmtpConfig } from "../lib/mailer";

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

describe("gmail api mailer", () => {
  it("is off until a sender is set, and names itself Millennia Central by default", () => {
    expect(readGmailConfig({})).toBeNull();
    expect(readGmailConfig({ GMAIL_SENDER_EMAIL: " no-reply@millennia21.id " })).toEqual({ sender: "no-reply@millennia21.id", name: "Millennia Central" });
    expect(readGmailConfig({ GMAIL_SENDER_EMAIL: "a@b.id", GMAIL_SENDER_NAME: "Central" })?.name).toBe("Central");
  });

  it("builds a base64url message with both parts and the inline logo", async () => {
    const raw = await buildRawMessage('"Central" <no-reply@millennia21.id>', {
      to: "person@example.org",
      subject: "Your sign-in details",
      text: "plain body",
      html: "<p>html body</p><img src=\"cid:logo\">",
      attachments: [{ filename: "logo.png", content: Buffer.from("png"), cid: "logo", contentType: "image/png" }],
    });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    expect(mime).toContain("To: person@example.org");
    expect(mime).toContain("Subject: Your sign-in details");
    expect(mime).toContain("no-reply@millennia21.id");
    expect(mime).toContain("text/plain");
    expect(mime).toContain("text/html");
    expect(mime).toContain("Content-ID: <logo>");
  });

  it("hands the built message to the sender and passes its failure on", async () => {
    const sent: string[] = [];
    await gmailMailerForTests("a@b.id", async (raw) => void sent.push(raw)).send({ to: "x@y.id", subject: "s", text: "t" });
    expect(sent).toHaveLength(1);
    await expect(
      gmailMailerForTests("a@b.id", async () => {
        throw new Error("unauthorized_client");
      }).send({ to: "x@y.id", subject: "s", text: "t" }),
    ).rejects.toThrow("unauthorized_client");
  });
});
