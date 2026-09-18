import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import toast from 'react-hot-toast'
import { EmployeeBulkPhotoUploadDialog } from '../../../src/features/employees/components/EmployeeBulkPhotoUploadDialog.jsx'
import { clearBulkPhotoUpload } from '../../../src/lib/bulkPhotoUploadManager.js'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const originalToastError = toast.error

const employees = [
  {
    id: 'employee-ari',
    identity: { full_name: 'Ari Employee' },
    employment: { employee_id: 'EMP-001', unit: 'Elementary' },
  },
  {
    id: 'employee-jordan',
    identity: { full_name: 'Jordan Employee' },
    employment: { employee_id: 'EMP-002', unit: 'Secondary' },
  },
  {
    id: 'employee-photo',
    identity: { full_name: 'Photo Employee' },
    employment: { employee_id: 'EMP-003', unit: 'Operations' },
  },
]

function candidate(id, fullName, hasPhoto = false) {
  return { id, full_name: fullName, has_photo: hasPhoto }
}

function imageFile(name, contents = name) {
  return new File([contents], name, { type: 'image/jpeg' })
}

function rosterPayload() {
  return {
    data: employees,
    paging: { current_page: 1, total_page: 1, total_item: employees.length, size: 100 },
  }
}

function routesFor({ preview, commit = null }) {
  const routes = [
    {
      path: '/api/admin/employees/photos/bulk-preview',
      method: 'POST',
      response: jsonResponse({ data: preview }),
    },
    {
      path: /^\/api\/admin\/employees\?.*$/,
      response: jsonResponse(rosterPayload()),
    },
  ]
  if (commit) {
    routes.push({
      path: '/api/admin/employees/photos/bulk-commit',
      method: 'POST',
      response: commit,
    })
  }
  return routes
}

function renderDialog(routes = []) {
  const fetchMock = createFetchRouter(routes)
  globalThis.fetch = fetchMock
  const result = renderWithProviders(
    <EmployeeBulkPhotoUploadDialog onClose={() => {}} />,
  )
  return { ...result, fetchMock }
}

function fileInput(container) {
  return container.querySelector('input[type="file"]')
}

async function selectFiles(user, container, files) {
  await user.upload(fileInput(container), files)
}

