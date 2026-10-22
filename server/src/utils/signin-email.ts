import { signInAttachments } from "./mail-assets";
import { renderSignInHtml } from "./signin-email-html";

export type SignInLanguage = "id" | "en";

// `parentName` is set when the mail goes to a student's parent or guardian: it is written to them, about the student.
type Details = { name: string; email: string; password: string; parentName?: string };

// The mail the server sends for a new Google account. Written here, never taken from the browser, so the endpoint
// cannot be used to send arbitrary text. The WhatsApp text is the same words, written in the client for editing.
export function signInEmail(language: SignInLanguage, { name, email, password, parentName }: Details): { subject: string; text: string; html: string; attachments: ReturnType<typeof signInAttachments> } {
  const mail = signInEmailText(language, { name, email, password, parentName });
  return { ...mail, html: renderSignInHtml({ kind: parentName ? "parent" : "new", language, name, email, password, parentName }), attachments: signInAttachments() };
}

function signInEmailText(language: SignInLanguage, { name, email, password, parentName }: Details): { subject: string; text: string } {
  if (parentName) return parentEmail(language, { parentName, name, email, password });
  if (language === "en") {
    return {
      subject: "Your Millennia Google account is ready",
      text: [
        `Hello ${name},`,
        "",
        "Your Millennia Google account has been made.",
        "",
        `Email: ${email}`,
        `Temporary password: ${password}`,
        "",
        "How to sign in:",
        "1. Open accounts.google.com and sign in with the email and the temporary password above.",
        "2. Google asks you to make a new password. Use at least 8 characters, not used on another account.",
        "3. After that, use this email to sign in to Central, the Hub and the school apps.",
        "",
        "Do not share this password with anyone.",
      ].join("\n"),
    };
  }
  return {
    subject: "Akun Google Millennia kamu sudah siap",
    text: [
      `Halo ${name},`,
      "",
      "Akun Google Millennia kamu sudah dibuat.",
      "",
      `Email: ${email}`,
      `Password sementara: ${password}`,
      "",
      "Cara masuk:",
      "1. Buka accounts.google.com, lalu masuk dengan email dan password sementara di atas.",
      "2. Google meminta kamu membuat password baru. Pakai minimal 8 karakter dan jangan dipakai di akun lain.",
      "3. Setelah itu pakai email ini untuk masuk ke Central, Hub, dan aplikasi sekolah.",
      "",
      "Jangan bagikan password ini kepada siapa pun.",
    ].join("\n"),
  };
}

// The mail for a password that was reset on an account that already existed. Sent to its recovery email.
export function resetPasswordEmail(language: SignInLanguage, details: Omit<Details, "parentName">): { subject: string; text: string; html: string; attachments: ReturnType<typeof signInAttachments> } {
  const mail = resetPasswordText(language, details);
  return { ...mail, html: renderSignInHtml({ kind: "reset", language, ...details }), attachments: signInAttachments() };
}

function resetPasswordText(language: SignInLanguage, { name, email, password }: Omit<Details, "parentName">): { subject: string; text: string } {
  if (language === "en") {
    return {
      subject: "The password of your Millennia Google account was reset",
      text: [
        `Hello ${name},`,
        "",
        "The password of your Millennia Google account was reset by an administrator.",
        "",
        `Email: ${email}`,
        `Temporary password: ${password}`,
        "",
        "Sign in at accounts.google.com with the email and the temporary password above. Google asks you to make a new password.",
        "",
        "If you did not ask for this, tell your administrator. Do not share this password with anyone.",
      ].join("\n"),
    };
  }
  return {
    subject: "Password akun Google Millennia kamu direset",
    text: [
      `Halo ${name},`,
      "",
      "Password akun Google Millennia kamu direset oleh administrator.",
      "",
      `Email: ${email}`,
      `Password sementara: ${password}`,
      "",
      "Masuk di accounts.google.com dengan email dan password sementara di atas. Google akan meminta kamu membuat password baru.",
      "",
      "Kalau kamu tidak memintanya, beri tahu administrator. Jangan bagikan password ini kepada siapa pun.",
    ].join("\n"),
  };
}

function parentEmail(language: SignInLanguage, { parentName, name, email, password }: Required<Pick<Details, "parentName">> & Details) {
  if (language === "en") {
    return {
      subject: `The Millennia Google account of ${name} is ready`,
      text: [
        `Dear ${parentName},`,
        "",
        `The Millennia Google account of ${name} has been made.`,
        "",
        `Email: ${email}`,
        `Temporary password: ${password}`,
        "",
        "How to sign in:",
        "1. Open accounts.google.com and sign in with the email and the temporary password above.",
        "2. Google asks for a new password. Choose at least 8 characters, not used on another account.",
        "3. After that, the email is used to sign in to the school apps.",
        "",
        "Please keep this password to yourself and the student.",
      ].join("\n"),
    };
  }
  return {
    subject: `Akun Google Millennia untuk ${name} sudah siap`,
    text: [
      `Yth. Bapak/Ibu ${parentName},`,
      "",
      `Akun Google Millennia untuk ${name} sudah dibuat.`,
      "",
      `Email: ${email}`,
      `Password sementara: ${password}`,
      "",
      "Cara masuk:",
      "1. Buka accounts.google.com, lalu masuk dengan email dan password sementara di atas.",
      "2. Google meminta password baru. Pakai minimal 8 karakter dan jangan dipakai di akun lain.",
      "3. Setelah itu email ini dipakai untuk masuk ke aplikasi sekolah.",
      "",
      "Mohon password ini dijaga, hanya untuk Bapak/Ibu dan putra/putri Anda.",
    ].join("\n"),
  };
}
