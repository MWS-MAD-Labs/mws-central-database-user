import { afterEach, describe, expect, it, vi } from 'bun:test'
import { act, fireEvent, screen } from '@testing-library/react'
import { useState } from 'react'
import { renderWithProviders } from '../../helpers/render.jsx'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { useConfirm } from '../../../src/components/ui/useConfirm.js'

function ConfirmHarness({ options = 'Continue?' }) {
  const confirm = useConfirm()
  const [result, setResult] = useState('pending')
  return (
    <>
      <button type="button" onClick={async () => setResult(String(await confirm(options)))}>Open confirm</button>
      <span data-testid="result">{result}</span>
    </>
  )
}

function renderConfirm(options) {
  return renderWithProviders(
    <ConfirmProvider>
      <ConfirmHarness options={options} />
    </ConfirmProvider>,
  )
}

describe('ConfirmProvider', () => {
  afterEach(() => vi.useRealTimers())

  it('resolves true from an accessible confirmation dialog', async () => {
    const { user } = renderConfirm({
      title: 'Delete student',
      description: 'This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep student',
      tone: 'danger',
    })
    await user.click(screen.getByRole('button', { name: 'Open confirm' }))

    expect(screen.getByRole('dialog', { name: 'Delete student' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('This cannot be undone.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByTestId('result')).toHaveTextContent('true')
  })

  it('resolves false when cancelled', async () => {
    const { user } = renderConfirm('Continue?')
    await user.click(screen.getByRole('button', { name: 'Open confirm' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId('result')).toHaveTextContent('false')
  })

  it('counts down before enabling confirmation', () => {
    vi.useFakeTimers()
    renderConfirm({ description: 'Generate permanent ID?', delaySeconds: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Open confirm' }))

    expect(screen.getByRole('button', { name: 'Wait 2s...' })).toBeDisabled()
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('button', { name: 'Wait 1s...' })).toBeDisabled()
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled()
  })
})
