import { LoaderCircle, LogIn } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../components/ui/Button.jsx'
import { env } from '../../../config/env.js'
import { useAuth } from '../hooks/useAuth.js'
import { requestGoogleCode } from '../../../lib/googleIdentity.js'

export function GoogleLoginButton() {
  const { loginWithGoogle, isLoggingIn } = useAuth()
  const [error, setError] = useState('')

  async function handleLogin() {
    setError('')

    try {
      const code = await requestGoogleCode({
        clientId: env.googleClientId,
        redirectUri: env.googleRedirectUri,
      })
      await loginWithGoogle(code)
    } catch (loginError) {
      setError(loginError.message || 'Google login failed')
    }
  }

  return (
    <div className="space-y-3">
      <Button
        type="button"
        className="w-full"
        disabled={isLoggingIn}
        onClick={handleLogin}
      >
        {isLoggingIn ? (
          <LoaderCircle size={18} className="animate-spin" />
        ) : (
          <LogIn size={18} />
        )}
        Continue with Google
      </Button>
      {error ? (
        <p className="rounded-md border border-[#e8c7c2] bg-[#fff4f2] px-3 py-2 text-sm text-[#8f2f2f]">
          {error}
        </p>
      ) : null}
    </div>
  )
}
