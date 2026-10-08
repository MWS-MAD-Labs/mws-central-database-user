import { Check, Copy, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { formatDateTime, formatStatus } from "../../../lib/format.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { maskToken } from "../utils/maskToken.js";
import { scopeName } from "../utils/scopes.js";

const CLOSE_DELAY_MS = 700;

// The token is shown once and never in full on the screen: the dialog shows its start and end, and
// one big button copies it and then closes the dialog. If the browser blocks the clipboard the dialog
// stays and the token is offered in a field that can be selected, otherwise it would be lost.
export function TokenDialog({ title, client, onClose }) {
  const newToken = client.new_token || client.token || client.credential?.token;
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

  const activeCredential = client.credentials?.find((credential) => credential.status === "ACTIVE");
  const retiringDeadline =
    client.retiring_deadline ||
    client.retiring_at ||
    client.current_credential?.retires_at ||
    client.credentials?.find((credential) => credential.status === "RETIRING")?.expires_at;
  const scopes = (client.effective_scopes || client.scopes || []).map(scopeName).map(formatStatus).join(", ");

  async function copyToken() {
    if (!newToken || copied) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is not available");
      await navigator.clipboard.writeText(newToken);
    } catch {
      setBlocked(true);
      showErrorToast("Clipboard is blocked in this browser. Select the token and copy it.");
      return;
    }
    setCopied(true);
    showSuccessToast("Token copied.");
    timer.current = setTimeout(onClose, CLOSE_DELAY_MS);
  }

  function requestClose() {
    if (copied || !newToken) onClose();
    else setConfirmingClose(true);
  }

  return (
    <CrudDialog title={title} description={client.profile?.name || client.name} onClose={requestClose}>
      <div className="space-y-4">
        <div className="flex min-w-0 items-center gap-3 rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3">
          <ShieldCheck size={18} className="shrink-0 text-(--mws-burgundy)" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-(--mws-charcoal)">
              {client.new_token_prefix || activeCredential?.token_prefix || client.token_prefix || "New Credential"}
            </p>
            <p className="break-words text-xs text-(--mws-muted)">{scopes}</p>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <p className="font-display text-xs font-bold uppercase tracking-wide text-(--mws-muted)">New Token</p>
            <StatusBadge tone="amber">Shown Once</StatusBadge>
          </div>
          {newToken ? (
            <div className="space-y-3">
              <p
                role="img"
                aria-label="Token hidden, copy it with the button"
                className="rounded-xl border border-(--mws-line) bg-(--mws-soft) px-3 py-3 text-center font-mono text-sm tracking-wide text-(--mws-charcoal)"
                style={{ userSelect: "none", WebkitUserSelect: "none" }}
                onCopy={(event) => event.preventDefault()}
                onContextMenu={(event) => event.preventDefault()}
              >
                {maskToken(newToken)}
              </p>
              <Button type="button" className="h-12 w-full text-base" onClick={copyToken}>
                {copied ? <Check size={18} /> : <Copy size={18} />}
                {copied ? "Copied" : "Copy Token"}
              </Button>
            </div>
          ) : (
            <p className="rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3 text-sm text-(--mws-muted)">
              Token was not returned by the server.
            </p>
          )}
          {newToken && !blocked ? (
            <p className="mt-2 text-xs text-(--mws-muted)">Copy it now. It is not shown again.</p>
          ) : null}
        </div>

        {blocked ? (
          <div>
            <p className="mb-2 text-sm text-[#745716]">Clipboard is blocked. Select the token below and copy it.</p>
            <textarea
              ref={fallbackRef}
              readOnly
              value={newToken}
              aria-label="Token to copy by hand"
              className="min-h-24 w-full rounded-xl border border-[#d8b45b] bg-[#fff8e8] px-3 py-2 font-mono text-sm text-(--mws-charcoal) outline-none"
            />
            <div className="mt-3 flex justify-end">
              <Button type="button" variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : null}

        {retiringDeadline ? (
          <p className="rounded-xl bg-[#fff8e8] p-3 text-sm text-[#745716]">
            Current credential retires at <strong>{formatDateTime(retiringDeadline)}</strong>.
          </p>
        ) : null}

        {confirmingClose ? (
          <div role="alert" className="rounded-xl border border-[#d8b45b] bg-[#fff8e8] p-3">
            <p className="text-sm font-semibold text-[#745716]">This token will not be shown again.</p>
            <p className="mt-1 text-sm text-[#745716]">You have not copied it yet.</p>
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
