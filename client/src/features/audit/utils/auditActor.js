import { formatStatus } from "../../../lib/format.js";

const PURPOSE_NAMES = {
  "app-connection": "App connection",
  backend: "Backend service",
  "roster-sync": "Roster sync",
  "report-export": "Report export",
  ci: "Automation",
};

function words(value) {
  return value.replace(/[-_]+/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

// A client made by the server is named "MTSS (DEVELOPMENT/app-connection)". A client that was retired or removed
// carries those words after it. The first part is what a person reads.
function readClientName(name) {
  const cleaned = String(name || "").replace(/(\s*\((retired|removed)[^)]*\))+\s*$/i, "").trim();
  const match = cleaned.match(/^(.*?)\s*\(([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\)$/);
  if (!match) return { profile: cleaned || String(name || ""), environment: null, purpose: null };
  return {
    profile: match[1] || cleaned,
    environment: words(match[2].toLowerCase()),
    purpose: PURPOSE_NAMES[match[3]] || words(match[3]),
  };
}

// Who did it, short enough for a table cell. The full name stays in `title`.
export function auditActor(log) {
  if (log?.admin) {
    return {
      primary: log.admin.full_name || log.admin.email,
      secondary: log.admin.role ? formatStatus(log.admin.role) : "-",
      title: log.admin.email,
    };
  }
  if (log?.api_client) {
    const client = readClientName(log.api_client.name);
    return {
      primary: client.profile,
      secondary:
        [client.purpose, client.environment, log.api_client.token_prefix, log.api_client.deleted ? "Deleted" : null]
          .filter(Boolean)
          .join(" · ") || "-",
      title: log.api_client.name,
    };
  }
  return { primary: "System", secondary: "-", title: "System" };
}

// The entity of a client log is the client itself, named like its actor: the application, not "(DEVELOPMENT/app-connection) (retired ...)".
export function auditEntity(log) {
  const label = log?.entity_label || log?.entity_type || "-";
  if (!log?.entity_label) return { label, title: label };
  const client = readClientName(log.entity_label);
  const isClientName = client.environment !== null || /\((retired|removed)/i.test(log.entity_label);
  return { label: isClientName ? client.profile : log.entity_label, title: log.entity_label };
}
