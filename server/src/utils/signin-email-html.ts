import type { SignInLanguage } from "./signin-email";

export type SignInKind = "new" | "reset" | "parent";

type Details = { kind: SignInKind; language: SignInLanguage; name: string; email: string; password: string; parentName?: string };

const BURGUNDY = "#7e1518";
const CHARCOAL = "#241718";
const MUTED = "#756365";
const LINE = "#eadfe0";
const SOFT = "#fbf7f7";

// Everything that comes from a person (a name, an address) goes through this before it is put in the page.
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const COMMON = {
  id: {
    email: "Email",
    password: "Password sementara",
    copy: "Ketuk password untuk memilih semuanya, lalu salin.",
    button: "Masuk ke Google",
    steps: "Cara masuk",
    footer: "Email ini dikirim otomatis. Jangan dibalas.",
  },
  en: {
    email: "Email",
    password: "Temporary password",
    copy: "Tap the password to select all of it, then copy.",
    button: "Sign in to Google",
    steps: "How to sign in",
    footer: "This email was sent automatically. Please do not reply.",
  },
} as const;

const COPY = {
  id: {
    new: {
      title: "Akun Google Millennia kamu sudah siap",
      greeting: (d: Details) => `Halo ${d.name},`,
      intro: () => "Akun Google Millennia kamu sudah dibuat.",
      steps: [
        "Buka Google dengan tombol di atas, lalu masuk dengan email dan password sementara.",
        "Google meminta password baru. Pakai minimal 8 karakter dan jangan dipakai di akun lain.",
        "Setelah itu pakai email ini untuk masuk ke Central, Hub, dan aplikasi sekolah.",
      ],
      warning: "Jangan bagikan password ini kepada siapa pun.",
    },
    reset: {
      title: "Password akun Google Millennia kamu direset",
      greeting: (d: Details) => `Halo ${d.name},`,
      intro: () => "Password akun Google Millennia kamu direset oleh administrator. Password lama tidak berlaku lagi.",
      steps: [
        "Buka Google dengan tombol di atas, lalu masuk dengan email dan password sementara.",
        "Google meminta password baru. Pakai minimal 8 karakter dan jangan dipakai di akun lain.",
      ],
      warning: "Kalau kamu tidak memintanya, beri tahu administrator. Jangan bagikan password ini kepada siapa pun.",
    },
    parent: {
      title: "Akun Google Millennia siap dipakai",
      greeting: (d: Details) => `Yth. Bapak/Ibu ${d.parentName},`,
      intro: (d: Details) => `Akun Google Millennia untuk ${d.name} sudah dibuat.`,
      steps: [
        "Buka Google dengan tombol di atas, lalu masuk dengan email dan password sementara.",
        "Google meminta password baru. Pakai minimal 8 karakter dan jangan dipakai di akun lain.",
        "Setelah itu email ini dipakai untuk masuk ke aplikasi sekolah.",
      ],
      warning: "Mohon password ini dijaga, hanya untuk Bapak/Ibu dan putra/putri Anda.",
    },
  },
  en: {
    new: {
      title: "Your Millennia Google account is ready",
      greeting: (d: Details) => `Hello ${d.name},`,
      intro: () => "Your Millennia Google account has been made.",
      steps: [
        "Open Google with the button above and sign in with the email and the temporary password.",
        "Google asks you to make a new password. Use at least 8 characters, not used on another account.",
        "After that, use this email to sign in to Central, the Hub and the school apps.",
      ],
      warning: "Do not share this password with anyone.",
    },
    reset: {
      title: "The password of your Millennia Google account was reset",
      greeting: (d: Details) => `Hello ${d.name},`,
      intro: () => "The password of your Millennia Google account was reset by an administrator. The old password no longer works.",
      steps: [
        "Open Google with the button above and sign in with the email and the temporary password.",
        "Google asks you to make a new password. Use at least 8 characters, not used on another account.",
      ],
      warning: "If you did not ask for this, tell your administrator. Do not share this password with anyone.",
    },
    parent: {
      title: "The Millennia Google account is ready",
      greeting: (d: Details) => `Dear ${d.parentName},`,
      intro: (d: Details) => `The Millennia Google account of ${d.name} has been made.`,
      steps: [
        "Open Google with the button above and sign in with the email and the temporary password.",
        "Google asks for a new password. Choose at least 8 characters, not used on another account.",
        "After that, the email is used to sign in to the school apps.",
      ],
      warning: "Please keep this password to yourself and the student.",
    },
  },
} as const;

