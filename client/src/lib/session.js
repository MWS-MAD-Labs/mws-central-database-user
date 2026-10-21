// First letter of each word in capitals, so a name that was seeded from an email still reads properly.
const capitalize = (text) => text.replace(/(^|[\s'-])(\p{L})/gu, (_, before, letter) => before + letter.toUpperCase())

export function getUserDisplayName(user) {
  const name = user?.full_name || user?.identity?.full_name
  if (name) return capitalize(name.trim())
  const emailName = user?.email?.split('@')[0]
  return emailName ? capitalize(emailName) : 'User'
}

export function getUserEmail(user) {
  return user?.email || user?.identity?.email || ''
}

export function getUserInitials(user) {
  const name = getUserDisplayName(user)
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}
