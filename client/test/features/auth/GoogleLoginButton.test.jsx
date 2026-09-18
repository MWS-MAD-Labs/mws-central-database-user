import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { GoogleLoginButton } from '../../../src/features/auth/components/GoogleLoginButton.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'

function installGoogle({ code = 'google-code', error, cancelled = false } = {}) {
  const requestCode = mock(() => {
    if (cancelled) googleOptions.error_callback()
    else googleOptions.callback(error ? { error } : { code })
  })
  let googleOptions
  window.google = {
    accounts: {
      oauth2: {
        initCodeClient: mock((options) => {
          googleOptions = options
          return { requestCode }
        }),
      },
    },
  }
  return { requestCode, options: () => googleOptions }
}

function renderButton(authValue = {}) {
  return renderWithProviders(
    <AuthContext.Provider value={{
      loginWithGoogle: mock(async () => {}),
      isLoggingIn: false,
      ...authValue,
    }}>
      <GoogleLoginButton />
    </AuthContext.Provider>,
  )
}

describe('GoogleLoginButton', () => {
  beforeEach(() => installGoogle())

  it('requests a Google code and completes login', async () => {
    const google = installGoogle()
    const loginWithGoogle = mock(async () => {})
    const { user } = renderButton({ loginWithGoogle })

    await user.click(screen.getByRole('button', { name: 'Continue with Google' }))

    expect(google.options()).toMatchObject({
      client_id: 'google-client-id',
      redirect_uri: 'http://localhost/auth/google/callback',
      ux_mode: 'popup',
      prompt: 'select_account',
    })
    expect(google.requestCode).toHaveBeenCalledTimes(1)
    expect(loginWithGoogle).toHaveBeenCalledWith('google-code')
  })

  it('disables the button while login is pending', () => {
    renderButton({ isLoggingIn: true })
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled()
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('shows registration guidance for an unknown account', async () => {
    const failure = new Error("This account isn't registered in the Central database yet.")
    const loginWithGoogle = mock(async () => { throw failure })
    const { user } = renderButton({ loginWithGoogle })

    await user.click(screen.getByRole('button', { name: 'Continue with Google' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Account not registered')
  })

  it('clears the registration alert before a retry', async () => {
    const loginWithGoogle = mock()
      .mockRejectedValueOnce(new Error("This account isn't registered in the Central database yet."))
      .mockResolvedValueOnce(undefined)
    const { user } = renderButton({ loginWithGoogle })

    await user.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(await screen.findByRole('alert')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Continue with Google' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})
