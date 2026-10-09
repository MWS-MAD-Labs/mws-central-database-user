import { useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { TokenDialog } from "./TokenDialog.jsx";

// Rotating a token: pick graceful or emergency, confirm, then show the new token once.
// `rotate` gets { mode, graceSeconds } and returns the client with its new token.
export function RotateTokenFlow({ title, rotate, onRotated, onClose, renderResult }) {
  const confirm = useConfirm();
  const [result, setResult] = useState(null);
  const mutation = useMutation({
    mutationFn: rotate,
    onSuccess: (client, variables) => {
      onRotated?.(client);
      setResult({ client, rotation: variables.mode });
    },
  });

  async function submit(options) {
    const emergency = options.mode === "emergency";
    const confirmed = await confirm({
      title: emergency ? "Emergency Token Rotation" : "Rotate API Client Token",
      description: emergency
        ? "The current credential will stop working immediately. Confirm that the replacement can be deployed now."
        : "A new credential will be issued and the current credential will remain valid for 24 hours.",
      confirmLabel: emergency ? "Rotate Immediately" : "Start Rotation",
      tone: emergency ? "danger" : undefined,
    });
    if (confirmed) mutation.mutate(options);
  }

  if (result) {
    // A caller can show the result its own way, for example with the whole .env.
    if (renderResult) return renderResult({ ...result, onClose });
    return <TokenDialog title="Rotated Credentials" client={result.client} rotation={result.rotation} onClose={onClose} />;
  }
  return <RotateModeDialog title={title} isSubmitting={mutation.isPending} onClose={onClose} onSubmit={submit} />;
}

function RotateModeDialog({ title, isSubmitting, onClose, onSubmit }) {
  const [mode, setMode] = useState("graceful");

  return (
    <CrudDialog
      title="Rotate Credentials"
      description={title}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            variant={mode === "emergency" ? "danger" : "primary"}
            loading={isSubmitting}
            onClick={() => onSubmit({ mode, graceSeconds: mode === "graceful" ? 86400 : 0 })}
          >
            Rotate
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className={`block cursor-pointer rounded-xl border p-4 ${mode === "graceful" ? "border-(--mws-burgundy) bg-[#7E15180D]" : "border-(--mws-line)"}`}>
          <span className="flex items-start gap-3">
            <input type="radio" name="rotation-mode" value="graceful" checked={mode === "graceful"} onChange={() => setMode("graceful")} className="mt-1" />
            <span><strong className="block text-(--mws-charcoal)">Graceful Rotation (Recommended)</strong><span className="text-sm text-(--mws-muted)">Keep the current credential valid for 24 hours while the new credential is deployed.</span></span>
          </span>
        </label>
        <label className={`block cursor-pointer rounded-xl border p-4 ${mode === "emergency" ? "border-[#c75f64] bg-[#fff0f1]" : "border-(--mws-line)"}`}>
          <span className="flex items-start gap-3">
            <input type="radio" name="rotation-mode" value="emergency" checked={mode === "emergency"} onChange={() => setMode("emergency")} className="mt-1" />
            <span><strong className="flex items-center gap-2 text-[#a43c41]"><AlertTriangle size={16} />Emergency Immediate</strong><span className="text-sm text-(--mws-muted)">Revoke the current credential as soon as the new one is issued.</span></span>
          </span>
        </label>
      </div>
    </CrudDialog>
  );
}
