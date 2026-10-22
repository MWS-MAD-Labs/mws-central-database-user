// "budi.santoso@gmail.com" -> "b***@gmail.com". For showing where the code will go, never the whole address.
export function maskEmail(email) {
  const text = String(email || '').trim()
  const at = text.lastIndexOf('@')
  if (at < 1) return ''
  return `${text[0]}***${text.slice(at)}`
}

export const INSTRUCTION_LANGUAGES = [
  { id: 'id', label: 'Bahasa Indonesia' },
  { id: 'en', label: 'English' },
]

const COPY = {
  id: {
    heading: 'Akun Google Millennia kamu sudah siap',
    account: 'Email',
    recovery: 'Kode dikirim ke',
    stepsHeading: 'Cara masuk pertama kali',
    steps: (recovery) => [
      'Buka accounts.google.com, lalu masukkan email di atas.',
      'Pilih "Lupa sandi" (Forgot password).',
      `Google mengirim kode ke email pemulihan${recovery ? ` (${recovery})` : ''}. Masukkan kodenya.`,
      'Buat sandi baru, minimal 8 karakter dan jangan dipakai di akun lain.',
      'Setelah itu pakai email ini untuk masuk ke Central, Hub, dan aplikasi sekolah.',
    ],
    troubleHeading: 'Kalau kode tidak datang',
    trouble: [
      'Cek folder spam, lalu coba lagi beberapa menit kemudian.',
      'Kalau tetap tidak datang, hubungi admin untuk dibuatkan sandi sementara.',
    ],
    warning: 'Jangan bagikan kode kepada siapa pun.',
  },
  en: {
    heading: 'Your Millennia Google account is ready',
    account: 'Email',
    recovery: 'Code goes to',
    stepsHeading: 'How to sign in the first time',
    steps: (recovery) => [
      'Open accounts.google.com and enter the email above.',
      'Choose "Forgot password".',
      `Google sends a code to your recovery email${recovery ? ` (${recovery})` : ''}. Enter it.`,
      'Set a new password, at least 8 characters and not used on another account.',
      'Then use this email to sign in to Central, Hub, and the school apps.',
    ],
    troubleHeading: 'If the code does not arrive',
    trouble: [
      'Check spam, then try again after a few minutes.',
      'If it still does not arrive, ask an admin for a temporary password.',
    ],
    warning: 'Never share the code with anyone.',
  },
}

// The instructions as data, so the dialog can lay them out and the copy button can flatten them.
export function signInGuide(email, maskedRecovery, language = 'id') {
  const copy = COPY[language] || COPY.id
  return {
    heading: copy.heading,
    account: { label: copy.account, value: email },
    recovery: maskedRecovery ? { label: copy.recovery, value: maskedRecovery } : null,
    stepsHeading: copy.stepsHeading,
    steps: copy.steps(maskedRecovery),
    troubleHeading: copy.troubleHeading,
    trouble: copy.trouble,
    warning: copy.warning,
  }
}

// Plain text with blank lines between blocks, so it survives pasting into WhatsApp or email.
// Nobody has been emailed: Google sends the code only when they ask for it.
export function signInInstructions(email, maskedRecovery, language = 'id') {
  const guide = signInGuide(email, maskedRecovery, language)
  return [
    guide.heading,
    '',
    `${guide.account.label}: ${guide.account.value}`,
    ...(guide.recovery ? [`${guide.recovery.label}: ${guide.recovery.value}`] : []),
    '',
    `${guide.stepsHeading}:`,
    ...guide.steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    `${guide.troubleHeading}:`,
    ...guide.trouble.map((line) => `- ${line}`),
    '',
    guide.warning,
  ].join('\n')
}

