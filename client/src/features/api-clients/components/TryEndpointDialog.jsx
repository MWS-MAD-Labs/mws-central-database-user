import { useMutation } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, TextAreaInput, TextInput } from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { apiClientsApi } from "../api/apiClientsApi.js";
import { describeScope } from "../utils/scopes.js";

const PLACEHOLDER_RE = /\{[^}]+\}/g;

function describeResult(result, scopeTitle) {
  if (result.ok) {
    const list = Array.isArray(result.payload?.data)
      ? result.payload.data
      : Array.isArray(result.payload)
        ? result.payload
        : null;
    return {
      tone: "green",
      label: "Success",
      detail: list
        ? `Returned ${list.length} item${list.length === 1 ? "" : "s"}.`
        : "The request returned data.",
    };
  }
  if (result.status === 401) {
    return { tone: "red", label: "Token not valid", detail: "The token is wrong, expired, or was revoked." };
  }
  if (result.status === 403) {
    return {
      tone: "red",
      label: "Not allowed",
      detail: `This token does not have the permission needed: ${scopeTitle}. Give its client a profile that includes it.`,
    };
  }
  if (result.status === 404) {
    return { tone: "amber", label: "Nothing found", detail: "Check the path and any IDs in it." };
  }
  return { tone: "red", label: "Something went wrong", detail: "See the technical response for details." };
}

// Guided "try it" flow: says what will happen and explains the outcome in plain language.
export function TryEndpointDialog({ endpoint, onClose }) {
  const scope = describeScope(endpoint.scope);
  const [token, setToken] = useState("");
  const [path, setPath] = useState(endpoint.path);
  const [result, setResult] = useState(null);
  const [showRaw, setShowRaw] = useState(false);

  const placeholders = path.match(PLACEHOLDER_RE) || [];
  const blockedReason = !token.trim()
    ? "Paste an API token first."
    : placeholders.length > 0
      ? `Replace ${placeholders.join(", ")} with a real value.`
      : undefined;

  const mutation = useMutation({
    mutationFn: () => apiClientsApi.testInternal(path, token.trim()),
    onSuccess: (payload) => {
      setShowRaw(false);
      setResult({ ok: true, status: 200, payload });
    },
    onError: (error) => {
      setShowRaw(false);
      setResult({ ok: false, status: error.status, payload: error.payload || error.message });
    },
  });

  const outcome = result ? describeResult(result, scope.title) : null;

  function handleSubmit(event) {
    event.preventDefault();
    if (blockedReason) return;
    mutation.mutate();
  }

  return (
    <CrudDialog
      title={`Try "${endpoint.title || endpoint.path}"`}
      description="Paste an API client token to see what this request returns. Nothing is changed."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            form="try-endpoint-form"
            type="submit"
            loading={mutation.isPending}
            disabled={Boolean(blockedReason)}
            title={blockedReason}
          >
            <Send size={16} />
            Send request
          </Button>
        </>
      }
    >
      <form id="try-endpoint-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3 text-sm">
          <p className="text-(--mws-charcoal)">{endpoint.purpose}</p>
          <p className="mt-2 text-xs text-(--mws-muted)">
            Permission needed: <strong className="text-(--mws-charcoal)">{scope.title}</strong>
            {scope.sensitive ? (
              <span className="ml-1.5 font-semibold text-[#a43c41]">Sensitive</span>
            ) : null}
          </p>
        </div>

        <Field label="API token" hint="The token shown once when the client was created.">
          <TextAreaInput
            aria-label="API token"
            autoFocus
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="min-h-24 font-mono"
          />
        </Field>

        <Field
          label="Request"
          hint={
            placeholders.length > 0
              ? `Replace ${placeholders.join(", ")} with a real value, for example a student ID.`
              : undefined
          }
        >
          <div className="flex min-w-0 items-center gap-2">
            <StatusBadge tone="green">{endpoint.method}</StatusBadge>
            <TextInput
              aria-label="Request path"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              className="font-mono text-xs"
            />
          </div>
        </Field>

        {outcome ? (
          <div className="rounded-xl border border-(--mws-line) p-3" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={outcome.tone}>{outcome.label}</StatusBadge>
              {result.status ? (
                <span className="text-xs text-(--mws-muted)">HTTP {result.status}</span>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-(--mws-charcoal)">{outcome.detail}</p>
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-(--mws-burgundy) underline"
              onClick={() => setShowRaw((open) => !open)}
            >
              {showRaw ? "Hide technical response" : "Show technical response"}
            </button>
            {showRaw ? (
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-(--mws-soft) p-3 font-mono text-xs text-(--mws-charcoal)">
                {JSON.stringify(result.payload, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
      </form>
    </CrudDialog>
  );
}
