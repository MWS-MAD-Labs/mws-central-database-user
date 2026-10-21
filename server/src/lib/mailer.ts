import nodemailer, { type Transporter } from "nodemailer";

export type OutgoingMail = { to: string; subject: string; text: string };

export interface Mailer {
  // False when no SMTP is set up, so the page can say so instead of failing.
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
    await this.transport.sendMail({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text });
  }
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

export function setMailerForTests(mailer: Mailer | null): void {
  override = mailer;
}
