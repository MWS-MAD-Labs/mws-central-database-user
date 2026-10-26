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
