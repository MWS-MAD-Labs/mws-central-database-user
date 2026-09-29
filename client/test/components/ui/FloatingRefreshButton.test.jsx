import { describe, expect, it, mock } from 'bun:test'
import { useQuery } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import { FloatingRefreshButton } from '../../../src/components/ui/FloatingRefreshButton.jsx'
import { createTestQueryClient, renderWithProviders } from '../../helpers/render.jsx'

function ActiveQuery({ queryFn }) {
  const query = useQuery({ queryKey: ['refresh-test'], queryFn })
  return <p>{query.data || 'Loading'}</p>
}

describe('FloatingRefreshButton', () => {
  it('refreshes active queries from the global control', async () => {
    const queryFn = mock(async () => 'Fresh data')
    const { user } = renderWithProviders(
      <>
        <FloatingRefreshButton />
        <ActiveQuery queryFn={queryFn} />
      </>,
    )

    expect(await screen.findByText('Fresh data')).toBeVisible()
    expect(queryFn).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Refresh all data' }))

    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
  })

  it('marks inactive dialog queries stale for their next open', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['students', 'enrollment-candidates'], [
      { id: 'student-old' },
    ])
    const { user } = renderWithProviders(<FloatingRefreshButton />, {
      queryClient,
    })

    expect(
      queryClient.getQueryState(['students', 'enrollment-candidates'])
        ?.isInvalidated,
    ).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Refresh all data' }))

    expect(
      queryClient.getQueryState(['students', 'enrollment-candidates'])
        ?.isInvalidated,
    ).toBe(true)
  })
})
