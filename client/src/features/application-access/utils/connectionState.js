import { timeAgo } from "./setupSteps.js";

// What the connection is doing, from what Central sees. The first match wins.
export function connectionState({ link, health, connection }) {
  if (link) return { tone: "grey", pulse: false, label: "Plain Link", note: "Nothing To Connect" };
  if (health?.status === "unreachable") return { tone: "red", pulse: false, label: "Unreachable", note: "Not Answering At Its Address" };
  if (health?.status === "wrong_path") return { tone: "amber", pulse: false, label: "Wrong Path", note: "Sign-In Address Not Found" };
  if (health?.status === "check_token") return { tone: "amber", pulse: false, label: "Check Token", note: "Still Using An Old Token" };
  if (health?.status === "token_pending" || health?.status === "sign_in_pending") {
    return { tone: "amber", pulse: true, label: "Update Pending", note: health.status === "token_pending" ? "Waiting For The New Token" : "Waiting For The New Sign-In Way" };
  }
  if (connection.last_used_at) return { tone: "green", pulse: true, label: "Connected", note: `Last Call ${timeAgo(connection.last_used_at)}${timeAgo(connection.last_used_at) === "Just Now" ? "" : " Ago"}` };
  if (connection.created) return { tone: "amber", pulse: true, label: "Waiting For First Call", note: "Deploy It With Its .env" };
  return { tone: "grey", pulse: false, label: "Not Connected", note: "No Connection Made Yet" };
}
