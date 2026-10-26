import { Check } from "lucide-react";
import { Link } from "react-router";
import { TextAction } from "../../../components/ui/TextAction.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";

// The line under an address field that is being checked. `texts` has found, anyway, a message per verdict and the
// text of the confirmation for Use It Anyway. Only an address nothing answers at, or that answers Not Found, can be used anyway. `texts.help` may
// hold an address per verdict, which adds a How To Fix link to the guide.
export function AddressCheckStatus({ state, texts }) {
  const confirm = useConfirm();
  const { waiting, verdict, usedAnyway, accepted, acceptAnyway } = state;

  async function askAnyway() {
    const confirmed = await confirm({ title: texts.anywayTitle, description: texts.anywayText, confirmLabel: "Use It Anyway" });
    if (confirmed) acceptAnyway();
  }

  return (
    <div aria-live="polite" className="min-h-5 text-xs">
      {waiting ? <p className="text-(--mws-muted)">Checking the address…</p> : null}
      {!waiting && (accepted || usedAnyway) ? (
        <p className="flex items-center gap-1.5 font-semibold text-[#3b5d36]">
          <Check size={14} aria-hidden="true" />
          {verdict === "ok" ? texts.found : accepted ? (texts[`found_${verdict}`] ?? texts.found) : texts.anyway}
        </p>
      ) : null}
      {!waiting && verdict && !accepted && !usedAnyway ? (
        <p className="text-[#a43c41]">
          {texts[verdict]}{" "}
          {verdict === "unverifiable" && state.detail?.suggestion && texts.onSuggestion ? (
            <>
              {texts.suggest} <span className="font-mono">{state.detail.suggestion.replace(/^https?:\/\//, "")}</span>{" "}
              <TextAction className="inline-flex" onClick={() => texts.onSuggestion(state.detail.suggestion)}>
                Use This Address
              </TextAction>{" "}
            </>
          ) : null}
          {texts.help?.[verdict] ? (
            <Link to={texts.help[verdict]} className="font-semibold underline">
              How To Fix
            </Link>
          ) : null}{" "}
          {verdict === "unreachable" || verdict === "wrong_path" || verdict === "unverifiable" || verdict === "failed" ? (
            <TextAction className="ml-1 inline-flex" onClick={askAnyway}>
              Use It Anyway
            </TextAction>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
