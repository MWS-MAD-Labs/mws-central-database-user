export function getUserDisplayName(user) {
  return user?.full_name || user?.identity?.full_name || user?.email || 'User'
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
