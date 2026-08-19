// Mirrors the backend's own limits - employee/student-photo-service.ts
// (15MB) and file-attachment.ts (5MB) - so an oversized file is caught
// before it's even sent, not after a failed upload round-trip.
export const MAX_PHOTO_SIZE_BYTES = 15 * 1024 * 1024
export const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024

// Mirrors server/src/middleware/upload-body-limit.ts's bulkPhotoUploadBodyLimit
// (90MB, itself under client/nginx.conf's 95MB client_max_body_size, itself
// under Cloudflare's fixed 100MB upload limit on the Free/Pro plan in front
// of everything) - the combined total for one bulk-photo batch request, not
// any single file.
export const MAX_BULK_PHOTO_BATCH_BYTES = 90 * 1024 * 1024

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

export function formatFileSize(size) {
  if (!size) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
