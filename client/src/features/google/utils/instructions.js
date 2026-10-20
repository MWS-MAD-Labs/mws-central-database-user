// "budi.santoso@gmail.com" -> "b***@gmail.com". For showing where the code will go, never the whole address.
export function maskEmail(email) {
  const text = String(email || '').trim()
  const at = text.lastIndexOf('@')
  if (at < 1) return ''
  return `${text[0]}***${text.slice(at)}`
}

// What the new person has to do. Nobody has been emailed: Google sends the code only when they ask for it.
export function signInInstructions(email, maskedRecovery) {
  const where = maskedRecovery ? `to your recovery email (${maskedRecovery})` : 'to your recovery email'
  return [
    `Your Millennia Google account: ${email}`,
    '',
    '1. Open accounts.google.com and enter the email above.',
    '2. Choose "Forgot password".',
    `3. Google sends a code ${where}. Enter it and set your own password.`,
    '',
    'If the code does not arrive, check spam and try again. If it still does not, ask an admin to reset your password.',
  ].join('\n')
}
