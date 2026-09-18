import { describe, expect, it } from 'bun:test'
import {
  chunkBulkUploadEntries,
  formatFileSize,
  formatMaxSizeMB,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_BULK_PHOTO_BATCH_BYTES,
  MAX_BULK_PHOTO_BATCH_FILES,
  MAX_PHOTO_SIZE_BYTES,
  validateFileSize,
} from '../../../src/lib/fileSize.js'

describe('file size helpers', () => {
  it('exposes the upload limits and formats them', () => {
    expect(MAX_PHOTO_SIZE_BYTES).toBe(15 * 1024 * 1024)
    expect(MAX_ATTACHMENT_SIZE_BYTES).toBe(5 * 1024 * 1024)
    expect(MAX_BULK_PHOTO_BATCH_BYTES).toBe(90 * 1024 * 1024)
    expect(MAX_BULK_PHOTO_BATCH_FILES).toBe(300)
    expect(formatMaxSizeMB(MAX_PHOTO_SIZE_BYTES)).toBe('15MB')
  })

  it('accepts the exact limit and rejects larger files', () => {
    expect(validateFileSize({ name: 'photo.jpg', size: 100 }, 100)).toBeNull()
    expect(validateFileSize({ name: 'photo.jpg', size: 101 }, 100)).toBe(
      '"photo.jpg" is too large. Maximum size is 0MB.',
    )
  })

  it('chunks entries by byte and file-count limits', () => {
    const entries = [
      { id: 'a', size: 6 },
      { id: 'b', size: 4 },
      { id: 'c', size: 5 },
      { id: 'd', size: 1 },
    ]
    expect(chunkBulkUploadEntries(entries, 10, 10)).toEqual([
      [entries[0], entries[1]],
      [entries[2], entries[3]],
    ])
    expect(chunkBulkUploadEntries(entries, 100, 2)).toEqual([
      [entries[0], entries[1]],
      [entries[2], entries[3]],
    ])
    expect(chunkBulkUploadEntries([], 10, 2)).toEqual([])
  })

  it('keeps a single oversized entry in its own chunk', () => {
    const oversized = { id: 'large', size: 20 }
    expect(chunkBulkUploadEntries([oversized, { id: 'small', size: 1 }], 10, 10)).toEqual([
      [oversized],
      [{ id: 'small', size: 1 }],
    ])
  })

  it('formats byte, kilobyte, and megabyte sizes', () => {
    expect(formatFileSize(0)).toBe('-')
    expect(formatFileSize(500)).toBe('500 B')
    expect(formatFileSize(1536)).toBe('2 KB')
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
  })
})
