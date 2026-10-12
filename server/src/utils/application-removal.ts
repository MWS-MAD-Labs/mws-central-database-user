const RECENT_USE_MS = 30 * 24 * 60 * 60 * 1000;

// Was any token of the application used in the last 30 days?
export function usedRecently(dates: (Date | null | undefined)[], now = Date.now()): boolean {
  return dates.some((date) => date && date.getTime() > now - RECENT_USE_MS);
}

export type RemovalFacts = {
  isHub: boolean;
  // Other applications in Central. Only the Hub is held back by them.
  otherApplications?: number;
  retired: boolean;
  published: boolean;
  people: number;
  recentlyUsed: boolean;
};

// What stops an application from being deleted, and whether retiring it would open the way.
// Used by the removal check and by the list, so both say the same thing.
export function evaluateRemoval(facts: RemovalFacts) {
  const blockers: string[] = [];
  // The Hub goes last: while other applications are set up here, they sign in through it.
  if (facts.isHub && (facts.otherApplications ?? 0) > 0) {
    const count = facts.otherApplications!;
    blockers.push(`${count} other ${count === 1 ? "application is" : "applications are"} still set up in Central. Remove ${count === 1 ? "it" : "them"} first.`);
  }
  // A retired application has no working token and gives nobody access, so nothing else stops it.
  if (!facts.retired) {
    if (facts.published) blockers.push("It is showing in the Hub.");
    if (facts.people > 0) {
      blockers.push(`${facts.people} ${facts.people === 1 ? "person has" : "people have"} access to it.`);
    }
    if (facts.recentlyUsed) blockers.push("Its token was used in the last 30 days, so the application is still running.");
  }
  return {
    blockers,
    can_remove: blockers.length === 0,
    retire_available: !facts.retired && blockers.length > 0 && !(facts.isHub && (facts.otherApplications ?? 0) > 0),
  };
}
