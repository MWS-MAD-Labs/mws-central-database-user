// Mirrors the backend's own limits - employee/student-photo-service.ts
// (15MB) and file-attachment.ts (5MB) - so an oversized file is caught
// before it's even sent, not after a failed upload round-trip.
export const MAX_PHOTO_SIZE_BYTES = 15 * 1024 * 1024
export const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024

export function formatMaxSizeMB(maxBytes) {
  return `${Math.round(maxBytes / (1024 * 1024))}MB`
}

// Returns an error message if the file is too large, or null if it's fine.
export function validateFileSize(file, maxBytes) {
  if (file.size > maxBytes) {
    return `"${file.name}" is too large. Maximum size is ${formatMaxSizeMB(maxBytes)}.`
  }
  return null
}
