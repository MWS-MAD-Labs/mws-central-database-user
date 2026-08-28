import { AlertCircle, LoaderCircle, LogIn } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { env } from "../../../config/env.js";
import { useAuth } from "../hooks/useAuth.js";
import { requestGoogleCode } from "../../../lib/googleIdentity.js";
import { showErrorToast } from "../../../lib/toast.js";

export function GoogleLoginButton() {
  const { loginWithGoogle, isLoggingIn } = useAuth();
  const [unregisteredError, setUnregisteredError] = useState(false);

  async function handleLogin() {
    setUnregisteredError(false);
    try {
      const code = await requestGoogleCode({
        clientId: env.googleClientId,
        redirectUri: env.googleRedirectUri,
      });
      await loginWithGoogle(code);
    } catch (loginError) {
      if (
        loginError?.message ===
        "This account isn't registered in the Central database yet."
      ) {
        setUnregisteredError(true);
      }
      showErrorToast(loginError, "Google login failed");
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
      {unregisteredError ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-[#e7b7b7] bg-[#fff2f2] px-4 py-3 text-sm text-[#8d3035]"
        >
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Account not registered</p>
            <p className="mt-1 leading-5">
              This Google account is not registered in the Central database yet.
              Contact the administrator to request access.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