const MESSAGE_COPY = {
  id: (name, email, password) => [
    `Halo ${name},`,
    '',
    'Akun Google Millennia kamu sudah dibuat.',
    '',
    `Email: ${email}`,
    `Password sementara: ${password}`,
    '',
    'Cara masuk:',
    '1. Buka accounts.google.com, lalu masuk dengan email dan password sementara di atas.',
    '2. Google meminta kamu membuat password baru. Pakai minimal 8 karakter dan jangan dipakai di akun lain.',
    '3. Setelah itu pakai email ini untuk masuk ke Central, Hub, dan aplikasi sekolah.',
    '',
    'Jangan bagikan password ini kepada siapa pun.',
  ],
  en: (name, email, password) => [
    `Hello ${name},`,
    '',
    'Your Millennia Google account has been made.',
    '',
    `Email: ${email}`,
    `Temporary password: ${password}`,
    '',
    'How to sign in:',
    '1. Open accounts.google.com and sign in with the email and the temporary password above.',
    '2. Google asks you to make a new password. Use at least 8 characters, not used on another account.',
    '3. After that, use this email to sign in to Central, the Hub and the school apps.',
    '',
    'Do not share this password with anyone.',
  ],
}

// The same, for a student: written to the parent or guardian, about the student.
const PARENT_MESSAGE_COPY = {
  id: (parentName, name, email, password) => [
    `Yth. Bapak/Ibu ${parentName},`,
    '',
    `Akun Google Millennia untuk ${name} sudah dibuat.`,
    '',
    `Email: ${email}`,
    `Password sementara: ${password}`,
    '',
    'Cara masuk:',
    '1. Buka accounts.google.com, lalu masuk dengan email dan password sementara di atas.',
    '2. Google meminta password baru. Pakai minimal 8 karakter dan jangan dipakai di akun lain.',
    '3. Setelah itu email ini dipakai untuk masuk ke aplikasi sekolah.',
    '',
    'Mohon password ini dijaga, hanya untuk Bapak/Ibu dan putra/putri Anda.',
  ],
  en: (parentName, name, email, password) => [
    `Dear ${parentName},`,
    '',
    `The Millennia Google account of ${name} has been made.`,
    '',
    `Email: ${email}`,
    `Temporary password: ${password}`,
    '',
    'How to sign in:',
    '1. Open accounts.google.com and sign in with the email and the temporary password above.',
    '2. Google asks for a new password. Choose at least 8 characters, not used on another account.',
    '3. After that, the email is used to sign in to the school apps.',
    '',
    'Please keep this password to yourself and the student.',
  ],
}

// The message for WhatsApp (or anything you paste into): greeting, email, temporary password and the first steps. The
// mail the server sends says the same; the admin can edit this one before copying it. With `parentName` it is the one
// for a student's parent or guardian.
export function signInMessage({ name, email, password, language = 'id', parentName }) {
  if (parentName) return (PARENT_MESSAGE_COPY[language] || PARENT_MESSAGE_COPY.id)(parentName, name || '', email, password).join('\n')
  return (MESSAGE_COPY[language] || MESSAGE_COPY.id)(name || '', email, password).join('\n')
}

// What is wrong with a recovery email, or null. Any clean address works, another mailbox of the organization included;
// the account's own address does not, because the code for a forgotten password cannot be read from that account.
export function recoveryEmailProblem(recoveryEmail, accountEmail, emailProblem) {
  const problem = emailProblem(recoveryEmail, { external: true })
  if (problem) return problem
  if (accountEmail && recoveryEmail.trim().toLowerCase() === accountEmail.trim().toLowerCase()) {
    return "That is the account's own address. Use another mailbox."
  }
  return null
}

// The line under the recovery email field. The address itself is right above it, so it is not repeated: what helps is a
// reminder to read it again, since Google asks nobody to confirm it. `domain` is the organization's, so its own mailboxes
// are named as such.
export function recoveryHint(recoveryEmail, problem, domain) {
  const value = (recoveryEmail || '').trim()
  if (!value || problem) return 'Google sends the reset code here.'
  return value.toLowerCase().endsWith(`@${domain}`)
    ? 'An organization mailbox. Check the spelling.'
    : 'Check the spelling. Nobody confirms it.'
}