// The mail as a page: a burgundy header, the email and the password in a card (the password in a box that one tap
// selects), a button to Google with the email filled in, the steps and a warning. A mail cannot run a script, so there
// is no Copy button. Tables and inline styles only, since mail apps ignore the rest. The plain text goes with it.
export function renderSignInHtml(details: Details): string {
  const common = COMMON[details.language];
  const copy = COPY[details.language][details.kind];
  const link = `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(details.email)}&continue=${encodeURIComponent("https://myaccount.google.com/")}`;
  const font = "font-family:Arial,Helvetica,sans-serif;";
  const steps = copy.steps
    .map(
      (step, index) =>
        `<tr><td valign="top" style="${font}padding:0 12px 10px 0;color:${BURGUNDY};font-weight:700;font-size:14px;">${index + 1}.</td><td style="${font}padding:0 0 10px 0;font-size:14px;line-height:1.55;color:${CHARCOAL};">${escapeHtml(step)}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="${details.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(copy.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4eeee;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4eeee;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;overflow:hidden;">
<tr><td style="background:${BURGUNDY};padding:24px 28px;">
<div style="${font}font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#f3d9da;">Millennia</div>
<div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;font-weight:700;color:#ffffff;margin-top:6px;">${escapeHtml(copy.title)}</div>
</td></tr>
<tr><td style="padding:28px;${font}color:${CHARCOAL};font-size:15px;line-height:1.6;">
<p style="margin:0 0 6px 0;">${escapeHtml(copy.greeting(details))}</p>
<p style="margin:0 0 22px 0;">${escapeHtml(copy.intro(details))}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SOFT};border:1px solid ${LINE};border-radius:12px;">
<tr><td style="padding:18px 20px 6px 20px;">
<div style="${font}font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(common.email)}</div>
<div style="font-family:Consolas,Menlo,'Courier New',monospace;font-size:16px;font-weight:700;color:${CHARCOAL};word-break:break-all;margin-top:2px;">${escapeHtml(details.email)}</div>
</td></tr>
<tr><td style="padding:14px 20px 18px 20px;">
<div style="${font}font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(common.password)}</div>
<div style="margin-top:6px;padding:14px 16px;background:#ffffff;border:2px dashed ${BURGUNDY};border-radius:10px;text-align:center;font-family:Consolas,Menlo,'Courier New',monospace;font-size:20px;font-weight:700;letter-spacing:1px;color:${BURGUNDY};word-break:break-all;-webkit-user-select:all;-moz-user-select:all;user-select:all;">${escapeHtml(details.password)}</div>
<div style="${font}font-size:12px;color:${MUTED};margin-top:8px;text-align:center;">${escapeHtml(common.copy)}</div>
</td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 24px auto;">
<tr><td align="center" style="background:${BURGUNDY};border-radius:10px;">
<a href="${escapeHtml(link)}" target="_blank" style="display:inline-block;padding:14px 32px;${font}font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(common.button)}</a>
</td></tr>
</table>
<div style="${font}font-size:13px;font-weight:700;color:${CHARCOAL};margin-bottom:10px;">${escapeHtml(common.steps)}</div>
<table role="presentation" cellpadding="0" cellspacing="0">${steps}</table>
<div style="margin-top:14px;padding:12px 14px;background:#fdf1f1;border-left:4px solid ${BURGUNDY};border-radius:6px;${font}font-size:13px;line-height:1.5;color:${CHARCOAL};">${escapeHtml(copy.warning)}</div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid ${LINE};${font}font-size:12px;color:${MUTED};text-align:center;">${escapeHtml(common.footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
