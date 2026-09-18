export const MAX_PHOTO_SIZE_BYTES = 15 * 1024 * 1024
export const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024

export const MAX_BULK_PHOTO_BATCH_BYTES = 90 * 1024 * 1024

export const MAX_BULK_PHOTO_BATCH_FILES = 300

export function formatMaxSizeMB(maxBytes) {
  return `${Math.round(maxBytes / (1024 * 1024))}MB`
}

export function validateFileSize(file, maxBytes) {
  if (file.size > maxBytes) {
    return `"${file.name}" is too large. Maximum size is ${formatMaxSizeMB(maxBytes)}.`
  }
  return null
}

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
