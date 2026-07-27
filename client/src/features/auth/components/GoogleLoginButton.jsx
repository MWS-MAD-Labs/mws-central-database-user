import { LoaderCircle, LogIn } from 'lucide-react'
import { Button } from '../../../components/ui/Button.jsx'
import { env } from '../../../config/env.js'
import { useAuth } from '../hooks/useAuth.js'
import { requestGoogleCode } from '../../../lib/googleIdentity.js'
import { showErrorToast } from '../../../lib/toast.js'

export function GoogleLoginButton() {
  const { loginWithGoogle, isLoggingIn } = useAuth()

  async function handleLogin() {
    try {
      const code = await requestGoogleCode({
        clientId: env.googleClientId,
        redirectUri: env.googleRedirectUri,
      })
      await loginWithGoogle(code)
    } catch (loginError) {
      showErrorToast(loginError, 'Google login failed')
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
    </div>
  )
}
