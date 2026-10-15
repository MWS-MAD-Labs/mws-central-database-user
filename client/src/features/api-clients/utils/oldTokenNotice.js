import { formatDateTime } from "../../../lib/format.js";

function untilLabel(expiresAt, now) {
  const minutes = Math.max(Math.round((new Date(expiresAt).getTime() - now) / 60000), 0);
  if (minutes < 60) return `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.round(minutes / 60);
  return `in about ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

// What happened to the token that was replaced, for the dialog that shows the new one.
// Returns null when the response does not say (nothing is guessed).
export function oldTokenNotice(client, rotation, now = Date.now()) {
  const credentials = client.credentials || [];
  if (rotation === "graceful") {
    const retiring = credentials
      .filter((credential) => credential.status === "RETIRING" && credential.expires_at)
      .sort((a, b) => new Date(b.expires_at) - new Date(a.expires_at))[0];
    if (!retiring) return null;
    return {
      tone: "warning",
      title: "Old Token Still Works For A While",
      text: `Old token ${retiring.token_prefix} stays valid until ${formatDateTime(retiring.expires_at)} (${untilLabel(retiring.expires_at, now)}). After that only the new token works. Update the client before then.`,
    };
  }
  if (rotation === "emergency") {
    const revoked = credentials
      .filter((credential) => credential.status === "REVOKED" && credential.revoked_at)
      .sort((a, b) => new Date(b.revoked_at) - new Date(a.revoked_at))[0];
    if (!revoked) return null;
    return {
      tone: "danger",
      title: "Old Token Stopped Working",
      text: `Old token ${revoked.token_prefix} stopped working just now. Only the new token works, so update the client right away.`,
    };
  }
  return null;
}
