const DAY = 24 * 60 * 60 * 1000;

// "just now", "2 minutes ago", "3 hours ago", "5 days ago".
export function timeAgo(value, now = Date.now()) {
  if (!value) return "";
  const elapsed = Math.max(now - new Date(value).getTime(), 0);
  if (elapsed < 60_000) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(elapsed / DAY);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export const STEP_IDS = ["about", "connect", "permissions", "roles", "groups", "hub"];

// The six steps with a status each: done, current (the first one not done) or locked.
// Progress is read from the data, so a person can leave and come back at any time.
export function buildSteps(setup, now = Date.now()) {
  const app = setup.application;
  const connected = Boolean(setup.connection.last_used_at) || setup.permissions.count > 0;
  const done = {
    about: Boolean(app.launch_url),
    connect: connected,
    permissions: setup.permissions.count > 0,
    roles: setup.roles.active_count > 0,
    groups: setup.groups.active_count > 0,
    hub: app.published,
  };
  const note = {
    about: app.launch_url ? app.name : "Add the launch address so the Hub knows where to send people.",
    connect: connected
      ? setup.connection.last_used_at
        ? `Connected, last call ${timeAgo(setup.connection.last_used_at, now)}.`
        : "Connected."
      : setup.connection.created
        ? "Waiting for the application. Deploy it with the .env values and its permission sync."
        : "Create the connection to get the .env values for the application.",
    permissions: done.permissions
      ? `${setup.permissions.count} permission${setup.permissions.count === 1 ? "" : "s"} received${
          setup.permissions.synced_at ? `, ${timeAgo(setup.permissions.synced_at, now)}` : ""
        }.`
      : "Arrives with the first sync from the application.",
    roles: done.roles
      ? `${setup.roles.active_count} role${setup.roles.active_count === 1 ? "" : "s"}.`
      : "A role is a named set of permissions, like Admin or Staff.",
    groups: done.groups
      ? `${setup.groups.active_count} active group${setup.groups.active_count === 1 ? "" : "s"}.`
      : "A group says who gets which role.",
    hub: app.published ? "Showing in the Hub for people a group covers." : "Make the application appear in the Hub.",
  };
  const firstOpen = STEP_IDS.find((id) => !done[id]);
  return STEP_IDS.map((id) => ({
    id,
    done: done[id],
    status: done[id] ? "done" : id === firstOpen ? "current" : "locked",
    note: note[id],
  }));
}

export function stepsDone(steps) {
  return steps.filter((step) => step.done).length;
}
