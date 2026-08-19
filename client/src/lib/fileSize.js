// Mirrors the backend's own limits - employee/student-photo-service.ts
// (15MB) and file-attachment.ts (5MB) - so an oversized file is caught
// before it's even sent, not after a failed upload round-trip.
export const MAX_PHOTO_SIZE_BYTES = 15 * 1024 * 1024
export const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024

// Mirrors server/src/middleware/upload-body-limit.ts's bulkPhotoUploadBodyLimit
// (90MB, itself under client/nginx.conf's 95MB client_max_body_size, itself
// under Cloudflare's fixed 100MB upload limit on the Free/Pro plan in front
// of everything) - the combined total for one bulk-photo *request*, not the
// whole batch the admin picked - BulkPhotoUploadDialog splits a bigger
// selection into multiple requests under this ceiling automatically.
export const MAX_BULK_PHOTO_BATCH_BYTES = 90 * 1024 * 1024

// Mirrors student/employee-photo-validation.ts's BULK_COMMIT schema (max 300
// files per request) - the other axis a batch gets split on, alongside size.
export const MAX_BULK_PHOTO_BATCH_FILES = 300

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

// Greedily packs ready-to-upload entries into batches that each stay under
// both the byte and file-count ceilings a single bulk-commit request
// accepts, so a bigger selection can go out as several sequential requests
// instead of requiring the admin to manually trim it down to fit one.
export function chunkBulkUploadEntries(
  entries,
  maxBytes = MAX_BULK_PHOTO_BATCH_BYTES,
  maxFiles = MAX_BULK_PHOTO_BATCH_FILES,
) {
  const chunks = []
  let current = []
  let currentBytes = 0
  for (const entry of entries) {
    const wouldOverflow =
      current.length > 0 &&
      (currentBytes + entry.size > maxBytes || current.length + 1 > maxFiles)
    if (wouldOverflow) {
      chunks.push(current)
      current = []
      currentBytes = 0
    }
    current.push(entry)
    currentBytes += entry.size
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

export function formatFileSize(size) {
  if (!size) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
