import { timeAgo } from "./setupSteps.js";

// What the token connection is doing, from what Central sees. The first match wins. The sign-in address has its own line.
export function connectionState({ link, health, connection }) {
  if (link) return { tone: "grey", pulse: false, label: "Plain Link", note: "Nothing To Connect" };
  if (health?.status === "check_token") return { tone: "amber", pulse: false, label: "Check Token", note: "Still Using An Old Token" };
  if (health?.status === "token_pending" || health?.status === "sign_in_pending") {
    return { tone: "amber", pulse: true, label: "Update Pending", note: health.status === "token_pending" ? "Waiting For The New Token" : "Waiting For The New Sign-In Way" };
  }
  if (connection.last_used_at) return { tone: "green", pulse: true, label: "Connected", note: `Last Call ${timeAgo(connection.last_used_at)}${timeAgo(connection.last_used_at) === "Just Now" ? "" : " Ago"}` };
  if (connection.created) return { tone: "amber", pulse: true, label: "Waiting For First Call", note: "Deploy It With Its .env" };
  return { tone: "grey", pulse: false, label: "Not Connected", note: "No Connection Made Yet" };
}

const ADDRESS_STATES = {
  ok: { tone: "green", label: "Answers" },
  wrong_path: { tone: "amber", label: "Wrong Path" },
  unreachable: { tone: "red", label: "Not Answering" },
  unverifiable: { tone: "grey", label: "Cannot Tell", title: "This server answers every path, so Central cannot tell if the sign-in page exists. Open the application from the Hub to confirm." },
};

// What the last check of the sign-in address found. Null where there is no address to check.
export function addressState({ link, isHub, address }) {
  if (link || isHub) return null;
  return ADDRESS_STATES[address?.status] ?? { tone: "grey", label: "Not Checked Yet" };
}

// A token that has not been used for this long counts as quiet: the application may be down or not calling Central.
export const QUIET_AFTER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(iso, now) {
  return Math.floor((now - new Date(iso).getTime()) / DAY_MS);
}

// One verdict from the two things Central can see. The application calls Central with its token, and Central or the
// Hub opens the sign-in address of the application. Both have to be fine to be Working. The first match wins.
//   token: connectionState(...), address: the status of the last check of the sign-in address, from the list row
//   `health.status` when `address` is not given.
export function overallState({ link, isHub = false, health, connection, address, now = Date.now() }) {
  if (link) return { tone: "grey", pulse: false, label: "Plain Link", note: "Nothing To Connect" };
  const token = connectionState({ link, health, connection });
  if (token.label !== "Connected") return token;

  const addressStatus = address?.status ?? (health?.status === "unreachable" || health?.status === "wrong_path" ? health.status : null);
  if (!isHub && addressStatus === "unreachable") {
    return {
      tone: "red",
      pulse: false,
      label: "Needs Attention",
      note: "Its sign-in address does not answer",
    };
  }
  if (!isHub && addressStatus === "wrong_path") {
    return {
      tone: "amber",
      pulse: false,
      label: "Needs Attention",
      note: "The sign-in page is not at this address",
    };
  }
  if (connection.last_used_at && daysSince(connection.last_used_at, now) >= QUIET_AFTER_DAYS) {
    return {
      tone: "amber",
      pulse: false,
      label: "Quiet",
      note: `No call for ${daysSince(connection.last_used_at, now)} days`,
    };
  }
  const verified = addressStatus === "ok";
  return {
    tone: "green",
    pulse: true,
    label: "Working",
    note: `${token.note}${isHub || !verified ? "" : " · Address Answers"}`,
  };
}
