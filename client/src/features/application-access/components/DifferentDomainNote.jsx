import { AlertTriangle } from "lucide-react";
import { BARE_HOST_ADVICE, isBareHost, parentDomainOf } from "../utils/sessionDomain.js";

// Shown for an application on the shared session whose address is not under the Hub's parent domain. It is allowed,
// and marked, because applications already run that way.
export function DifferentDomainNote({ hubAddress, appAddress, className = "" }) {
  const hubDomain = parentDomainOf(hubAddress);
  const appDomain = parentDomainOf(appAddress);
  const bare = isBareHost(hubAddress) || isBareHost(appAddress);
  return (
    <div role="note" className={`rounded-xl border border-[#d8b45b] bg-[#fff8e8] p-3 text-sm text-[#745716] ${className}`}>
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle size={15} aria-hidden="true" />
        Different Domain
      </p>
      <p className="mt-1">
        {bare
          ? `The Hub is at ${hubDomain} and this application is at ${appDomain}. The Hub's session cookie does not reach it, so people cannot sign in with the shared session. ${BARE_HOST_ADVICE} Or use Hub Code & Token (Legacy).`
          : `The Hub is under ${hubDomain} and this application is under ${appDomain}. The Hub's session cookie does not reach it, so people cannot sign in with the shared session, and signing out of the Hub does not end a session it still holds. Use Hub Code & Token (Legacy), or move it under ${hubDomain}.`}
      </p>
    </div>
  );
}
