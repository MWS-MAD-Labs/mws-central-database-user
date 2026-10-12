import { Check, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { Field, TextInput } from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { cn } from "../../../lib/cn.js";
import { LIMITS } from "../../../lib/limits.js";
import { HUB_MODES, MAX_BYPASS_EMAILS, emailsProblem, parseEmails } from "../utils/hubSettings.js";

// How strictly the Hub checks who may sign in, and who always gets in. Both go into the Hub's .env.
// The parent keeps `value` as { hub_access_mode, hub_bypass_emails } and is told of each change.
export function HubAccessSettings({ value, onChange }) {
  const emails = value.hub_bypass_emails;
  const [draft, setDraft] = useState("");
  const [draftProblem, setDraftProblem] = useState(null);

  // One email at a time. Several pasted together are split and added if they all pass.
  function add() {
    const entered = parseEmails(draft);
    if (entered.length === 0) return;
    const next = [...emails, ...entered];
    const problem = emailsProblem(next);
    if (problem) {
      setDraftProblem(problem);
      return;
    }
    onChange({ ...value, hub_bypass_emails: next });
    setDraft("");
    setDraftProblem(null);
  }

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Hub access mode" className="grid gap-2 sm:grid-cols-3">
        {HUB_MODES.map((mode) => {
          const selected = value.hub_access_mode === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ ...value, hub_access_mode: mode.id })}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-2xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--mws-burgundy)",
                selected ? "border-(--mws-burgundy) bg-[#7E15180D]" : "border-(--mws-line) bg-white hover:border-(--mws-burgundy)",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="font-display text-sm font-bold text-(--mws-charcoal)">{mode.title}</span>
                {mode.recommended ? <StatusBadge tone="green">Start here</StatusBadge> : null}
                {selected ? <Check size={14} className="ml-auto text-(--mws-burgundy)" aria-hidden="true" /> : null}
              </span>
              <span className="text-xs leading-5 text-(--mws-muted)">{mode.text}</span>
            </button>
          );
        })}
      </div>
      <Field
        label="Emails That Always Get In"
        hint={`Up to ${MAX_BYPASS_EMAILS}. Keep yours here so a wrong setting cannot lock you out.`}
        error={draftProblem ?? undefined}
      >
        <div className="flex gap-2">
          <TextInput
            aria-label="Add an email that always gets in"
            type="email"
            maxLength={LIMITS.EMAIL_MAX}
            value={draft}
            invalid={Boolean(draftProblem)}
            autoComplete="off"
            spellCheck={false}
            placeholder="name@millennia21.id"
            onChange={(event) => {
              setDraft(event.target.value);
              setDraftProblem(null);
            }}
            onBlur={add}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={add}>
            Add
          </Button>
        </div>
      </Field>
      {emails.length === 0 ? (
        <p className="text-xs text-(--mws-muted)">No emails yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {emails.map((email) => (
            <li
              key={email}
              className="inline-flex items-center gap-1.5 rounded-full border border-(--mws-line) bg-(--mws-soft) py-1 pr-1 pl-3 text-xs text-(--mws-charcoal)"
            >
              {email}
              <button
                type="button"
                aria-label={`Remove ${email}`}
                onClick={() => onChange({ ...value, hub_bypass_emails: emails.filter((item) => item !== email) })}
                className="flex size-5 cursor-pointer items-center justify-center rounded-full text-(--mws-muted) hover:bg-white hover:text-(--mws-burgundy)"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
