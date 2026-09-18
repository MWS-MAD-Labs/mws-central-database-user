import { beforeEach, describe, expect, it } from 'bun:test'
import { act, screen } from '@testing-library/react'
import { BulkPhotoUploadStatusBar } from '../../../src/components/layout/BulkPhotoUploadStatusBar.jsx'
import {
  clearBulkPhotoUpload,
  startBulkPhotoUpload,
} from '../../../src/lib/bulkPhotoUploadManager.js'
import { renderWithProviders } from '../../helpers/render.jsx'

function entries(count) {
  return Array.from({ length: count }, (_, index) => ({
    mapping: { file_name: `photo-${index + 1}.jpg` },
    file: new File(['photo'], `photo-${index + 1}.jpg`, { type: 'image/jpeg' }),
  }))
}

beforeEach(() => {
  clearBulkPhotoUpload()
})

describe('BulkPhotoUploadStatusBar', () => {
  it('stays hidden without an upload, then shows running and completed states', async () => {
    const view = renderWithProviders(<BulkPhotoUploadStatusBar />)
    expect(screen.queryByText(/Upload/)).not.toBeInTheDocument()

    let release
    const pendingCommit = new Promise((resolve) => { release = resolve })
    let uploadPromise
    await act(async () => {
      uploadPromise = startBulkPhotoUpload({
        kind: 'employee',
        label: 'employee photos',
        entries: entries(2),
        chunkFn: (items) => [items],
        commitFn: () => pendingCommit,
      })
    })

    expect(screen.getByText('Uploading employee photos...')).toBeVisible()
    expect(screen.getByText('0 of 2 done, 2 remaining')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()

    await act(async () => {
      release({ success_count: 2, failed_count: 0, items: [] })
      await uploadPromise
    })
    expect(screen.getByText('Upload complete')).toBeVisible()
    expect(screen.getByText('2 succeeded, 0 failed')).toBeVisible()
    expect(document.querySelector('[style="width: 100%;"]')).toBeInTheDocument()

    await view.user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Upload complete')).not.toBeInTheDocument()
  })

  it('shows a failed state when every item fails', async () => {
    renderWithProviders(<BulkPhotoUploadStatusBar />)
    await act(async () => {
      await startBulkPhotoUpload({
        kind: 'student',
        label: 'student photos',
        entries: entries(1),
        chunkFn: (items) => [items],
        commitFn: async () => { throw new Error('Unavailable') },
      })
    })

    expect(screen.getByText('Upload failed')).toBeVisible()
    expect(screen.getByText('0 succeeded, 1 failed')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeVisible()
  })

  it('reports a completed upload with mixed item results', async () => {
    renderWithProviders(<BulkPhotoUploadStatusBar />)
    await act(async () => {
      await startBulkPhotoUpload({
        kind: 'student',
        label: 'student photos',
        entries: entries(2),
        chunkFn: (items) => [items],
        commitFn: async () => ({
          success_count: 1,
          failed_count: 1,
          items: [
            { id: 'photo-1.jpg', status: 'SUCCESS' },
            { id: 'photo-2.jpg', status: 'FAILED', error: 'No matching student' },
          ],
        }),
      })
    })

    expect(screen.getByText('Upload complete')).toBeVisible()
    expect(screen.getByText('1 succeeded, 1 failed')).toBeVisible()
    expect(document.querySelector('[style="width: 100%;"]')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeVisible()
  })
})
