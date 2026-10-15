import { Check, Copy } from "lucide-react";
import { Link } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { maskToken } from "../../api-clients/utils/maskToken.js";

const CLOSE_DELAY_MS = 700;

// The .env lines for the application. The token inside is shown once and only masked on screen, the
// button copies the real lines and then closes the dialog. If the clipboard is blocked the lines
// are offered in a field instead, otherwise the token would be lost.
export function ConnectDialog({
  connection,
  onClose,
  title = "Connection Created",
  onceLabel = "Token Shown Once",
  nextSteps = null,
  description = "Put these lines in the .env of the application, then deploy it.",
  notice = null,
  // Without it, the dialog closes by itself after the copy. With { used }, it stays until Central has seen
  // the application use the new values. { unknown } means Central cannot tell, so Done is not held back.
  proof = null,
}) {
  // The lines are written as they go in the .env, in quotes, with a blank line between groups.
  const startsGroup = (index) => index === 0 || connection.env[index - 1].group !== connection.env[index].group;
  const text = connection.env
    .map((item, index) => {
      const heading = startsGroup(index) && item.heading ? `# ${item.heading}\n` : "";
      return `${index > 0 && startsGroup(index) ? "\n" : ""}${heading}${item.line}`;
    })
    .join("\n");
  const [copied, setCopied] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const proven = proof ? Boolean(proof.used || proof.unknown) : copied;
  const timer = useRef(null);
  const fallbackRef = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (blocked) {
      fallbackRef.current?.focus();
      fallbackRef.current?.select();
    }
  }, [blocked]);

  async function copyEnv() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is not available");
      await navigator.clipboard.writeText(text);
    } catch {
      setBlocked(true);
      showErrorToast("Clipboard is blocked in this browser. Select the lines and copy them.");
      return;
    }
    setCopied(true);
    showSuccessToast("Values copied.");
    if (!proof && !copied) timer.current = setTimeout(onClose, CLOSE_DELAY_MS);
  }

  function requestClose() {
    if (proven) onClose();
    else setConfirmingClose(true);
  }

  return (
    <CrudDialog title={title} description={description} onClose={requestClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <p className="font-display text-xs font-bold uppercase tracking-wide text-(--mws-muted)">.env Values</p>
          <StatusBadge tone="amber">{onceLabel}</StatusBadge>
        </div>
        <div
          role="img"
          aria-label="Values hidden, copy them with the button"
          className="space-y-1 break-all rounded-xl border border-(--mws-line) bg-(--mws-soft) px-3 py-3 font-mono text-xs text-(--mws-charcoal)"
          style={{ userSelect: "none", WebkitUserSelect: "none" }}
          onCopy={(event) => event.preventDefault()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {connection.env.map((item, index) => (
            <div key={item.key} className={startsGroup(index) && index > 0 ? "mt-3" : undefined}>
              {startsGroup(index) && item.heading ? <p className="mb-1 font-sans text-[11px] leading-4 break-words text-(--mws-muted)"># {item.heading}</p> : null}
              <p>{item.secret ? `${item.key}="${maskToken(item.value)}"` : item.line}</p>
            </div>
          ))}
        </div>
        <Button type="button" className="h-12 w-full text-base" onClick={copyEnv}>
          {copied ? <Check size={18} /> : <Copy size={18} />}
          {copied ? "Copy Again" : "Copy .env Values"}
        </Button>
        {!blocked ? <p className="text-xs text-(--mws-muted)">Copy them now. They are not shown again.</p> : null}

        {blocked ? (
          <div>
            <p className="mb-2 text-sm text-[#745716]">Clipboard is blocked. Select the lines below and copy them.</p>
            <textarea
              ref={fallbackRef}
              readOnly
              value={text}
              aria-label="Values to copy by hand"
              className="min-h-32 w-full rounded-xl border border-[#d8b45b] bg-[#fff8e8] px-3 py-2 font-mono text-xs text-(--mws-charcoal) outline-none"
            />
            <div className="mt-3 flex justify-end">
              <Button type="button" variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : null}

        {connection.hub_lines_missing ? (
          <div role="note" className="rounded-xl border border-[#d8b45b] bg-[#fff8e8] p-3">
            <p className="text-sm font-semibold text-[#745716]">The Hub lines are not here yet.</p>
            <p className="mt-1 text-sm text-[#745716]">
              Add the Hub's address and secret on the Hub's setup page. Rotate this token after that to get HUB_BASE_URL, HUB_SSO_JWKS_URL and HUB_INTERNAL_SECRET in the .env.
            </p>
          </div>
        ) : null}

        {proof ? (
          <div className="space-y-3 rounded-xl border border-(--mws-line) bg-white p-3">
            <p className="text-sm text-(--mws-charcoal)">
              {proof.used
                ? (proof.done ?? "The application called Central with the new token. You are done.")
                : proof.unknown
                  ? "Cannot check right now. Close this when the application has the new values."
                  : (proof.waiting ?? "Waiting for the application to call Central with the new token. Deploy it with the values above.")}
            </p>
            <div className="flex justify-end">
              <Button type="button" disabled={!proven} onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : null}

        {nextSteps ? (
          <div className="rounded-xl border border-(--mws-line) bg-white p-3">
            <p className="font-display text-sm font-bold text-(--mws-charcoal)">What To Do Now</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm text-(--mws-muted)">
              {nextSteps.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
            {nextSteps.href ? (
              <Link to={nextSteps.href} className="mt-2 inline-block text-xs font-semibold text-(--mws-burgundy) hover:underline">
                Open the full steps
              </Link>
            ) : null}
          </div>
        ) : null}

        {notice ? (
          <div
            role="note"
            className={
              notice.tone === "danger"
                ? "rounded-xl border border-[#e3a2a5] bg-[#fff0f1] p-3"
                : "rounded-xl border border-[#d8b45b] bg-[#fff8e8] p-3"
            }
          >
            <p className={`text-sm font-semibold ${notice.tone === "danger" ? "text-[#a43c41]" : "text-[#745716]"}`}>{notice.title}</p>
            <p className={`mt-1 text-sm ${notice.tone === "danger" ? "text-[#a43c41]" : "text-[#745716]"}`}>{notice.text}</p>
          </div>
        ) : null}

        {confirmingClose ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
            <p className="text-(--mws-muted)">
              <span className="font-semibold text-(--mws-charcoal)">{proof ? "Not in use yet." : "Not copied yet."}</span> The values are not shown again.
            </p>
            <div className="flex items-center gap-4 text-xs font-semibold">
              <button type="button" className="cursor-pointer text-(--mws-muted) hover:text-(--mws-charcoal)" onClick={() => setConfirmingClose(false)}>
                Keep Open
              </button>
              <button type="button" className="cursor-pointer text-[#a43c41] hover:underline" onClick={onClose}>
                Close Anyway
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </CrudDialog>
  );
}
