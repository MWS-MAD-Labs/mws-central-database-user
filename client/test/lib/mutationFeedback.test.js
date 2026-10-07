import { describe, expect, it, spyOn } from 'bun:test'
import toast from 'react-hot-toast'
import { QueryClient } from '@tanstack/react-query'
import { createMutationCache, showMutationSuccess } from '../../src/lib/mutationFeedback.js'

describe('showMutationSuccess', () => {
  it('shows a plain message', () => {
    const success = spyOn(toast, 'success').mockImplementation(() => '')
    showMutationSuccess({ meta: { successMessage: 'Employee updated.' } }, {}, {})
    expect(success).toHaveBeenCalledWith('Employee updated.')
    success.mockRestore()
  })

  it('builds the message from the result and the variables', () => {
    const success = spyOn(toast, 'success').mockImplementation(() => '')
    showMutationSuccess(
      { meta: { successMessage: (data, variables) => `${data.count} of ${variables.total} done.` } },
      { count: 2 },
      { total: 3 },
    )
    expect(success).toHaveBeenCalledWith('2 of 3 done.')
    success.mockRestore()
  })

  it('stays silent for a mutation that did not ask for a toast', () => {
    const success = spyOn(toast, 'success').mockImplementation(() => '')
    showMutationSuccess({}, {}, {})
    showMutationSuccess({ meta: {} }, {}, {})
    expect(success).not.toHaveBeenCalled()
    success.mockRestore()
  })
})

describe('createMutationCache', () => {
  it('toasts once for a succeeding mutation that asks for it', async () => {
    const success = spyOn(toast, 'success').mockImplementation(() => '')
    const client = new QueryClient({ mutationCache: createMutationCache() })
    await client.getMutationCache()
      .build(client, { mutationFn: async () => 'ok', meta: { successMessage: 'Saved.' } })
      .execute()
    expect(success).toHaveBeenCalledTimes(1)
    expect(success).toHaveBeenCalledWith('Saved.')
    success.mockRestore()
  })

  it('shows the error toast and no success toast when the mutation fails', async () => {
    const success = spyOn(toast, 'success').mockImplementation(() => '')
    const failure = spyOn(toast, 'error').mockImplementation(() => '')
    const client = new QueryClient({ mutationCache: createMutationCache() })
    await client.getMutationCache()
      .build(client, { mutationFn: async () => { throw new Error('Nope') }, meta: { successMessage: 'Saved.' } })
      .execute()
      .catch(() => {})
    expect(success).not.toHaveBeenCalled()
    expect(failure).toHaveBeenCalled()
    success.mockRestore()
    failure.mockRestore()
  })
})