async function completeUpload(button, release) {
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  try {
    await act(async () => {
      fireEvent.click(button)
      release()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  } finally {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  }
}

function installImageStubs() {
  const originalCreateImageBitmap = globalThis.createImageBitmap
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL
  const originalGetContext = HTMLCanvasElement.prototype.getContext
  const originalToBlob = HTMLCanvasElement.prototype.toBlob
  let nextObjectUrl = 0
  const createObjectURL = mock(() => `blob:test-${++nextObjectUrl}`)
  const revokeObjectURL = mock(() => {})
  const bitmapClose = mock(() => {})

  globalThis.createImageBitmap = mock(async () => ({ close: bitmapClose }))
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
  HTMLCanvasElement.prototype.getContext = mock(() => ({ drawImage: mock(() => {}) }))
  HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
    callback(new Blob(['thumbnail'], { type: 'image/jpeg' }))
  }

  return {
    createObjectURL,
    revokeObjectURL,
    bitmapClose,
    restore() {
      if (originalCreateImageBitmap === undefined) delete globalThis.createImageBitmap
      else globalThis.createImageBitmap = originalCreateImageBitmap
      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
      HTMLCanvasElement.prototype.getContext = originalGetContext
      HTMLCanvasElement.prototype.toBlob = originalToBlob
    },
  }
}

let imageStubs = null

beforeEach(() => {
  clearBulkPhotoUpload()
})

afterEach(() => {
  imageStubs?.restore()
  imageStubs = null
  toast.remove()
  toast.error = originalToastError
})

describe('EmployeeBulkPhotoUploadDialog', () => {
  it('ignores an empty selection and rejects duplicate file names before previewing', async () => {
    const errorToast = mock(() => {})
    toast.error = errorToast
    const { container, fetchMock, user } = renderDialog()
    const input = fileInput(container)

    fireEvent.change(input, { target: { files: [] } })
    expect(fetchMock).not.toHaveBeenCalled()

    await user.upload(input, [imageFile('duplicate.jpg', 'first'), imageFile('duplicate.jpg', 'second')])

    expect(errorToast).toHaveBeenCalledWith(
      expect.stringMatching(/1 file name is used more than once: duplicate\.jpg/),
      expect.objectContaining({ id: expect.stringContaining('duplicate.jpg') }),
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText('Click to select photo files')).toBeVisible()
  })

  it('reviews single matches, unmatched files, existing photos, manual assignment, and include toggles', async () => {
    imageStubs = installImageStubs()
    const preview = [
      {
        file_name: 'ari.jpg',
        candidates: [candidate('employee-ari', 'Ari Employee')],
      },
      { file_name: 'unmatched.jpg', candidates: [] },
      {
        file_name: 'has-photo.jpg',
        candidates: [candidate('employee-photo', 'Photo Employee', true)],
      },
    ]
    const { container, user } = renderDialog(routesFor({ preview }))

    await selectFiles(user, container, preview.map((item) => imageFile(item.file_name)))

    expect(await screen.findByText('1 of 3 file(s) ready to upload. Fix any unmatched or ambiguous rows below, or uncheck to skip.')).toBeVisible()
    expect(screen.getByText('No match')).toBeVisible()
    expect(screen.getByText('Has photo')).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'Include unmatched.jpg' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Include has-photo.jpg' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Upload 1 photo(s)' })).toBeEnabled()
    await waitFor(() => expect(imageStubs.createObjectURL).toHaveBeenCalledTimes(3))

    const selects = await screen.findAllByRole('button', { name: 'Select employee' })
    await user.click(selects[0])
    await user.click(await screen.findByRole('option', { name: /Jordan Employee/ }))

    expect(screen.getByText('2 of 3 file(s) ready to upload. Fix any unmatched or ambiguous rows below, or uncheck to skip.')).toBeVisible()
    const unmatchedInclude = screen.getByRole('checkbox', { name: 'Include unmatched.jpg' })
    expect(unmatchedInclude).toBeChecked()
    await user.click(unmatchedInclude)
    expect(screen.getByRole('button', { name: 'Upload 1 photo(s)' })).toBeVisible()
    await user.click(unmatchedInclude)
    expect(screen.getByRole('button', { name: 'Upload 2 photo(s)' })).toBeVisible()
  })

  it('shows review counts, paginates files, and filters down to unmatched rows', async () => {
    imageStubs = installImageStubs()
    const preview = Array.from({ length: 12 }, (_, index) => ({
      file_name: `employee-${String(index + 1).padStart(2, '0')}.jpg`,
      candidates: index === 11
        ? []
        : [candidate('employee-ari', 'Ari Employee')],
    }))
    const { container, user } = renderDialog(routesFor({ preview }))

    await selectFiles(user, container, preview.map((item) => imageFile(item.file_name)))

    expect(await screen.findByText(/11 of 12 file\(s\) ready to upload/)).toBeVisible()
    expect(screen.getByText('Page 1 of 2 / 12 files')).toBeVisible()
    expect(screen.getByText('employee-01.jpg')).toBeVisible()
    expect(screen.queryByText('employee-11.jpg')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Page 2 of 2 / 12 files')).toBeVisible()
    expect(screen.getByText('employee-11.jpg')).toBeVisible()
    expect(screen.getByText('employee-12.jpg')).toBeVisible()

    await user.click(screen.getByRole('checkbox', { name: 'Show unmatched only (1)' }))
    expect(screen.getByText('employee-12.jpg')).toBeVisible()
    expect(screen.queryByText('employee-11.jpg')).not.toBeInTheDocument()
    expect(screen.queryByText(/Page 1 of/)).not.toBeInTheDocument()
  })

  it('commits included mappings through the real upload manager and renders mixed results', async () => {
    imageStubs = installImageStubs()
    const preview = [
      { file_name: 'ari.jpg', candidates: [candidate('employee-ari', 'Ari Employee')] },
      { file_name: 'jordan.jpg', candidates: [candidate('employee-jordan', 'Jordan Employee')] },
    ]
    let committedFormData
    let releaseCommit
    const commitPending = new Promise((resolve) => { releaseCommit = resolve })
    const commitResult = {
      success_count: 1,
      failed_count: 1,
      items: [
        { id: 'employee-ari', status: 'SUCCESS' },
        { id: 'jordan.jpg', status: 'FAILED', error: 'Image could not be processed' },
      ],
    }
    const { container, user } = renderDialog(routesFor({
      preview,
      commit: async ({ options }) => {
        committedFormData = options.body
        await commitPending
        return jsonResponse({ data: commitResult })
      },
    }))

    await selectFiles(user, container, preview.map((item) => imageFile(item.file_name)))
    await screen.findByRole('button', { name: 'Upload 2 photo(s)' })
    await completeUpload(screen.getByRole('button', { name: 'Upload 2 photo(s)' }), releaseCommit)

    expect(await screen.findByText('1 succeeded, 1 failed.')).toBeVisible()
    expect(screen.getByText('jordan.jpg')).toBeVisible()
    expect(screen.getByText('Image could not be processed')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Done' })).toBeVisible()
    expect(JSON.parse(committedFormData.get('mappings'))).toEqual([
      { file_name: 'ari.jpg', employee_id: 'employee-ari' },
      { file_name: 'jordan.jpg', employee_id: 'employee-jordan' },
    ])
    expect(committedFormData.getAll('files').map((file) => file.name)).toEqual(['ari.jpg', 'jordan.jpg'])
  })

  it('turns a failed commit request into a visible per-file failure result', async () => {
    imageStubs = installImageStubs()
    const preview = [
      { file_name: 'ari.jpg', candidates: [candidate('employee-ari', 'Ari Employee')] },
    ]
    let releaseCommit
    const commitPending = new Promise((resolve) => { releaseCommit = resolve })
    const { container, user } = renderDialog(routesFor({
      preview,
      commit: async () => {
        await commitPending
        return jsonResponse({ message: 'Storage unavailable' }, 503)
      },
    }))

    await selectFiles(user, container, [imageFile('ari.jpg')])
    await completeUpload(await screen.findByRole('button', { name: 'Upload 1 photo(s)' }), releaseCommit)

    expect(await screen.findByText('0 succeeded, 1 failed.')).toBeVisible()
    expect(screen.getByText('ari.jpg')).toBeVisible()
    expect(screen.getByText('Storage unavailable')).toBeVisible()
  })

  it('opens and cancels the crop dialog, then revokes crop and thumbnail URLs on cleanup', async () => {
    imageStubs = installImageStubs()
    const preview = [
      { file_name: 'ari.jpg', candidates: [candidate('employee-ari', 'Ari Employee')] },
    ]
    const { container, unmount, user } = renderDialog(routesFor({ preview }))

    await selectFiles(user, container, [imageFile('ari.jpg')])
    await screen.findByText(/1 of 1 file\(s\) ready to upload/)
    await waitFor(() => expect(imageStubs.createObjectURL).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: 'Edit ari.jpg' }))
    const cropDialog = await screen.findByRole('dialog', { name: 'Crop photo' })
    expect(cropDialog).toBeVisible()
    await waitFor(() => expect(imageStubs.createObjectURL).toHaveBeenCalledTimes(2))

    await user.click(within(cropDialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Crop photo' })).not.toBeInTheDocument()
    expect(imageStubs.revokeObjectURL).toHaveBeenCalledWith('blob:test-2')

    unmount()
    expect(imageStubs.revokeObjectURL).toHaveBeenCalledWith('blob:test-1')
    expect(imageStubs.bitmapClose).toHaveBeenCalled()
  })
})
