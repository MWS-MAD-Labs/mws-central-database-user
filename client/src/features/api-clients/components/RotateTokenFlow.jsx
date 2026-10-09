import { useMutation } from "@tanstack/react-query";
import { Check, RotateCw, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { cn } from "../../../lib/cn.js";
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

const MODES = [
  {
    id: "graceful",
    title: "Graceful Rotation",
    text: "Keep the current credential valid for 24 hours while the new one is deployed.",
    happens: "The old token keeps working for 24 hours. Deploy the new one in that time.",
    icon: RotateCw,
    recommended: true,
  },
  {
    id: "emergency",
    title: "Emergency Immediate",
    text: "Revoke the current credential as soon as the new one is issued.",
    happens: "The old token stops working at once. Be ready to deploy the new one now.",
    icon: ShieldAlert,
    recommended: false,
  },
];

function RotateModeDialog({ title, isSubmitting, onClose, onSubmit }) {
  const [mode, setMode] = useState("graceful");
  const chosen = MODES.find((item) => item.id === mode);
  const emergency = mode === "emergency";

  return (
    <CrudDialog
      title="Rotate Credentials"
      description={title}
      onClose={onClose}
      panelClassName="max-w-lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={emergency ? "danger" : "primary"}
            loading={isSubmitting}
            onClick={() => onSubmit({ mode, graceSeconds: mode === "graceful" ? 86400 : 0 })}
          >
            Rotate
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div role="radiogroup" aria-label="Rotation mode" className="space-y-3">
          {MODES.map((item) => {
            const selected = item.id === mode;
            const danger = item.id === "emergency";
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setMode(item.id)}
                className={cn(
                  "flex w-full cursor-pointer items-start gap-3 rounded-2xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
                  selected
                    ? danger
                      ? "border-[#c75f64] bg-[#fff0f1] focus-visible:outline-[#c75f64]"
                      : "border-(--mws-burgundy) bg-[#7E15180D] focus-visible:outline-(--mws-burgundy)"
                    : "border-(--mws-line) bg-white hover:border-(--mws-burgundy) focus-visible:outline-(--mws-burgundy)",
                )}
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full",
                    danger ? "bg-[#fff0f1] text-[#a43c41]" : "bg-[#7E15181A] text-(--mws-burgundy)",
                  )}
                  aria-hidden="true"
                >
                  <Icon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={cn("font-display text-sm font-bold", danger ? "text-[#a43c41]" : "text-(--mws-charcoal)")}>{item.title}</span>
                    {item.recommended ? <StatusBadge tone="green">Recommended</StatusBadge> : null}
                  </span>
                  <span className="mt-1 block text-sm leading-5 text-(--mws-muted)">{item.text}</span>
                </span>
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                    selected ? (danger ? "border-[#c75f64] bg-[#c75f64] text-white" : "border-(--mws-burgundy) bg-(--mws-burgundy) text-white") : "border-(--mws-line) bg-white",
                  )}
                  aria-hidden="true"
                >
                  {selected ? <Check size={13} /> : null}
                </span>
              </button>
            );
          })}
        </div>
        <p
          className={cn(
            "rounded-xl px-3 py-2 text-xs leading-5",
            emergency ? "bg-[#fff0f1] text-[#a43c41]" : "bg-(--mws-soft) text-(--mws-muted)",
          )}
        >
          <span className="font-semibold">What happens: </span>
          {chosen.happens}
        </p>
      </div>
    </CrudDialog>
  );
}
