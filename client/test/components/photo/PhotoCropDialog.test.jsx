import { describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../helpers/render.jsx'
import { PhotoCropDialog } from '../../../src/components/photo/PhotoCropDialog.jsx'

describe('PhotoCropDialog', () => {
  it('creates and revokes the preview URL', async () => {
    const createObjectURL = mock(() => 'blob:photo-preview')
    const revokeObjectURL = mock(() => {})
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })

    const { unmount } = renderWithProviders(
      <PhotoCropDialog file={file} onCancel={() => {}} onCropped={() => {}} />,
    )
    await act(async () => { await Promise.resolve() })
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(file))
    expect(screen.getByRole('dialog', { name: 'Crop photo' })).toBeVisible()

    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo-preview')
  })

  it('supports cancel, zoom, and saving states', async () => {
    const onCancel = mock(() => {})
    const { user, rerender } = renderWithProviders(
      <PhotoCropDialog
        file={new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })}
        onCancel={onCancel}
        onCropped={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Save photo' })).toBeDisabled()
    await act(async () => { await Promise.resolve() })

    const zoom = screen.getByRole('slider')
    fireEvent.change(zoom, { target: { value: '2' } })
    expect(zoom).toHaveValue('2')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)

    rerender(
      <PhotoCropDialog
        file={new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })}
        onCancel={onCancel}
        onCropped={() => {}}
        isSaving
      />,
    )
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('button', { name: 'Uploading...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})
