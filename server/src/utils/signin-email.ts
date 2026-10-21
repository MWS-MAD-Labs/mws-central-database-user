export type SignInLanguage = "id" | "en";

type Details = { name: string; email: string; password: string };

// The mail the server sends for a new Google account. Written here, never taken from the browser, so the endpoint
// cannot be used to send arbitrary text. The WhatsApp text is the same words, written in the client for editing.
export function signInEmail(language: SignInLanguage, { name, email, password }: Details): { subject: string; text: string } {
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
