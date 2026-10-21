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

// SMTP_HOST and MAIL_FROM turn it on; SMTP_PORT (587), SMTP_SECURE (true for port 465), SMTP_USER and SMTP_PASSWORD
// are optional, for a relay that does not ask for a login.
export function getMailer(): Mailer {
  if (override) return override;
  if (cached) return cached;

  // Tests never send mail, whatever the .env of the machine says. They bring their own with setMailerForTests.
  if (process.env.NODE_ENV === "test") {
    cached = new MemoryMailer();
    return cached;
  }

  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.MAIL_FROM?.trim();
  if (!host || !from) {
    cached = disabled;
    return cached;
  }
  const user = process.env.SMTP_USER?.trim();
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    ...(user ? { auth: { user, pass: process.env.SMTP_PASSWORD ?? "" } } : {}),
  });
  cached = new SmtpMailer(from, transport);
  return cached;
}

export function setMailerForTests(mailer: Mailer | null): void {
  override = mailer;
}
