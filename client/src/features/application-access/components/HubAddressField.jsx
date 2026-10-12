import { useState } from "react";
import { cn } from "../../../lib/cn.js";
import { Field } from "../../../components/ui/FormControls.jsx";
import { ENVIRONMENTS, environmentOfScheme, hubAddressProblem, joinAddress, readAddressInput, splitAddress } from "../utils/applicationUrl.js";
import { AddressInput } from "./AddressInput.jsx";

// The public address of the Hub. `value` is the whole address or nothing, `onChange` gets the same.
export function HubAddressField({ value, onChange, showError = false }) {
  const start = splitAddress(value);
  const [environment, setEnvironment] = useState(value ? start.environment : "production");
  const [rest, setRest] = useState(start.rest);
  const problem = rest.trim() ? hubAddressProblem(environment, rest) : null;

  function change(nextEnvironment, nextRest) {
    setEnvironment(nextEnvironment);
    setRest(nextRest);
    const bad = nextRest.trim() ? hubAddressProblem(nextEnvironment, nextRest) : null;
    onChange(nextRest.trim() && !bad ? joinAddress(nextEnvironment, nextRest) : "", Boolean(bad));
  }

  return (
    <Field
      label="Hub Address"
      hint="Where people open the Hub. Every application gets it in its .env."
      error={showError || rest.trim() ? (problem ?? undefined) : undefined}
    >
      <div className="space-y-2">
        <div role="radiogroup" aria-label="Hub environment" className="grid w-full grid-cols-2 gap-1 rounded-xl border border-(--mws-line) bg-(--mws-soft) p-1 sm:max-w-xs">
          {ENVIRONMENTS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-label={`Hub ${item.label}`}
              aria-checked={environment === item.id}
              onClick={() => change(item.id, rest)}
              className={cn(
                "flex h-8 cursor-pointer items-center justify-center rounded-lg text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-(--mws-burgundy)",
                environment === item.id ? "bg-white text-(--mws-burgundy) shadow-sm ring-1 ring-(--mws-line)" : "text-(--mws-muted) hover:text-(--mws-charcoal)",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <AddressInput
          label="Hub Address"
          environment={environment}
          value={rest}
          placeholder={environment === "local" ? "localhost:4001" : "app.mws.web.id"}
          invalid={Boolean(problem)}
          onChange={(event) => {
            const next = readAddressInput(event.target.value, environment);
            change(next.scheme ? environmentOfScheme(next.scheme) : environment, next.rest);
          }}
          onBlur={() => setRest((current) => current.trim())}
        />
      </div>
    </Field>
  );
}
