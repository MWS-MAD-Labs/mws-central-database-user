import { Check, Copy } from "lucide-react";
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
  description = "Put these lines in the .env of the application, then deploy it.",
  notice = null,
}) {
  // The lines are written as they go in the .env, in quotes, with a blank line between groups.
  const text = connection.env
    .map((item, index) => (index > 0 && connection.env[index - 1].group !== item.group ? `\n${item.line}` : item.line))
    .join("\n");
  const [copied, setCopied] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
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
    if (copied) return;
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
    timer.current = setTimeout(onClose, CLOSE_DELAY_MS);
  }

  function requestClose() {
    if (copied) onClose();
    else setConfirmingClose(true);
  }

  return (
    <CrudDialog title={title} description={description} onClose={requestClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <p className="font-display text-xs font-bold uppercase tracking-wide text-(--mws-muted)">.env Values</p>
          <StatusBadge tone="amber">Token Shown Once</StatusBadge>
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
            <p key={item.key} className={index > 0 && connection.env[index - 1].group !== item.group ? "mt-3" : undefined}>
              {item.secret ? `${item.key}="${maskToken(item.value)}"` : item.line}
            </p>
          ))}
        </div>
        <Button type="button" className="h-12 w-full text-base" onClick={copyEnv}>
          {copied ? <Check size={18} /> : <Copy size={18} />}
          {copied ? "Copied" : "Copy .env Values"}
        </Button>
        {!blocked ? <p className="text-xs text-(--mws-muted)">Copy them now. The token is not shown again.</p> : null}

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
          <div role="alert" className="rounded-xl border border-[#d8b45b] bg-[#fff8e8] p-3">
            <p className="text-sm font-semibold text-[#745716]">The token will not be shown again.</p>
            <p className="mt-1 text-sm text-[#745716]">You have not copied the values yet.</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmingClose(false)}>
                Keep Open
              </Button>
              <Button type="button" variant="danger" size="sm" onClick={onClose}>
                Close Anyway
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </CrudDialog>
  );
}
