import { useEffect, useEffectEvent, useState } from "react";
import { cn } from "../../../lib/cn.js";
import { Field } from "../../../components/ui/FormControls.jsx";
import { applicationAccessApi } from "../api/applicationAccessApi.js";
import { ENVIRONMENTS, environmentOfScheme, hubAddressProblem, joinAddress, readAddressInput, splitAddress } from "../utils/applicationUrl.js";
import { useAddressCheck } from "../hooks/useAddressCheck.js";
import { AddressCheckStatus } from "./AddressCheckStatus.jsx";
import { AddressInput } from "./AddressInput.jsx";

const HINT = "Where people open the Hub. Every application gets it in its .env.";

const TEXTS = {
  found: "Found the Hub.",
  anyway: "Used as typed, not checked.",
  unreachable: "Nothing answers at this address. Is the Hub running?",
  not_hub: "Something answers, but it does not look like the Hub (it has no sign-in keys). Check the address and the port.",
  refused: "This address cannot be checked.",
  failed: "The address could not be checked just now. Try again.",
  anywayTitle: "Use This Address Anyway",
  anywayText:
    "Central could not reach this address, which can be true when the Hub only runs on your machine and Central does not. If it is wrong, every application gets a wrong HUB_BASE_URL and their sign-in fails. Use it only if you are sure.",
};

// The public address of the Hub. `value` is the whole address or nothing. `onChange(address, notReady)` says what is typed and
// whether it may be used: it has to be well formed and a Hub has to answer there, unless it was kept as it was or is used anyway.
export function HubAddressField({ value, onChange, showError = false }) {
  const start = splitAddress(value);
  const [environment, setEnvironment] = useState(value ? start.environment : "production");
  const [rest, setRest] = useState(start.rest);
  const [initial] = useState(value);

  const problem = rest.trim() ? hubAddressProblem(environment, rest) : null;
  const address = rest.trim() && !problem ? joinAddress(environment, rest) : "";
  const state = useAddressCheck({ address, saved: initial, name: "hub-address-check", check: applicationAccessApi.checkHubAddress });
  const { ready, verdict, usedAnyway } = state;

  const report = useEffectEvent(onChange);
  useEffect(() => {
    report(address, !ready);
  }, [address, ready]);

  function change(nextEnvironment, nextRest) {
    setEnvironment(nextEnvironment);
    setRest(nextRest);
  }

  return (
    <Field label="Hub Address" hint={HINT} error={showError || rest.trim() ? (problem ?? undefined) : undefined}>
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
          placeholder={environment === "local" ? "localhost:5175" : "app.mws.web.id"}
          invalid={Boolean(problem) || (Boolean(verdict) && verdict !== "ok" && !usedAnyway)}
          onChange={(event) => {
            const next = readAddressInput(event.target.value, environment);
            change(next.scheme ? environmentOfScheme(next.scheme) : environment, next.rest);
          }}
          onBlur={() => setRest((current) => current.trim())}
        />
        <AddressCheckStatus state={state} texts={TEXTS} />
      </div>
    </Field>
  );
}
