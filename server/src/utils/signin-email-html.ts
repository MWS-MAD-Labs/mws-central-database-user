import { LOGO_CID, hasLogo } from "./mail-assets";
import type { SignInLanguage } from "./signin-email";

export type SignInKind = "new" | "reset" | "parent";

type Details = { kind: SignInKind; language: SignInLanguage; name: string; email: string; password: string; parentName?: string };

const BURGUNDY = "#7e1518";
const BURGUNDY_DARK = "#681114";
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
    copyPill: "SALIN",
    copy: "Tekan lama password, lalu pilih Salin.",
    button: "Masuk ke Google",
    steps: "Cara masuk",
    warnTitle: "Penting",
    footer: "Email ini dikirim otomatis. Jangan dibalas.",
  },
  en: {
    email: "Email",
    password: "Temporary password",
    copyPill: "COPY",
    copy: "Long-press the password, then tap Copy.",
    button: "Sign in to Google",
    steps: "How to sign in",
    warnTitle: "Important",
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

// The mail as a page: a burgundy header with the school logo, the email and the password in a card (the password in a
// box one tap selects, marked COPY, because a mail cannot run a Copy button), a button to Google with the email filled
// in, the steps and a warning. Tables and inline styles only, since mail apps ignore the rest, plus a dark-mode block for
// the apps that read it. The logo is an inline attachment (cid), which is not blocked like a remote image. The plain
// text goes with it.
export function renderSignInHtml(details: Details): string {
  const common = COMMON[details.language];
  const copy = COPY[details.language][details.kind];
  const link = `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(details.email)}&continue=${encodeURIComponent("https://myaccount.google.com/")}`;
  const font = "font-family:Arial,Helvetica,sans-serif;";
  const mono = "font-family:Consolas,Menlo,'Courier New',monospace;";
  const steps = copy.steps
    .map(
      (step, index) =>
        `<tr><td valign="top" width="40" style="width:40px;min-width:40px;padding:0 14px 12px 0;"><table role="presentation" cellpadding="0" cellspacing="0" style="width:26px;"><tr><td align="center" width="26" height="26" style="width:26px;min-width:26px;height:26px;background:${BURGUNDY};border-radius:13px;${font}font-size:13px;font-weight:700;color:#ffffff;line-height:26px;">${index + 1}</td></tr></table></td><td class="tx" style="${font}padding:2px 0 12px 0;font-size:14px;line-height:1.55;color:${CHARCOAL};">${escapeHtml(step)}</td></tr>`,
    )
    .join("");
  const logo = hasLogo()
    ? `<td width="60" valign="middle" style="padding-right:16px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" style="width:60px;height:60px;background:#ffffff;border-radius:16px;"><img src="cid:${LOGO_CID}" width="44" alt="Millennia" style="display:block;margin:0 auto;border:0;height:auto;"></td></tr></table></td>`
    : "";

  return `<!doctype html>
<html lang="${details.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(copy.title)}</title>
<style>
@media (prefers-color-scheme: dark) {
  .bg-page { background: #140d0e !important; }
  .card { background: #211718 !important; border-color: #3a2a2c !important; }
  .soft { background: #2a1d1f !important; border-color: #3a2a2c !important; }
  .tx { color: #f3e9ea !important; }
  .mu { color: #b9a5a7 !important; }
  .pwbox { background: #140d0e !important; border-color: #d98a8d !important; color: #ffd9da !important; }
  .warn { background: #33191b !important; color: #f3e9ea !important; }
  .line { border-color: #3a2a2c !important; }
}
</style>
</head>
<body class="bg-page" style="margin:0;padding:0;background:#f4eeee;">
<table class="bg-page" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4eeee;padding:28px 12px;">
<tr><td align="center">
<table class="card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:18px;overflow:hidden;">
<tr><td style="background:${BURGUNDY};padding:26px 28px 24px 28px;border-bottom:4px solid ${BURGUNDY_DARK};">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>${logo}<td valign="middle">
<div style="${font}font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#f3d9da;">Millennia World School</div>
<div style="font-family:Georgia,'Times New Roman',serif;font-size:21px;line-height:1.3;font-weight:700;color:#ffffff;margin-top:5px;">${escapeHtml(copy.title)}</div>
</td></tr></table>
</td></tr>
<tr><td style="padding:28px;${font}color:${CHARCOAL};font-size:15px;line-height:1.6;" class="tx">
<p class="tx" style="margin:0 0 6px 0;">${escapeHtml(copy.greeting(details))}</p>
<p class="tx" style="margin:0 0 22px 0;">${escapeHtml(copy.intro(details))}</p>
<table class="soft" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SOFT};border:1px solid ${LINE};border-radius:14px;">
<tr><td style="padding:18px 20px 4px 20px;">
<div class="mu" style="${font}font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;">${escapeHtml(common.email)}</div>
<div class="tx" style="${mono}font-size:16px;font-weight:700;color:${CHARCOAL};word-break:break-all;margin-top:3px;">${escapeHtml(details.email)}</div>
</td></tr>
<tr><td style="padding:16px 20px 20px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td class="mu" style="${font}font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;">${escapeHtml(common.password)}</td>
<td align="right"><span style="display:inline-block;padding:3px 10px;background:${BURGUNDY};border-radius:20px;${font}font-size:10px;font-weight:700;letter-spacing:0.12em;color:#ffffff;">${escapeHtml(common.copyPill)}</span></td>
</tr></table>
<div class="pwbox" style="margin-top:8px;padding:16px 14px;background:#ffffff;border:2px dashed ${BURGUNDY};border-radius:12px;text-align:center;${mono}font-size:20px;font-weight:700;letter-spacing:1px;color:${BURGUNDY};word-break:break-all;-webkit-user-select:all;-moz-user-select:all;user-select:all;">${escapeHtml(details.password)}</div>
<div class="mu" style="${font}font-size:12px;color:${MUTED};margin-top:10px;text-align:center;">${escapeHtml(common.copy)}</div>
</td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px auto 28px auto;">
<tr><td align="center" style="background:${BURGUNDY};border-radius:12px;box-shadow:0 6px 14px rgba(126,21,24,0.28);">
<a href="${escapeHtml(link)}" target="_blank" style="display:inline-block;padding:16px 40px;${font}font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">${escapeHtml(common.button)}</a>
</td></tr>
</table>
<div class="tx" style="${font}font-size:13px;font-weight:700;color:${CHARCOAL};margin-bottom:12px;text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(common.steps)}</div>
<table role="presentation" cellpadding="0" cellspacing="0">${steps}</table>
<table class="warn" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;background:#fdf1f1;border-left:4px solid ${BURGUNDY};border-radius:8px;"><tr>
<td valign="top" style="padding:14px 0 14px 14px;" width="22"><span style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;border-radius:10px;background:${BURGUNDY};${font}font-size:13px;font-weight:700;color:#ffffff;">!</span></td>
<td class="tx" style="padding:13px 14px 13px 10px;${font}font-size:13px;line-height:1.5;color:${CHARCOAL};"><strong>${escapeHtml(common.warnTitle)}.</strong> ${escapeHtml(copy.warning)}</td>
</tr></table>
</td></tr>
<tr><td class="line" style="padding:16px 28px;border-top:1px solid ${LINE};${font}font-size:12px;color:${MUTED};text-align:center;"><span class="mu">${escapeHtml(common.footer)}</span></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
