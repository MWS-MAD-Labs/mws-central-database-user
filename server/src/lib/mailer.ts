import { auth, gmail } from "@googleapis/gmail";
import nodemailer, { type Transporter } from "nodemailer";
import { readServiceAccountKey } from "./google-workspace/real-directory-client";

// `html` is the designed version of the same mail; `text` always goes with it for the apps that show no page.
export type MailAttachment = { filename: string; content: Buffer; cid: string; contentType: string };
export type OutgoingMail = { to: string; subject: string; text: string; html?: string; attachments?: MailAttachment[] };

export interface Mailer {
  // False when no email is set up, so the page can say so instead of failing.
  enabled: boolean;
  send(mail: OutgoingMail): Promise<void>;
}

// Used by the tests and by anything run without SMTP in test mode: keeps what would have been sent.
export class MemoryMailer implements Mailer {
  enabled = true;
  outbox: OutgoingMail[] = [];
  async send(mail: OutgoingMail): Promise<void> {
    this.outbox.push(mail);
  }
}

class SmtpMailer implements Mailer {
  enabled = true;
  private transport: Transporter;

  constructor(private from: string, transport: Transporter) {
    this.transport = transport;
  }

  async send(mail: OutgoingMail): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text, ...(mail.html ? { html: mail.html } : {}),
      ...(mail.attachments?.length ? { attachments: mail.attachments } : {}),
    });
  }
}

export type GmailConfig = { sender: string; name: string };

// Same service account as Google Workspace (GOOGLE_WORKSPACE_CREDENTIALS_B64). The account needs the gmail.send scope in
// its domain-wide delegation, the way Woko has it. GMAIL_SENDER_EMAIL turns this on.
export function readGmailConfig(env: Record<string, string | undefined> = process.env): GmailConfig | null {
  const sender = env.GMAIL_SENDER_EMAIL?.trim();
  if (!sender) return null;
  return { sender, name: env.GMAIL_SENDER_NAME?.trim() || "Millennia Central" };
}

const rawBuilder = nodemailer.createTransport({ streamTransport: true, buffer: true });

// The whole message (html, text, inline logo) as the base64url string the Gmail API wants.
export async function buildRawMessage(from: string, mail: OutgoingMail): Promise<string> {
  const built = await rawBuilder.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text, ...(mail.html ? { html: mail.html } : {}),
    ...(mail.attachments?.length ? { attachments: mail.attachments } : {}),
  });
  return Buffer.from(built.message as Buffer).toString("base64url");
}

export type RawSender = (raw: string) => Promise<void>;

class GmailApiMailer implements Mailer {
  enabled = true;

  constructor(private from: string, private sendRaw: RawSender) {}

  async send(mail: OutgoingMail): Promise<void> {
    await this.sendRaw(await buildRawMessage(this.from, mail));
  }
}

function gmailRawSender(sender: string): RawSender {
  const key = readServiceAccountKey(process.env.GOOGLE_WORKSPACE_CREDENTIALS_B64);
  const client = gmail({
    version: "v1",
    auth: new auth.JWT({ email: key.client_email, key: key.private_key, scopes: ["https://www.googleapis.com/auth/gmail.send"], subject: sender }),
  });
  return async (raw) => {
    const response = await client.users.messages.send({ userId: "me", requestBody: { raw } });
    if (!response.data.id) throw new Error("Gmail API did not return a message ID");
  };
}

const disabled: Mailer = {
  enabled: false,
  async send() {
    throw new Error("Email is not set up");
  },
};

let cached: Mailer | null = null;
let override: Mailer | null = null;

export type SmtpConfig = { host: string; port: number; secure: boolean; from: string; user?: string; pass?: string };

// The same names Exima and MTSS use, so their block can be copied: SMTP_HOST and SMTP_FROM turn it on. SMTP_PORT is 587
// unless set, and port 465 is secure without SMTP_SECURE. SMTP_USER and the password (SMTP_PASSWORD, or SMTP_PASS as
// MTSS calls it) are optional, for a relay that does not ask for a login.
export function readSmtpConfig(env: Record<string, string | undefined> = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  const from = env.SMTP_FROM?.trim();
  if (!host || !from) return null;
  const port = Number(env.SMTP_PORT) || 587;
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASSWORD || env.SMTP_PASS || "";
  return { host, port, secure: env.SMTP_SECURE === "true" || port === 465, from, ...(user ? { user, pass } : {}) };
}

export function getMailer(): Mailer {
  if (override) return override;
  if (cached) return cached;

  // Tests never send mail, whatever the .env of the machine says. They bring their own with setMailerForTests.
  if (process.env.NODE_ENV === "test") {
    cached = new MemoryMailer();
    return cached;
  }

  // Gmail API first, SMTP stays for local Mailpit or a future relay.
  const gmailConfig = readGmailConfig();
  if (gmailConfig && process.env.GOOGLE_WORKSPACE_CREDENTIALS_B64?.trim()) {
    cached = new GmailApiMailer(`${JSON.stringify(gmailConfig.name)} <${gmailConfig.sender}>`, gmailRawSender(gmailConfig.sender));
    return cached;
  }

  const config = readSmtpConfig();
  if (!config) {
    cached = disabled;
    return cached;
  }
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user ? { auth: { user: config.user, pass: config.pass ?? "" } } : {}),
  });
  cached = new SmtpMailer(config.from, transport);
  return cached;
}

// Tests reach the Gmail mailer without the network by passing their own sender.
export function gmailMailerForTests(from: string, sendRaw: RawSender): Mailer {
  return new GmailApiMailer(from, sendRaw);
}

export function setMailerForTests(mailer: Mailer | null): void {
  override = mailer;
}
