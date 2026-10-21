import { Check, Plus, X } from "lucide-react";
import { useState } from "react";
import { Field, TextInput } from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { cn } from "../../../lib/cn.js";
import { LIMITS } from "../../../lib/limits.js";
import {
  DEFAULT_COOKIE_NAME,
  HUB_MODES,
  MAX_BYPASS_EMAILS,
  cookieNameProblem,
  emailName,
  emailsProblem,
  nameProblem,
  readNameInput,
  toEmail,
} from "../utils/hubSettings.js";

// How strictly the Hub checks who may sign in, and the emergency admins who still can when Central gives them nothing. Both go into the Hub's .env.
// The parent keeps `value` as { hub_access_mode, hub_bypass_emails, hub_access_cookie_name } and is told of each change.
export function HubAccessSettings({ value, onChange }) {
  const emails = value.hub_bypass_emails;
  const cookieName = value.hub_access_cookie_name ?? DEFAULT_COOKIE_NAME;
  const cookieProblem = cookieNameProblem(cookieName);
  const [draft, setDraft] = useState("");
  const [draftProblem, setDraftProblem] = useState(null);

  function add() {
    const name = draft.trim();
    if (!name) return;
    const email = toEmail(name);
    const problem = nameProblem(name) ?? emailsProblem([...emails, email]);
    if (problem) {
      setDraftProblem(problem);
      return;
    }
    onChange({ ...value, hub_bypass_emails: [...emails, email] });
    setDraft("");
    setDraftProblem(null);
  }

  return (
    <div className="space-y-4">
      <div
        role="radiogroup"
        aria-label="Hub access mode"
        className="grid gap-2 sm:grid-cols-3"
      >
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
                selected
                  ? "border-(--mws-burgundy) bg-[#7E15180D]"
                  : "border-(--mws-line) bg-white hover:border-(--mws-burgundy)",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="font-display text-sm font-bold text-(--mws-charcoal)">
                  {mode.title}
                </span>
                {mode.recommended ? (
                  <StatusBadge tone="green">Start here</StatusBadge>
                ) : null}
                {selected ? (
                  <Check
                    size={14}
                    className="ml-auto text-(--mws-burgundy)"
                    aria-hidden="true"
                  />
                ) : null}
              </span>
              <span className="text-xs leading-5 text-(--mws-muted)">
                {mode.text}
              </span>
            </button>
          );
        })}
      </div>
      <div className="space-y-3">
        <Field
          label="Emergency Admins"
          hint={`Can open the Hub and its Admin Dashboard when Central gives them no access or is down. With access in Central they follow their role. Keep it to one or two people, up to ${MAX_BYPASS_EMAILS}.`}
          error={draftProblem ?? undefined}
        >
          <div
            className={cn(
              "flex h-11 min-w-0 items-center overflow-hidden rounded-xl border bg-white focus-within:border-(--mws-burgundy)",
              draftProblem ? "border-[#c75f64]" : "border-(--mws-line)",
            )}
          >
            <input
              aria-label="Add an emergency admin email"
              maxLength={LIMITS.EMAIL_MAX}
              value={draft}
              disabled={emails.length >= MAX_BYPASS_EMAILS}
              autoComplete="off"
              spellCheck={false}
              placeholder="Email"
              className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-(--mws-charcoal) outline-none placeholder:text-(--mws-muted) disabled:cursor-not-allowed"
              onChange={(event) => {
                const read = readNameInput(event.target.value);
                setDraft(read.name);
                setDraftProblem(read.problem);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
            <span className="shrink-0 pr-2 text-sm text-(--mws-muted)">
              @{LIMITS.EMAIL_DOMAIN}
            </span>
            <button
              type="button"
              aria-label="Add"
              title="Add"
              onClick={add}
              disabled={!draft.trim() || emails.length >= MAX_BYPASS_EMAILS}
              className="mr-1.5 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-(--mws-burgundy) transition-colors hover:bg-[#7E15180D] focus-visible:outline-2 focus-visible:outline-(--mws-burgundy) disabled:cursor-not-allowed disabled:text-(--mws-muted) disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <Plus size={18} aria-hidden="true" />
            </button>
          </div>
        </Field>
        {emails.length === 0 ? (
          <p className="text-xs text-(--mws-muted)">
            No one yet. Add one or two admins so a wrong setup cannot lock them
            out.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {emails.map((email) => (
              <li
                key={email}
                className="inline-flex items-center gap-1.5 rounded-full border border-(--mws-line) bg-(--mws-soft) py-1 pr-1 pl-3 text-xs text-(--mws-charcoal)"
              >
                <span>
                  {emailName(email)}
                  <span className="text-(--mws-muted)">
                    @{LIMITS.EMAIL_DOMAIN}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${email}`}
                  onClick={() =>
                    onChange({
                      ...value,
                      hub_bypass_emails: emails.filter(
                        (item) => item !== email,
                      ),
                    })
                  }
                  className="flex size-6 cursor-pointer items-center justify-center rounded-full text-(--mws-muted) hover:bg-white hover:text-(--mws-burgundy)"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Field
        label="Access Cookie Name"
        name="hub_access_cookie_name"
        error={cookieProblem ?? undefined}
        hint="Staging and production on the same parent domain need different names. Every application that reads the shared session uses the same one: its line is made for it."
      >
        <TextInput
          aria-label="Access Cookie Name"
          value={cookieName}
          maxLength={40}
          invalid={Boolean(cookieProblem)}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange({ ...value, hub_access_cookie_name: event.target.value.replace(/[^A-Za-z0-9_-]/g, "") })}
        />
      </Field>
    </div>
  );
}
