import { Check } from "lucide-react";
import { useState } from "react";
import { Field, TextAreaInput } from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { cn } from "../../../lib/cn.js";
import { HUB_MODES, MAX_BYPASS_EMAILS, emailsProblem, parseEmails } from "../utils/hubSettings.js";

// How strictly the Hub checks who may sign in, and who always gets in. Both go into the Hub's .env.
// The parent keeps `value` as { hub_access_mode, hub_bypass_emails } and is told of each change.
export function HubAccessSettings({ value, onChange, attempted = false }) {
  const [emailText, setEmailText] = useState(() => value.hub_bypass_emails.join(", "));
  const emails = parseEmails(emailText);
  const problem = emailsProblem(emails);

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
        hint={`Up to ${MAX_BYPASS_EMAILS}, separated by commas. Keep yours here so a wrong setting cannot lock you out.`}
        error={attempted || emailText ? (problem ?? undefined) : undefined}
      >
        <TextAreaInput
          aria-label="Emails that always get in"
          rows={2}
          value={emailText}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setEmailText(event.target.value);
            onChange({ ...value, hub_bypass_emails: parseEmails(event.target.value) });
          }}
        />
      </Field>
    </div>
  );
}
