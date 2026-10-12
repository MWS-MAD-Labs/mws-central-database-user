import { useEffect, useEffectEvent, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "../../../components/ui/Button.jsx";
import { TextAction } from "../../../components/ui/TextAction.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { showErrorToast } from "../../../lib/toast.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { cleanPastedSecret } from "../utils/hubSettings.js";

const MESSAGE = {
  wrong: "The Hub does not accept this secret. Copy the value of HUB_INTERNAL_SECRET from its .env.",
  unreachable: "Nothing answers at the Hub address.",
  no_check: "The Hub has not been updated to check secrets yet, so this one is not verified.",
  refused: "This address cannot be asked.",
};

// Asks the Hub whether a pasted secret is its own. `onReady(true)` once the Hub said yes, or after "Use It Anyway"
// where it could not be asked. Changing the secret clears the answer. `address` is left out for the Hub that is kept.
export function HubSecretTest({ secret, address, disabled = false, onReady }) {
  const confirm = useConfirm();
  const clean = cleanPastedSecret(secret);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [anyway, setAnyway] = useState(false);
  const current = result && result.secret === clean && result.address === (address ?? "") ? result.verdict : null;
  const ready = current === "ok" || (anyway && current !== null && current !== "wrong");

  const report = useEffectEvent(onReady);
  useEffect(() => {
    report(ready);
  }, [ready]);

  async function run() {
    setRunning(true);
    setAnyway(false);
    try {
      const verdict = await applicationAccessApi.checkHubSecret({ address, secret: clean });
      setResult({ secret: clean, address: address ?? "", verdict });
    } catch (error) {
      showErrorToast(error, "Could not test the secret.");
    } finally {
      setRunning(false);
    }
  }

  async function useAnyway() {
    const confirmed = await confirm({
      title: "Use This Secret Anyway",
      description:
        "The Hub could not confirm this secret. If it is wrong, the applications get a secret the Hub refuses and their sign-in fails. Use it only if you are sure.",
      confirmLabel: "Use It Anyway",
    });
    if (confirmed) setAnyway(true);
  }

  return (
    <div className="space-y-1.5">
      <Button type="button" variant="secondary" loading={running} disabled={disabled || !clean} onClick={run}>
        Test This Secret
      </Button>
      <div aria-live="polite" className="min-h-5 text-xs">
        {current === "ok" ? (
          <p className="flex items-center gap-1.5 font-semibold text-[#3b5d36]">
            <Check size={14} aria-hidden="true" />
            The Hub accepts this secret.
          </p>
        ) : null}
        {anyway && current && current !== "ok" && current !== "wrong" ? <p className="text-(--mws-muted)">Used as typed, not verified.</p> : null}
        {current && current !== "ok" && !anyway ? (
          <p className={current === "wrong" ? "text-[#a43c41]" : "text-[#745716]"}>
            {MESSAGE[current]}{" "}
            {current === "unreachable" || current === "no_check" ? (
              <TextAction className="ml-1 inline-flex" onClick={useAnyway}>
                Use It Anyway
              </TextAction>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
